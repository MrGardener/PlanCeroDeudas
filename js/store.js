/*
 * Store — the single source of truth. All persisted data lives in `Store.state`; UI-only
 * view state (current tab, selected month, filters) lives in `Store.ui` and is never saved.
 * Saving, loading, migrating old saves, baselines and resets all go through here, so
 * nothing can be "forgotten" by one of them (every persisted field is in one object).
 */
(function (root) {
    'use strict';

    const Defaults = root.Defaults || (typeof require !== 'undefined' ? require('./defaults.js') : null);
    const Engine = root.Engine || (typeof require !== 'undefined' ? require('./engine.js') : null);

    const KEY = 'plan_financiero_ec_v7_store';
    const SAVE_DELAY_MS = 400;

    const deepFreeze = (o) => { Object.values(o).forEach(v => { if (v && typeof v === 'object') deepFreeze(v); }); return Object.freeze(o); };
    let frozenDefaultYear = null;

    // Bring one year's data up to the current shape (older saves predate some fields).
    function normalizeYear(yd) {
        const fresh = Defaults.newYear();
        Object.keys(fresh).forEach(k => { if (yd[k] === undefined) yd[k] = fresh[k]; });
        const nw = yd.netWorth || (yd.netWorth = {});
        if (nw.cash !== undefined && nw.checking === undefined) { nw.checking = nw.cash; nw.savings = 0; }
        delete nw.cash; delete nw.realEstate; delete nw.vehicles; delete nw.personalProperty;
        Engine.NET_WORTH_FIELDS.forEach(f => { if (nw[f] === undefined) nw[f] = 0; });
        // Saves from before touched-tracking: a non-zero value was typed by the user, so it
        // counts as explicit; zeros were never-visited defaults and should carry forward.
        if (!yd.netWorthTouched) {
            yd.netWorthTouched = {};
            Engine.NET_WORTH_FIELDS.forEach(f => { if (nw[f]) yd.netWorthTouched[f] = true; });
        }
        if (!yd.monthOverrides) yd.monthOverrides = {};
        return yd;
    }

    // Accepts the current format (version 8) or the pre-refactor flat format, and returns
    // a complete, normalized state. Anything missing falls back to the defaults.
    function migrate(raw, today) {
        const s = Defaults.newState(today);
        if (!raw || typeof raw !== 'object') return s;

        if (raw.version >= 8) {
            Object.keys(s).forEach(k => {
                if (raw[k] === undefined) return;
                s[k] = (s[k] && typeof s[k] === 'object' && !Array.isArray(s[k]) && k !== 'years')
                    ? Object.assign(s[k], raw[k])
                    : raw[k];
            });
        } else {
            const map = {
                multiYearStore: 'years', cooperativasStore: 'cooperativas', polizasStore: 'polizas',
                goalItems: 'goals', debtItems: 'debts', assetItems: 'assets', transactionItems: 'transactions'
            };
            ['configStartYear', 'configEndYear', 'activeYear'].forEach(k => { if (raw[k]) s[k] = raw[k]; });
            Object.keys(map).forEach(k => { if (raw[k]) s[map[k]] = raw[k]; });
            if (raw.expenseCategoryTaxonomy) s.taxonomy.expense = raw.expenseCategoryTaxonomy;
            if (raw.incomeCategoryTaxonomy) s.taxonomy.income = raw.incomeCategoryTaxonomy;
            if (raw.retireWhatIfMax) s.settings.retireWhatIfMax = raw.retireWhatIfMax;
            if (raw.mortgageWhatIfMax) s.settings.mortgageWhatIfMax = raw.mortgageWhatIfMax;
            if (raw.mortgageSystem) s.settings.mortgageSystem = raw.mortgageSystem;
            if (raw.mortgageConfig) Object.assign(s.mortgage, raw.mortgageConfig);
            // Old baselines only captured years, cooperativas and pólizas; keep them restorable
            // with exactly that scope.
            if (Array.isArray(raw.baselinesStore)) {
                s.baselines = raw.baselinesStore.map(b => ({
                    id: b.id, name: b.name, timestamp: b.timestamp, legacy: true,
                    data: {
                        configStartYear: b.configStartYear, configEndYear: b.configEndYear,
                        years: b.multiYearStore || {}, cooperativas: b.cooperativasStore, polizas: b.polizasStore
                    }
                }));
            }
        }

        Object.keys(s.years).forEach(y => normalizeYear(s.years[y]));
        s.baselines.forEach(b => { if (b.data && b.data.years) Object.keys(b.data.years).forEach(y => normalizeYear(b.data.years[y])); });
        const thisYear = new Date(today || Date.now()).getFullYear();
        // Debts and goals are budget lines: their monthly amount lives on the object and shows
        // up in every budget from the year they were created. Older saves get the minimum
        // payment (debts) as that amount.
        s.debts.forEach(d => {
            if (!d.kind) d.kind = Engine.guessDebtKind(d.name);
            if (d.monthly === undefined || d.monthly === null) d.monthly = Math.max(0, Number(d.minPayment) || 0);
            if (!d.createdYear) d.createdYear = thisYear;
        });
        s.goals.forEach(g => {
            if (g.monthly === undefined || g.monthly === null) g.monthly = 0;
            if (!g.createdYear) g.createdYear = thisYear;
        });
        // The old free-floating "pago extra" wasn't backed by the budget; move it into the budget
        // line of the first debt the strategy attacks so the plan keeps the same outcome.
        if (s.debtPlan && Number(s.debtPlan.extraPayment) > 0) {
            const open = s.debts.filter(d => Number(d.balance) > 0.01);
            const target = s.debtPlan.strategy === 'avalanche'
                ? open.sort((a, b) => b.rate - a.rate)[0]
                : open.sort((a, b) => a.balance - b.balance)[0];
            if (target) target.monthly += Number(s.debtPlan.extraPayment);
            s.debtPlan.extraPayment = 0;
        }
        s.assets.forEach(a => { if (!a.valuesByYear) a.valuesByYear = {}; });
        s.configStartYear = Number(s.configStartYear); s.configEndYear = Number(s.configEndYear);
        s.activeYear = Math.min(s.configEndYear, Math.max(s.configStartYear, Number(s.activeYear)));
        s.version = 8;
        return s;
    }

    const Store = {
        KEY,
        state: null,
        ui: { tab: 'resumen', sub: { presupuesto: 'plan', ahorro: 'proyeccion' }, month: 'base', txnFilters: { year: 'all', month: 'all', type: 'all', category: 'all' }, txnEditing: null },
        status: { lastSavedAt: null, error: null },
        listeners: [],
        _timer: null,
        _lastSaved: null,

        migrate,
        normalizeYear,

        init(storage) {
            this.storage = storage || (typeof localStorage !== 'undefined' ? localStorage : null);
            let raw = null;
            try { raw = this.storage && JSON.parse(this.storage.getItem(KEY)); } catch (e) { raw = null; }
            this.state = migrate(raw);
            this._lastSaved = raw ? JSON.stringify(this.state) : null;
            this.year(this.state.activeYear);
            return this.state;
        },

        // A year's data for editing — created from defaults the first time it's touched.
        year(y) {
            y = Number(y === undefined ? this.state.activeYear : y);
            if (!this.state.years[y]) this.state.years[y] = Defaults.newYear();
            return this.state.years[y];
        },

        // Read-only access that does not add unconfigured years to the saved data.
        // The shared default is frozen so an accidental write fails loudly instead of
        // silently changing every unconfigured year.
        peekYear(y) {
            if (this.state.years[y]) return this.state.years[y];
            if (!frozenDefaultYear) frozenDefaultYear = deepFreeze(Defaults.newYear());
            return frozenDefaultYear;
        },

        active() { return this.year(this.state.activeYear); },

        // Budget lines generated from debts and goals. They are not stored in the year's
        // budget; they are derived on every read, so creating, renaming, paying off or deleting
        // a debt/goal is reflected in every budget immediately and can never fall out of sync.
        linkedRows(y) {
            const rows = [];
            this.state.debts.forEach(d => {
                if (Number(d.balance) > 0.01 && (d.createdYear || 0) <= y) {
                    const m = Math.max(0, Number(d.monthly) || 0);
                    rows.push({ id: 'debt-' + d.id, link: 'debt', refId: d.id, name: d.name, type: 'Deuda', isDeductible: false, prep: m, real: m, linkedCategory: 'Deudas', minPayment: Math.max(0, Number(d.minPayment) || 0) });
                }
            });
            this.state.goals.forEach(g => {
                if ((g.createdYear || 0) <= y) {
                    const m = Math.max(0, Number(g.monthly) || 0);
                    rows.push({ id: 'goal-' + g.id, link: 'goal', refId: g.id, name: g.name, type: 'Ahorro', isDeductible: false, prep: m, real: m, linkedCategory: 'Ahorro e Inversión' });
                }
            });
            return rows;
        },

        // A year's budget as the math sees it: its own rubros plus the linked debt/goal lines
        // (in the base budget and in every month that has its own budget), and the income
        // logged as transactions in each month of that year.
        effective(y) {
            y = Number(y);
            const yd = this.peekYear(y);
            const rows = this.linkedRows(y);
            const overrides = {};
            Object.keys(yd.monthOverrides || {}).forEach(m => { overrides[m] = yd.monthOverrides[m].concat(rows); });
            return Object.assign({}, yd, {
                budgetBase: (yd.budgetBase || []).concat(rows),
                monthOverrides: overrides,
                receivedIncome: Engine.receivedIncome(this.state.transactions, y)
            });
        },

        nextId(list) { return list.length ? Math.max(...list.map(x => Number(x.id) || 0)) + 1 : 1; },

        serialize() { return JSON.stringify(this.state); },

        onChange(fn) { this.listeners.push(fn); },
        _emit() { this.listeners.forEach(fn => fn(this.status)); },

        // Debounced autosave: every mutation calls this; only real changes hit the disk.
        scheduleSave() {
            clearTimeout(this._timer);
            this._timer = setTimeout(() => this.saveNow(), SAVE_DELAY_MS);
        },

        saveNow() {
            clearTimeout(this._timer);
            if (!this.storage) return false;
            const data = this.serialize();
            if (data === this._lastSaved) return true;
            try {
                this.storage.setItem(KEY, data);
                this._lastSaved = data;
                this.status = { lastSavedAt: new Date(), error: null };
            } catch (e) {
                this.status = { lastSavedAt: this.status.lastSavedAt, error: e.message || String(e) };
            }
            this._emit();
            return !this.status.error;
        },

        replaceState(raw) {
            // Loading a backup replaces the data, not what this person already knows about
            // the app: keep "welcome seen" and the most recent backup date.
            const prev = this.state && this.state.settings;
            this.state = migrate(raw);
            if (prev) {
                if (prev.welcomeDismissed) this.state.settings.welcomeDismissed = true;
                if (prev.lastBackupAt && (!this.state.settings.lastBackupAt || prev.lastBackupAt > this.state.settings.lastBackupAt)) this.state.settings.lastBackupAt = prev.lastBackupAt;
            }
            this.year(this.state.activeYear);
            this.saveNow();
        },

        reset(kind) {
            this.state = kind === 'empty' ? Defaults.emptyState() : Defaults.newState();
            this.year(this.state.activeYear);
            if (this.storage) this.storage.removeItem(KEY);
            this._lastSaved = null;
            this.saveNow();
        },

        // Baselines freeze the entire model (everything except the baselines list itself).
        createBaseline(name) {
            const data = JSON.parse(this.serialize());
            delete data.baselines;
            const b = { id: Date.now(), name, timestamp: new Date().toLocaleString('es-EC'), data };
            this.state.baselines.push(b);
            return b;
        },

        restoreBaseline(id) {
            const b = this.state.baselines.find(x => x.id === id);
            if (!b) return false;
            const baselines = this.state.baselines;
            if (b.legacy) {
                const d = Defaults.clone(b.data);
                if (d.configStartYear) this.state.configStartYear = d.configStartYear;
                if (d.configEndYear) this.state.configEndYear = d.configEndYear;
                this.state.years = d.years || {};
                if (d.cooperativas) this.state.cooperativas = d.cooperativas;
                if (d.polizas) this.state.polizas = d.polizas;
                this.state = migrate(this.state);
            } else {
                this.state = migrate(Defaults.clone(b.data));
            }
            this.state.baselines = baselines;
            this.year(this.state.activeYear);
            return true;
        },

        // Copy a year's budget and parameters. Net worth balances are records of what you
        // actually owned/owed that year, not plan parameters, so the target keeps its own.
        copyYear(fromY, toY) {
            const src = Defaults.clone(this.year(fromY));
            const target = this.state.years[toY];
            if (target) { src.netWorth = target.netWorth; src.netWorthTouched = target.netWorthTouched; }
            else { const fresh = Defaults.newYear(); src.netWorth = fresh.netWorth; src.netWorthTouched = fresh.netWorthTouched; }
            this.state.years[toY] = src;
        }
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Store;
    else root.Store = Store;
})(this);
