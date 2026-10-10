/*
 * App — wires Store (data), Engine (math) and the views together.
 *
 * Data flow is one-directional:  user input → handler mutates Store.state → App.changed()
 *   → autosave is scheduled → the active view re-renders from state.
 * `render()` rebuilds a view (used when the structure changes: tab switch, rows added or
 * removed, year/month switched); `update()` only refreshes computed numbers and charts, so
 * the input you're typing in is never destroyed. Views that aren't visible aren't touched;
 * they render fresh from state when opened, so nothing can go stale.
 */
(function (root) {
    'use strict';

    // The navigation, in the order a person works through the plan. Numbers in the nav are
    // generated from this list, and every cross-link in the app points at an id here
    // (never at a hard-coded "Tab N"), so reordering can't leave stale references behind.
    const tabs = [
        { id: 'resumen', label: 'Overview', icon: 'fa-gauge-high' },
        { id: 'presupuesto', label: 'Budget', icon: 'fa-wallet', subviews: [
            { id: 'plan', label: 'Monthly Budget', icon: 'fa-table-list' },
            { id: 'ingresos', label: 'Income & Taxes', icon: 'fa-receipt' }
        ] },
        { id: 'transacciones', label: 'Transactions', icon: 'fa-cart-shopping', subviews: [
            { id: 'lista', label: 'History', icon: 'fa-list' },
            { id: 'importar', label: 'Import', icon: 'fa-file-import' },
            { id: 'reportes', label: 'Reports', icon: 'fa-chart-pie' }
        ] },
        { id: 'futuro', label: 'Future', icon: 'fa-road', subviews: [
            { id: 'metas', label: 'Debts & Goals', icon: 'fa-bullseye' },
            { id: 'proyeccion', label: 'Savings & CDs', icon: 'fa-piggy-bank' },
            { id: 'polizas', label: 'CDs & Banks', icon: 'fa-file-contract' },
            { id: 'hipoteca', label: 'Hipoteca', icon: 'fa-house-chimney' },
            { id: 'jubilacion', label: 'Retirement', icon: 'fa-person-cane' },
            { id: 'calculadoras', label: 'Calculators', icon: 'fa-calculator' }
        ] },
        { id: 'patrimonio', label: 'Net Worth', icon: 'fa-scale-balanced' },
        // Reached from the gear in the header, not from the tab bar.
        { id: 'config', label: 'Settings', icon: 'fa-gears', nav: false }
    ];
    // Where the screens used to live (links, bookmarks and #hashes from before the 5-tab layout).
    const ALIASES = {
        'presupuesto/transacciones': 'transacciones/lista', 'presupuesto/importar': 'transacciones/importar', 'presupuesto/reportes': 'transacciones/reportes',
        metas: 'futuro/metas', ahorro: 'futuro/proyeccion', 'ahorro/proyeccion': 'futuro/proyeccion', 'ahorro/polizas': 'futuro/polizas',
        hipoteca: 'futuro/hipoteca', jubilacion: 'futuro/jubilacion', calculadoras: 'futuro/calculadoras'
    };
    const views = {};

    // ------------------------------------------------------------- bindings
    // Static form fields declare where their value lives: data-bind="scope.field".
    // Scopes: year (active year), retirement, mortgage, settings, debtPlan.
    function bindTarget(scope) {
        const s = Store.state;
        if (scope === 'year') return Store.active();
        return s[scope];
    }

    // "year.sueldo" or deeper ("year.usTax.stdDeduction.single").
    function boundParent(path) {
        const [scope, ...rest] = path.split('.');
        let obj = bindTarget(scope);
        for (let i = 0; obj && i < rest.length - 1; i++) obj = obj[rest[i]];
        return [obj, rest[rest.length - 1]];
    }
    function readBound(el) {
        const [obj, field] = boundParent(el.dataset.bind);
        return obj ? obj[field] : undefined;
    }

    function writeBound(el) {
        const [obj, field] = boundParent(el.dataset.bind);
        if (!obj) return;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number' || el.dataset.type === 'number') {
            v = Fmt.parseNum(el.value, 0);
            // A menu of numbers has no minimum to keep to.
            if (el.min !== undefined && el.min !== '' && el.dataset.clamp !== 'false') v = Math.max(Number(el.min), v);
        } else v = el.value;
        obj[field] = v;
    }

    function fillBindings(scope) {
        UI.$$('[data-bind]', scope).forEach(el => {
            if (el === document.activeElement) return;
            const v = readBound(el);
            if (el.type === 'checkbox') el.checked = !!v;
            else el.value = v === null || v === undefined ? '' : v;
        });
    }

    // ------------------------------------------------------------- context
    // Everything derived from state that more than one view needs, computed lazily
    // (only what the active view actually reads) and fresh on every render/update.
    function buildContext() {
        const s = Store.state;
        const ctx = { state: s, ui: Store.ui, today: new Date() };
        const lazy = (name, fn) => Object.defineProperty(ctx, name, { get() { const v = fn(); Object.defineProperty(ctx, name, { value: v }); return v; }, configurable: true });

        ctx.year = Store.active();                       // stored data, for editing
        ctx.budgetYear = Store.effective(s.activeYear);  // + debt/goal lines, for every calculation
        lazy('pay', () => Engine.payroll(ctx.budgetYear));
        lazy('monthBudget', () => Engine.monthBudget(ctx.budgetYear, Store.ui.month, ctx.pay));
        lazy('baseBudget', () => Engine.monthBudget(ctx.budgetYear, 'base', ctx.pay));
        lazy('annual', () => Engine.annualBudget(ctx.budgetYear));
        lazy('polizasCapital', () => Engine.polizasCapital(s.polizas));
        lazy('projectionStart', () => Math.min(s.configEndYear, Math.max(s.configStartYear, ctx.today.getFullYear())));
        lazy('projection', () => Engine.projectDPF({ polizas: s.polizas, startYear: ctx.projectionStart, endYear: s.configEndYear, getYear: y => Store.effective(y) }));
        lazy('netWorth', () => Engine.netWorth(s.years, s.assets, s.activeYear));
        // Savings, each dollar counted once: the emergency fund first (up to 6 months of essentials),
        // the rest — plus retirement accounts, CDs/DPF set aside for retirement and investments —
        // grows for retirement.
        lazy('essentialMonthly', () => Engine.emergencyFund({ liquid: 0, budgetBase: ctx.year.budgetBase }).monthlyEssential);
        lazy('savingsBalance', () => ((s.accounts || []).some(a => a.kind === 'ahorros') ? Engine.accountTotal(s.accounts, 'ahorros') : ctx.netWorth.fields.savings));
        lazy('pools', () => Engine.savingsPools({
            polizas: s.polizas, savingsBalance: ctx.savingsBalance, goals: s.goals,
            retirementAccounts: (s.accounts || []).filter(Engine.isRetirementMoney).reduce((t, a) => t + (Number(a.balance) || 0), 0), holdings: Engine.holdingsValue(s.holdings),
            monthlyEssential: ctx.essentialMonthly
        }));
        lazy('ef', () => Engine.emergencyFund({ liquid: ctx.pools.emergency, budgetBase: ctx.year.budgetBase }));
        // The payoff plan spends only what the budget assigns: each debt's own line, plus any
        // other "Pago deuda" rubro (which goes to the snowball target).
        lazy('debtExtraRubros', () => ctx.year.budgetBase.filter(i => i.type === 'Deuda').reduce((t, i) => t + (Number(i.real) || 0), 0));
        lazy('debts', () => Engine.debtPayoff(s.debts, s.debtPlan.strategy, ctx.debtExtraRubros));
        // Retirement savings = the budget's own savings rubros (not goal lines, not the emergency
        // fund line) + auto-sweep + retirement saved straight from the paycheck (401k, ahorro
        // voluntario). The employer match grows the nest egg but isn't part of YOUR 15% (Step 4).
        // (From the computed year: a deduction can be a % of pay or an amount per paycheck.)
        lazy('payRetirement', () => Engine.payDeductionsSummary(ctx.budgetYear));
        // The household's other paychecks save for retirement too (their 401(k) and its match).
        lazy('earnersRetirement', () => Engine.otherEarners(ctx.budgetYear).map(o => {
            const d = Engine.payDeductionsSummary(o.yd), l = o.line;
            return { id: l.id, memberId: l.memberId, name: l.name, own: d.byGroup.retirement, match: d.retirement - d.byGroup.retirement };
        }));
        lazy('ownRetirementMonthly', () => ctx.year.budgetBase.filter(i => Engine.isSavingsItem(i) && Engine.savingsPurpose(i) !== 'emergencia').reduce((t, i) => t + (Number(i.real) || 0), 0)
            + ctx.baseBudget.sweep + ctx.payRetirement.byGroup.retirement + ctx.earnersRetirement.reduce((t, e) => t + e.own, 0));
        lazy('employerMatchMonthly', () => ctx.payRetirement.retirement - ctx.payRetirement.byGroup.retirement + ctx.earnersRetirement.reduce((t, e) => t + e.match, 0));
        lazy('retirementMonthly', () => ctx.ownRetirementMonthly + ctx.employerMatchMonthly);
        // Baby Step 4: 15% of the household's pay (every paycheck's gross).
        lazy('householdGross', () => (ctx.pay.household ? ctx.pay.household.wages : ctx.pay.sueldoAnual));
        lazy('savingsRate', () => ctx.householdGross > 0 ? ctx.ownRetirementMonthly * 12 / ctx.householdGross : 0);
        lazy('ownsHome', () => ctx.netWorth.fields.mortgage > 0.01 || (s.assets || []).some(a => a.category === 'Bienes Raíces' && Engine.assetOwned(a, s.activeYear)));
        lazy('steps', () => Engine.babySteps({
            liquid: ctx.ef.liquid, consumerDebt: ctx.debts.totalBalance, monthsCovered: ctx.ef.monthsCovered,
            savingsRate: ctx.savingsRate, mortgageBalance: ctx.netWorth.fields.mortgage, ownsHome: ctx.ownsHome, money: Fmt.money0
        }));
        lazy('retirementInputs', () => {
            const r = s.retirement;
            return {
                ...r,
                country: ctx.budgetYear.country, usTax: ctx.year.usTax,
                // What's already invested for retirement (see 'pools': beyond the emergency fund).
                ahorroActual: ctx.pools.invested,
                aporteMensual: ctx.retirementMonthly,
                tasaRetorno: r.tasaRetorno === null || r.tasaRetorno === undefined ? ctx.defaultReturn : r.tasaRetorno,
                inflacion: r.inflacion === null || r.inflacion === undefined ? Engine.DEFAULT_INFLATION[ctx.budgetYear.country] : r.inflacion,
                sueldoPromedio: r.sueldoPromedio === null || r.sueldoPromedio === undefined ? ctx.year.sueldo : r.sueldoPromedio,
                // The other earners' Social Security (US), from their own pay.
                name: ((s.members || [])[0] || {}).name || '',
                others: (ctx.pay.earners || []).map(e => ({ name: ((s.members || []).find(m => m.id === e.memberId) || {}).name || e.name, sueldoPromedio: e.sueldo }))
            };
        });
        // Long-run return when the person hasn't set one: US — the stock market's historical
        // average (~10%); Ecuador — savings keep their own DPF rate.
        lazy('defaultReturn', () => (ctx.budgetYear.country === 'US' ? Engine.DEFAULT_RETURN.US : ctx.year.tasa));
        lazy('retirement', () => Engine.retirement(ctx.retirementInputs));
        lazy('cosede', () => Engine.cosedeCheck(s.polizas, s.cooperativas, ctx.year.cosede));
        return ctx;
    }

    // --------------------------------------------------------------- router
    function currentKey() {
        const t = tabs.find(x => x.id === Store.ui.tab) || tabs[0];
        return t.subviews ? `${t.id}/${Store.ui.sub[t.id] || t.subviews[0].id}` : t.id;
    }

    function go(target, opts = {}) {
        const [tabId, subId] = String(ALIASES[target] || target).split('/');
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
        Store.ui.tab = tabId;
        if (tab.subviews) Store.ui.sub[tabId] = subId && tab.subviews.some(v => v.id === subId) ? subId : (Store.ui.sub[tabId] || tab.subviews[0].id);
        const hash = '#' + currentKey();
        if (location.hash !== hash) history.replaceState(null, '', hash);
        UI.$$('[data-tab]').forEach(sec => sec.classList.toggle('hidden', sec.dataset.tab !== tabId));
        document.getElementById('cfg-gear')?.classList.toggle('active', tabId === 'config');
        UI.$$('#main-nav [data-goto]').forEach(b => {
            const on = b.dataset.goto.split('/')[0] === tabId;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        if (tab.subviews) {
            const sub = Store.ui.sub[tabId];
            UI.$$(`[data-tab="${tabId}"] > [data-view]`).forEach(v => v.classList.toggle('hidden', v.dataset.view !== sub));
            UI.$$(`[data-tab="${tabId}"] .tab-segmented [data-goto]`).forEach(b => {
                const on = b.dataset.goto === `${tabId}/${sub}`;
                b.classList.toggle('active', on);
                if (on && b.scrollIntoView && opts.scroll !== false) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
            });
        }
        render();
        if (opts.scroll !== false) window.scrollTo({ top: 0 });
        if (opts.focus) { const el = document.getElementById(opts.focus); if (el) { for (let d = el.tagName === 'DETAILS' ? el : el.closest('details'); d; d = d.parentElement && d.parentElement.closest('details')) d.open = true; el.scrollIntoView({ block: el.offsetHeight > window.innerHeight * 0.5 ? 'start' : 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
        // A new screen shows the + button, wherever it opens.
        fabY = window.scrollY;
        document.documentElement.classList.remove('fab-away');
    }
    let fabY = 0;

    function buildNav() {
        const nav = document.getElementById('main-nav');
        nav.innerHTML = tabs.filter(t => t.nav !== false).map((t, i) => `
            <button type="button" class="nav-tab" data-goto="${t.id}" role="tab">
                <i class="fa-solid ${t.icon}"></i><span class="nav-num">${i + 1}</span><span>${t.label}</span>
            </button>`).join('');
        tabs.forEach(t => {
            if (!t.subviews) return;
            const host = document.querySelector(`[data-tab="${t.id}"] .tab-segmented`);
            if (host) host.innerHTML = t.subviews.map(v => `<button type="button" data-goto="${t.id}/${v.id}"><i class="fa-solid ${v.icon}"></i> ${v.label}</button>`).join('');
        });
    }

    // ------------------------------------------------------------ rendering
    function renderGlobals() {
        const s = Store.state;
        const c = Fmt.setCurrency(s.settings.currency);
        UI.$$('.cur').forEach(el => { el.textContent = c.symbol; });
        const sel = document.getElementById('global-year-select');
        if (sel.options.length !== s.configEndYear - s.configStartYear + 1 || Number(sel.options[0]?.value) !== s.configStartYear) {
            sel.innerHTML = '';
            for (let y = s.configStartYear; y <= s.configEndYear; y++) sel.add(new Option(y, y));
        }
        sel.value = s.activeYear;
        UI.$$('.active-year').forEach(el => { el.textContent = s.activeYear; });
        UI.$$('.range-label').forEach(el => { el.textContent = `${s.configStartYear} – ${s.configEndYear}`; });
        UI.$$('.end-year').forEach(el => { el.textContent = s.configEndYear; });
    }

    function render() {
        renderGlobals();
        UI.show('sample-banner', !!Store.state.settings.sample);
        // Your own plan, not yet encrypted: ask for a passcode (the example family isn't yours).
        UI.show('protect-banner', !Store.state.settings.sample && window.Device && Device.protectDue());
        const key = currentKey();
        const section = document.querySelector(`[data-tab="${Store.ui.tab}"]`);
        fillBindings(section);
        const v = views[key];
        const ctx = buildContext();
        if (v && v.render) v.render(ctx);
        else if (v && v.update) v.update(ctx);
    }

    function update() {
        const v = views[currentKey()];
        if (!v) return;
        const ctx = buildContext();
        (v.update || v.render)(ctx);
    }

    // ------------------------------------------------------------ undo / redo
    // Every change can be undone from the header (or Ctrl+Z). The history holds snapshots of
    // the whole saved state; quick successive changes (typing a number, dragging a slider)
    // are grouped into one step, so "Deshacer" goes back one action, not one keystroke.
    const HISTORY_MAX = 40, GROUP_MS = 800;
    const hist = { past: [], future: [], committed: null, base: null, timer: null, field: null };
    // Snapshots leave out the saved baselines (full copies of the plan, managed in Configuración):
    // keeping them in every step multiplied the memory used with a long history.
    const snapshot = () => JSON.stringify(Object.assign({}, Store.state, { baselines: undefined }));

    // Grouping only continues while the same field is being edited: any other action first
    // closes the pending step (before it changes anything, so steps never blur together).
    UI.beforeAction = (source) => { if (hist.base !== null && source !== hist.field) commitHistory(); };

    function recordChange() {
        hist.field = UI.source;
        if (hist.base === null) hist.base = hist.committed;
        clearTimeout(hist.timer);
        hist.timer = setTimeout(commitHistory, GROUP_MS);
        renderHistoryButtons();
    }

    function commitHistory() {
        clearTimeout(hist.timer);
        const now = snapshot();
        if (hist.base !== null && hist.base !== now) {
            hist.past.push(hist.base);
            if (hist.past.length > HISTORY_MAX) hist.past.shift();
            hist.future = [];
        }
        hist.committed = now;
        hist.base = null;
        renderHistoryButtons();
    }

    function restore(snap) {
        const ui = Store.state.activeYear, baselines = Store.state.baselines;
        Store.state = Store.migrate(JSON.parse(snap));
        Store.state.baselines = baselines;
        Store.year(Store.state.activeYear || ui);
        hist.committed = snapshot();
        dismissUndo();
        Store.scheduleSave();
        render();
        renderHistoryButtons();
    }

    function undo() {
        commitHistory();
        if (!hist.past.length) { UI.toast('Nothing to undo.', 'error'); return; }
        hist.future.push(hist.committed);
        restore(hist.past.pop());
        UI.toast('Change undone', 'ok', { label: 'Redo', className: 'toast-undo', onClick: redo });
    }

    function redo() {
        commitHistory();
        if (!hist.future.length) { UI.toast('Nothing to redo.', 'error'); return; }
        hist.past.push(hist.committed);
        restore(hist.future.pop());
        UI.toast('Change redone');
    }

    function renderHistoryButtons() {
        const u = document.getElementById('hist-undo'), r = document.getElementById('hist-redo');
        if (u) u.disabled = !(hist.past.length || (hist.base !== null && hist.base !== hist.committed));
        if (r) r.disabled = !hist.future.length || hist.base !== null;
    }

    // Called after every mutation. { step: true } makes this change its own undo step
    // (buttons like "Agregar"), instead of grouping it with changes that follow quickly.
    // Any new change also dismisses a pending "Deshacer" toast (the header button remains).
    // This calendar year's net worth follows the accounts, CDs, investments and debts on its own
    // (no "pull in" button to remember). Fields with no source keep what the person typed.
    // A goal linked to a savings account shows that account's balance as what's saved.
    function syncGoals() {
        const s = Store.state;
        (s.goals || []).forEach(g => {
            const a = g.accountId && (s.accounts || []).find(x => x.id === g.accountId);
            if (a) g.current = Math.max(0, Math.round((Number(a.balance) || 0) * 100) / 100);
        });
    }

    function syncNetWorth() {
        const s = Store.state, y = new Date().getFullYear();
        if (y < s.configStartYear || y > s.configEndYear) return;
        const want = Engine.netWorthFromSources({ polizas: s.polizas, holdings: s.holdings, accounts: s.accounts, debts: s.debts });
        const keys = Object.keys(want);
        if (!keys.length) return;
        const yd = Store.year(y), nw = yd.netWorth, touched = yd.netWorthTouched || (yd.netWorthTouched = {});
        keys.forEach(k => { const v = Math.round(want[k] * 100) / 100; if (Math.abs((Number(nw[k]) || 0) - v) > 0.004 || !touched[k]) { nw[k] = v; touched[k] = true; } });
    }

    // Each change keeps this month's net worth (so a month-by-month line builds up on its own)
    // and notices milestones reached: the first time, everything already true is just recorded;
    // after that, a new one is dated and celebrated.
    function trackProgress() {
        const s = Store.state, t = new Date(), y = t.getFullYear();
        if (y < s.configStartYear || y > s.configEndYear) return;
        const nw = Engine.netWorth(s.years, s.assets, y);
        if (nw.assets > 0 || nw.liabilities > 0) {
            // Each account's value too, for the month's gains and losses.
            const hub = Engine.accountsHub({ accounts: s.accounts, holdings: s.holdings, polizas: s.polizas, assets: s.assets, debts: s.debts, years: s.years, year: y });
            s.netWorthHistory = Engine.recordNetWorthMonth(s.netWorthHistory, Engine.isoDate(t).slice(0, 7), nw, Engine.hubItems(hub));
        }
        const ctx = buildContext();
        const list = Engine.milestones({ netWorth: nw.value, liquid: ctx.ef.liquid, monthsCovered: ctx.ef.monthsCovered, debts: s.debts, money: Fmt.money0 });
        const first = !s.milestones;
        const got = s.milestones || (s.milestones = {});
        const fresh = [];
        const seed = s.settings.milestonesSeed || {};
        delete s.settings.milestonesSeed;
        list.forEach(m => {
            if (m.done && !got[m.key]) { got[m.key] = first ? seed[m.key] || 'antes' : Engine.isoDate(t); if (!first) fresh.push(m); }
            else if (!m.done && got[m.key]) delete got[m.key];
        });
        if (fresh.length) setTimeout(() => UI.toast(`🎉 Milestone! ${fresh.map(m => m.label).join(' · ')}`, 'ok'), 400);
    }

    function changed(opts = {}) {
        if (!opts.keepUndo) dismissUndo();
        syncGoals();
        syncNetWorth();
        trackProgress();
        recordChange();
        if (opts.step) commitHistory();
        Store.scheduleSave();
        if (opts.structural) render(); else update();
    }

    const dismissUndo = () => UI.$$('.toast-undo').forEach(t => t.remove());

    // Deletions are instant and reversible instead of guarded by "are you sure?" pop-ups:
    // apply, and offer "Deshacer" right there (it's also in the header).
    function undoable(message, mutate) {
        dismissUndo();
        commitHistory();
        mutate();
        changed({ structural: true, keepUndo: true, step: true });
        UI.toast(message, 'ok', { label: 'Undo', className: 'toast-undo', onClick: undo });
    }

    function renderSaveStatus(status) {
        const el = document.getElementById('save-status');
        if (!el) return;
        if (status.error) {
            el.className = 'save-status save-error';
            el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span class="hidden sm:inline">Couldn\'t save</span>';
            el.title = status.error;
        } else if (status.lastSavedAt) {
            el.className = 'save-status';
            el.innerHTML = '<i class="fa-solid fa-circle-check"></i><span class="hidden sm:inline">Saved</span>';
            el.title = 'Saved automatically in this browser at ' + status.lastSavedAt.toLocaleTimeString('es-EC');
        }
    }

    // ------------------------------------------------------------- actions
    UI.register({
        'bind': (el) => { writeBound(el); changed({ structural: el.dataset.structural === 'true' }); },
        'app.setYear': (el) => {
            Store.state.activeYear = Number(el.value);
            Store.year(Store.state.activeYear);
            changed({ structural: true });
        },
        'app.print': () => window.print(),
        'app.undo': () => undo(),
        'app.redo': () => redo(),
        // Leave the example family for an empty plan of your own (undoable).
        'app.startOwn': async () => {
            const ok = await UI.confirm({ title: 'Start with my own data', message: 'The example family is removed and you start with an empty plan. You can see the example again from Settings.', confirmText: 'Start' });
            if (!ok) return;
            commitHistory();
            Store.reset('empty');
            Store.state.settings.welcomeDismissed = true;
            Store.ui.month = 'base';
            changed({ structural: true, step: true });
            go('presupuesto/ingresos');
        },
        // "Ahora no" on a next move: hide it for two weeks.
        'moves.snooze': (el) => {
            const d = new Date(); d.setDate(d.getDate() + 14);
            const st = Store.state.settings;
            st.movesSnoozed = Object.assign({}, st.movesSnoozed, { [el.dataset.key]: Engine.isoDate(d) });
            changed({ step: true });
            UI.toast('Done: we\'ll remind you in 2 weeks.', 'ok', { label: 'Undo', className: 'toast-undo', onClick: undo });
        },
        'app.help': () => {
            go('config', { focus: 'cfg-guide' });
            const g = document.getElementById('cfg-guide');
            if (g) g.open = true;
        }
    });

    // With a PIN the saved plan is encrypted: the app starts once the PIN has opened it.
    function init() {
        if (root.Device && Device.whenReady) Device.whenReady(start); else start();
    }
    function start() {
        const E = root.APP_EDITION || {};
        if (E.appName) { UI.text('brand-title', E.appName); UI.text('brand-sub', E.appSub || ''); }
        Store.init(root.Device && Device.storage ? Device.storage() : undefined);
        syncGoals();
        syncNetWorth();
        trackProgress();
        hist.committed = snapshot();
        UI.initEvents();
        // Ctrl+Z / Ctrl+Y (⌘ on Mac). Inside a text box the browser's own undo for that box wins.
        document.addEventListener('keydown', (e) => {
            if (e.key && e.key.toLowerCase() === 'n' && !e.ctrlKey && !e.metaKey && !e.altKey && window.QuickEntry) {
                const t = e.target;
                const typing = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);
                if (!typing && !document.querySelector('.modal-backdrop:not(.hidden)') && !document.documentElement.classList.contains('app-locked')) { e.preventDefault(); QuickEntry.open(); }
                return;
            }
        });
        document.addEventListener('keydown', (e) => {
            if (!(e.ctrlKey || e.metaKey) || e.altKey) return;
            const k = e.key.toLowerCase();
            if (k !== 'z' && k !== 'y') return;
            const t = e.target;
            if (t && (t.tagName === 'TEXTAREA' || (t.tagName === 'INPUT' && !['checkbox', 'radio', 'button'].includes(t.type)))) return;
            if (document.querySelector('.modal-backdrop:not(.hidden)') || document.documentElement.classList.contains('app-locked')) return;
            e.preventDefault();
            if (k === 'y' || e.shiftKey) redo(); else undo();
        });
        // data-bind fields dispatch through the generic "bind" handler.
        UI.$$('[data-bind]').forEach(el => {
            const evt = (el.type === 'checkbox' || el.tagName === 'SELECT' || el.dataset.structural === 'true') ? 'data-change' : 'data-input';
            if (!el.hasAttribute(evt)) el.setAttribute(evt, 'bind');
        });
        document.addEventListener('click', (e) => {
            const g = e.target.closest('[data-goto]');
            if (!g) return;
            e.preventDefault();
            go(g.dataset.goto, { focus: g.dataset.focus });
        });
        buildNav();
        // Styles and charts come from the internet (the phone app carries its own copy,
        // APP_EDITION.offline); say so plainly if they didn't load.
        UI.show('offline-banner', typeof Chart === 'undefined' || (typeof tailwind === 'undefined' && !APP_EDITION.offline));
        Store.onChange(renderSaveStatus);
        // The + button steps aside while you scroll down (it would cover amounts at the right edge
        // of a list) and comes back as soon as you scroll up or reach the top.
        fabY = window.scrollY;
        window.addEventListener('scroll', () => {
            const y = window.scrollY;
            if (Math.abs(y - fabY) < 8 && y > 80) return;
            document.documentElement.classList.toggle('fab-away', y > fabY && y > 80);
            fabY = y;
        }, { passive: true });
        window.addEventListener('beforeunload', () => Store.saveNow());
        document.addEventListener('visibilitychange', () => { if (document.hidden) Store.saveNow(); });
        // "#rapido" (a bookmark or home-screen shortcut) opens quick entry straight away.
        const quickLink = () => location.hash === '#rapido' && window.QuickEntry;
        window.addEventListener('hashchange', () => {
            if (quickLink()) { history.replaceState(null, '', '#' + currentKey()); QuickEntry.open(); return; }
            const h = location.hash.slice(1); if (h && h !== currentKey()) go(h, { scroll: false });
        });
        const start = location.hash.slice(1);
        const openQuick = !!quickLink();
        go(tabs.some(t => t.id === String(ALIASES[start] || start).split('/')[0]) ? start : 'resumen', { scroll: false });
        if (openQuick && !document.documentElement.classList.contains('app-locked')) QuickEntry.open();
        else if (openQuick) Store.ui.quickAfterUnlock = true;
        // Post repeating transactions that came due since the app was last opened.
        if (window.Recurring) window.Recurring.maintain();
        // Investment prices once a day (when set up in Settings → Prices).
        if (window.Prices) window.Prices.daily();
        document.addEventListener('visibilitychange', () => { if (document.hidden) return; if (window.Recurring) window.Recurring.maintain(); if (window.Prices) window.Prices.daily(); });
        renderSaveStatus({ lastSavedAt: new Date(), error: null });
        // A fresh install opens the setup guide once (browser tests open it themselves).
        if (window.Setup && !openQuick && !navigator.webdriver && !document.documentElement.classList.contains('app-locked')) Setup.maybeOpen();
    }

    root.App = {
        tabs, views,
        defineView(key, def) { views[key] = def; },
        go, render, update, changed, undoable, undo, redo, commitHistory, init, buildContext, fillBindings
    };

    document.addEventListener('DOMContentLoaded', init);
})(this);
