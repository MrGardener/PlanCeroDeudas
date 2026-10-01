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
        { id: 'resumen', label: 'Resumen', icon: 'fa-gauge-high' },
        { id: 'presupuesto', label: 'Presupuesto', icon: 'fa-wallet', subviews: [
            { id: 'plan', label: 'Presupuesto del Mes', icon: 'fa-table-list' },
            { id: 'ingresos', label: 'Ingresos e Impuestos', icon: 'fa-receipt' },
            { id: 'transacciones', label: 'Transacciones', icon: 'fa-cart-shopping' },
            { id: 'importar', label: 'Importar', icon: 'fa-file-import' },
            { id: 'reportes', label: 'Reportes', icon: 'fa-chart-pie' }
        ] },
        { id: 'metas', label: 'Deudas y Metas', icon: 'fa-bullseye' },
        { id: 'ahorro', label: 'Ahorro DPF', icon: 'fa-piggy-bank', subviews: [
            { id: 'proyeccion', label: 'Proyección', icon: 'fa-chart-area' },
            { id: 'polizas', label: 'Pólizas y Cooperativas', icon: 'fa-file-contract' }
        ] },
        { id: 'hipoteca', label: 'Hipoteca', icon: 'fa-house-chimney' },
        { id: 'jubilacion', label: 'Jubilación', icon: 'fa-person-cane' },
        { id: 'patrimonio', label: 'Patrimonio', icon: 'fa-scale-balanced' },
        { id: 'config', label: 'Configuración', icon: 'fa-gears' }
    ];
    const views = {};

    // ------------------------------------------------------------- bindings
    // Static form fields declare where their value lives: data-bind="scope.field".
    // Scopes: year (active year), retirement, mortgage, settings, debtPlan.
    function bindTarget(scope) {
        const s = Store.state;
        if (scope === 'year') return Store.active();
        return s[scope];
    }

    function readBound(el) {
        const [scope, field] = el.dataset.bind.split('.');
        const obj = bindTarget(scope);
        return obj ? obj[field] : undefined;
    }

    function writeBound(el) {
        const [scope, field] = el.dataset.bind.split('.');
        const obj = bindTarget(scope);
        if (!obj) return;
        let v;
        if (el.type === 'checkbox') v = el.checked;
        else if (el.type === 'number' || el.dataset.type === 'number') {
            v = Fmt.parseNum(el.value, 0);
            if (el.min !== '' && el.dataset.clamp !== 'false') v = Math.max(Number(el.min), v);
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
        lazy('ef', () => Engine.emergencyFund({ liquid: ctx.polizasCapital + ctx.netWorth.fields.savings, budgetBase: ctx.year.budgetBase }));
        // The payoff plan spends only what the budget assigns: each debt's own line, plus any
        // other "Pago deuda" rubro (which goes to the snowball target).
        lazy('debtExtraRubros', () => ctx.year.budgetBase.filter(i => i.type === 'Deuda').reduce((t, i) => t + (Number(i.real) || 0), 0));
        lazy('debts', () => Engine.debtPayoff(s.debts, s.debtPlan.strategy, ctx.debtExtraRubros));
        // Retirement savings = the budget's own savings rubros (not goal lines) + auto-sweep.
        // … plus retirement saved straight from the paycheck (401k, ahorro voluntario) and any employer match.
        lazy('retirementMonthly', () => ctx.year.budgetBase.filter(i => Engine.isSavingsItem(i)).reduce((t, i) => t + (Number(i.real) || 0), 0) + ctx.baseBudget.sweep + Engine.payDeductionsSummary(ctx.year).retirement);
        lazy('savingsRate', () => ctx.pay.sueldoAnual > 0 ? ctx.retirementMonthly * 12 / ctx.pay.sueldoAnual : 0);
        lazy('steps', () => Engine.babySteps({
            liquid: ctx.ef.liquid, consumerDebt: ctx.debts.totalBalance, monthsCovered: ctx.ef.monthsCovered,
            savingsRate: ctx.savingsRate, mortgageBalance: ctx.netWorth.fields.mortgage
        }));
        lazy('retirementInputs', () => {
            const r = s.retirement;
            return {
                ...r,
                ahorroActual: ctx.polizasCapital,
                aporteMensual: ctx.retirementMonthly,
                tasaRetorno: r.tasaRetorno === null || r.tasaRetorno === undefined ? ctx.year.tasa : r.tasaRetorno,
                sueldoPromedio: r.sueldoPromedio === null || r.sueldoPromedio === undefined ? ctx.year.sueldo : r.sueldoPromedio
            };
        });
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
        const [tabId, subId] = String(target).split('/');
        const tab = tabs.find(t => t.id === tabId);
        if (!tab) return;
        Store.ui.tab = tabId;
        if (tab.subviews) Store.ui.sub[tabId] = subId && tab.subviews.some(v => v.id === subId) ? subId : (Store.ui.sub[tabId] || tab.subviews[0].id);
        const hash = '#' + currentKey();
        if (location.hash !== hash) history.replaceState(null, '', hash);
        UI.$$('[data-tab]').forEach(sec => sec.classList.toggle('hidden', sec.dataset.tab !== tabId));
        UI.$$('#main-nav [data-goto]').forEach(b => {
            const on = b.dataset.goto.split('/')[0] === tabId;
            b.classList.toggle('active', on);
            b.setAttribute('aria-selected', on ? 'true' : 'false');
            if (on && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        });
        if (tab.subviews) {
            const sub = Store.ui.sub[tabId];
            UI.$$(`[data-tab="${tabId}"] [data-view]`).forEach(v => v.classList.toggle('hidden', v.dataset.view !== sub));
            UI.$$(`[data-tab="${tabId}"] .segmented [data-goto]`).forEach(b => b.classList.toggle('active', b.dataset.goto === `${tabId}/${sub}`));
        }
        render();
        if (opts.scroll !== false) window.scrollTo({ top: 0 });
        if (opts.focus) { const el = document.getElementById(opts.focus); if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 1600); } }
    }

    function buildNav() {
        const nav = document.getElementById('main-nav');
        nav.innerHTML = tabs.map((t, i) => `
            <button type="button" class="nav-tab" data-goto="${t.id}" role="tab">
                <i class="fa-solid ${t.icon}"></i><span class="nav-num">${i + 1}</span><span>${t.label}</span>
            </button>`).join('');
        tabs.forEach(t => {
            if (!t.subviews) return;
            const host = document.querySelector(`[data-tab="${t.id}"] .segmented`);
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
    const HISTORY_MAX = 60, GROUP_MS = 800;
    const hist = { past: [], future: [], committed: null, base: null, timer: null, field: null };

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
        const now = Store.serialize();
        if (hist.base !== null && hist.base !== now) {
            hist.past.push(hist.base);
            if (hist.past.length > HISTORY_MAX) hist.past.shift();
            hist.future = [];
        }
        hist.committed = now;
        hist.base = null;
        renderHistoryButtons();
    }

    function restore(snapshot) {
        const ui = Store.state.activeYear;
        Store.state = Store.migrate(JSON.parse(snapshot));
        Store.year(Store.state.activeYear || ui);
        hist.committed = Store.serialize();
        dismissUndo();
        Store.scheduleSave();
        render();
        renderHistoryButtons();
    }

    function undo() {
        commitHistory();
        if (!hist.past.length) { UI.toast('No hay nada que deshacer.', 'error'); return; }
        hist.future.push(hist.committed);
        restore(hist.past.pop());
        UI.toast('Cambio deshecho', 'ok', { label: 'Rehacer', className: 'toast-undo', onClick: redo });
    }

    function redo() {
        commitHistory();
        if (!hist.future.length) { UI.toast('No hay nada que rehacer.', 'error'); return; }
        hist.past.push(hist.committed);
        restore(hist.future.pop());
        UI.toast('Cambio rehecho');
    }

    function renderHistoryButtons() {
        const u = document.getElementById('hist-undo'), r = document.getElementById('hist-redo');
        if (u) u.disabled = !(hist.past.length || (hist.base !== null && hist.base !== hist.committed));
        if (r) r.disabled = !hist.future.length || hist.base !== null;
    }

    // Called after every mutation. { step: true } makes this change its own undo step
    // (buttons like "Agregar"), instead of grouping it with changes that follow quickly.
    // Any new change also dismisses a pending "Deshacer" toast (the header button remains).
    function changed(opts = {}) {
        if (!opts.keepUndo) dismissUndo();
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
        UI.toast(message, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: undo });
    }

    function renderSaveStatus(status) {
        const el = document.getElementById('save-status');
        if (!el) return;
        if (status.error) {
            el.className = 'save-status save-error';
            el.innerHTML = '<i class="fa-solid fa-triangle-exclamation"></i><span class="hidden sm:inline">No se pudo guardar</span>';
            el.title = status.error;
        } else if (status.lastSavedAt) {
            el.className = 'save-status';
            el.innerHTML = '<i class="fa-solid fa-circle-check"></i><span class="hidden sm:inline">Guardado</span>';
            el.title = 'Guardado automáticamente en este navegador a las ' + status.lastSavedAt.toLocaleTimeString('es-EC');
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
        'app.help': () => {
            go('config', { focus: 'cfg-guide' });
            const g = document.getElementById('cfg-guide');
            if (g) g.open = true;
        }
    });

    function init() {
        Store.init();
        hist.committed = Store.serialize();
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
        // Styles and charts come from the internet; say so plainly if they didn't load.
        UI.show('offline-banner', typeof Chart === 'undefined' || typeof tailwind === 'undefined');
        Store.onChange(renderSaveStatus);
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
        go(tabs.some(t => t.id === start.split('/')[0]) ? start : 'resumen', { scroll: false });
        if (openQuick && !document.documentElement.classList.contains('app-locked')) QuickEntry.open();
        else if (openQuick) Store.ui.quickAfterUnlock = true;
        // Post repeating transactions that came due since the app was last opened.
        if (window.Recurring) window.Recurring.maintain();
        document.addEventListener('visibilitychange', () => { if (!document.hidden && window.Recurring) window.Recurring.maintain(); });
        renderSaveStatus({ lastSavedAt: new Date(), error: null });
    }

    root.App = {
        tabs, views,
        defineView(key, def) { views[key] = def; },
        go, render, update, changed, undoable, undo, redo, commitHistory, init, buildContext, fillBindings
    };

    document.addEventListener('DOMContentLoaded', init);
})(this);
