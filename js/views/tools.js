/* Money tools: the Help grid behind the "?" of the tools bar (Overview). One tile per tool, each
   with a short how-to and a button that opens it. The bar itself is plain links in index.html. */
(function () {
    'use strict';
    const { esc } = Fmt;

    // [key, icon, title, where it opens (goto, focus), how-to sentences]
    const TOPICS = [
        ['accounts', 'fa-wallet', 'Accounts', ['patrimonio', 'acct-hub'], [
            'Add each checking, savings and credit card account with today\'s balance.',
            'Importing a statement into an account keeps its balance up to date; a card\'s balance is what you owe.']],
        ['transactions', 'fa-list-ul', 'Transactions', ['transacciones/lista', ''], [
            'Log what you spend with the + button, or import your bank\'s CSV / OFX file.',
            'Search, filter by month, category, person or where it came from; tap one to change it.']],
        ['spending', 'fa-chart-pie', 'Spending', ['transacciones/reportes', 'spend-card'], [
            'A donut of where the money went (or came from: Income), by category, for any dates; ‹ › step back and forward.',
            'Tap a category to select it, again to see its subcategories; tap the middle for the transactions.']],
        ['budgets', 'fa-circle-nodes', 'Budgets', ['presupuesto/plan', ''], [
            'Give every dollar a job: plan each line until what\'s left to assign is $0.',
            'Bubbles show each category: green on track, yellow almost spent, red over. Drag them around; tap one to change its budget or add a sub-budget.']],
        ['trends', 'fa-clock-rotate-left', 'Trends', ['transacciones/reportes', 'trends-card'], [
            'Spending by category month by month, with your income as a line.',
            'Pick 3, 6, 9 or 12 months, one category or one account.']],
        ['debts', 'fa-sack-dollar', 'Debts', ['futuro/metas', 'metas-debts'], [
            'List your debts smallest to largest and pay the minimums on all but the first.',
            'Every extra dollar goes to the first one; when it\'s gone, its payment rolls to the next (the snowball).']],
        ['networth', 'fa-chart-line', 'Net Worth', ['patrimonio', 'nw-sheet'], [
            'What you own minus what you owe, saved on its own every month.',
            'Pick 6 months, 9 months or a year; tap a month to see how much it changed and its gains & losses, account by account.']],
        ['goals', 'fa-bullseye', 'Goals', ['futuro/metas', 'metas-goals'], [
            'Save for something in cash: set the amount and the date, and the monthly amount goes into your budget.']],
        ['cashflow', 'fa-calendar-days', 'Cash Flow', ['resumen', 'dash-flow-card'], [
            'Your balance day by day for the next 30, 60 or 90 days: pay, bills and everyday spending.',
            'Add cash events (suggested from your payments, or by hand), once or repeating; pick which accounts count. Red means you\'d go below $0.']],
        ['alerts', 'fa-bell', 'Alerts', ['resumen', 'tools-bar'], [
            'The bell lists what needs a look: your balance going below $0 in the next 30 days, bills due in 3 days, budget lines over plan and unusually large purchases.',
            'Dismiss one with × and it won\'t come back; nothing is sent anywhere.']],
        ['general', 'fa-circle-info', 'General', ['config', 'cfg-guide'], [
            'Everything stays on this device: nothing is sent to a server.',
            'Download a backup now and then (Settings), and use Undo if you change something by mistake.']],
        ['mobile', 'fa-mobile-screen', 'Mobile', ['config', 'cfg-guide'], [
            'The phone app works offline. Set a PIN in Settings to lock it.',
            'Imports and backups use your phone\'s share and file pickers.']]
    ];

    function openHelp() {
        const sheet = UI.sheet({ title: 'Help', icon: 'fa-circle-question', wide: true, html: `<div class="help-grid">${TOPICS.map(t => `<button type="button" data-action="tools.topic" data-key="${t[0]}"><i class="fa-solid ${t[1]}"></i><span>${esc(t[2])}</span></button>`).join('')}</div>` });
        current = sheet;
    }
    let current = null;

    function openTopic(key) {
        const t = TOPICS.find(x => x[0] === key);
        if (!t || !current) return;
        current.el.querySelector('.modal-title span').textContent = I18n.t(t[2]);
        current.body.innerHTML = `${t[4].map(p => `<p class="text-sm mb-2">${esc(p)}</p>`).join('')}
            <div class="flex justify-between gap-2 mt-4"><button type="button" class="btn btn-secondary" data-action="tools.help" data-back="1"><i class="fa-solid fa-arrow-left"></i> Help home</button>
            <button type="button" class="btn btn-primary" data-action="tools.go" data-key="${t[0]}"><i class="fa-solid ${t[1]}"></i> Open</button></div>`;
    }

    // ------------------------------------------------------------------ alerts
    // What needs a look now (Engine.buildAlerts), minus the ones dismissed (settings.alertsDismissed).
    function alerts() {
        const s = Store.state, t = new Date();
        const ff = window.Cash && Cash.flowForecast(t, 30);
        const y = t.getFullYear(), m = String(t.getMonth() + 1);
        let lines = [];
        if (s.years[y]) {
            const items = Engine.monthItems(Store.effective(y), m), sp = Engine.lineSpend(items, s.transactions, y, m);
            lines = items.filter(i => !i.sweep && i.type !== 'Ingreso').map(i => ({ id: i.id, name: i.name, planned: Number(i.real) || 0, spent: (sp.byLine[String(i.id)] || { spent: 0 }).spent }));
        }
        const all = Engine.buildAlerts({ today: t, forecast: ff ? ff.days : [], buffer: ff ? ff.buffer : 0, bills: ff ? ff.events : [], lines, transactions: s.transactions });
        const gone = (s.settings && s.settings.alertsDismissed) || {};
        return all.filter(a => !gone[a.key]);
    }
    function updateBadge() {
        const n = alerts().length, b = document.getElementById('alerts-badge');
        if (!b) return;
        b.textContent = n > 9 ? '9+' : String(n);
        b.classList.toggle('hidden', n === 0);
    }
    const ALERT_ICON = { short: 'fa-triangle-exclamation text-red-600', low: 'fa-circle-exclamation text-amber-600', bill: 'fa-calendar-day text-amber-600', over: 'fa-chart-pie text-red-600', big: 'fa-magnifying-glass-dollar text-blue-600' };
    function alertText(a) {
        const day = (d) => esc(Fmt.dayMonth(new Date(d + 'T00:00:00')));
        switch (a.kind) {
            case 'short': return `Your balance would go below $0 on ${day(a.date)} (${Fmt.money0(a.amount)}).`;
            case 'low': return `Your balance would drop under your cushion on ${day(a.date)} (${Fmt.money0(a.amount)}).`;
            case 'bill': return `${esc(I18n.t(a.name))} is due ${day(a.date)}: ${Fmt.money(a.amount)}.`;
            case 'over': return `${esc(I18n.t(a.name))} is over budget by ${Fmt.money(a.amount)} this month.`;
            default: return `${esc(a.name || '')}: ${Fmt.money(a.amount)} on ${day(a.date)}, about ${Math.round(a.amount / a.usual)}× your usual in its category.`;
        }
    }
    const ALERT_GO = { short: ['resumen', 'dash-flow-card'], low: ['resumen', 'dash-flow-card'], bill: ['presupuesto/plan', ''], over: ['presupuesto/plan', ''], big: ['transacciones/lista', ''] };
    let alertSheet = null, alertList = [];
    function openAlerts() {
        alertList = alerts();
        alertSheet = UI.sheet({ title: 'Alerts', icon: 'fa-bell', html: alertList.length ? `<div class="alert-list">${alertList.map((a, i) => `<div class="alert-row" data-key="${esc(a.key)}">
                <i class="fa-solid ${ALERT_ICON[a.kind]}"></i>
                <button type="button" class="alert-text" data-action="tools.alertGo" data-i="${i}">${alertText(a)}</button>
                <button type="button" class="row-del" data-action="tools.alertDismiss" data-i="${i}" aria-label="Dismiss"><i class="fa-solid fa-xmark"></i></button></div>`).join('')}</div>
                <p class="help mt-2">Dismissed alerts don't come back. Alerts stay in the app: nothing is sent anywhere.</p>`
            : '<p class="text-sm"><i class="fa-solid fa-circle-check text-emerald-600"></i> All clear: nothing needs a look right now.</p>' });
    }

    UI.register({
        'tools.alerts': () => openAlerts(),
        'tools.alertGo': (el) => {
            const a = alertList[Number(el.dataset.i)];
            if (!a) return;
            if (alertSheet) { alertSheet.close(); alertSheet = null; }
            const g = ALERT_GO[a.kind];
            App.go(g[0], g[1] ? { focus: g[1] } : {});
            if (a.kind === 'big' && window.TxnDetails) TxnDetails.open(Number(a.key.slice(4)));
        },
        'tools.alertDismiss': (el) => {
            const a = alertList[Number(el.dataset.i)];
            if (!a) return;
            const st = Store.state.settings;
            st.alertsDismissed = Object.assign({}, st.alertsDismissed, { [a.key]: Engine.isoDate(new Date()) });
            Store.scheduleSave();
            const row = el.closest('.alert-row'); if (row) row.remove();
            updateBadge();
        },
        'tools.help': (el) => {
            if (el && el.dataset && el.dataset.back && current) { current.close(); }
            openHelp();
        },
        'tools.topic': (el) => openTopic(el.dataset.key),
        'tools.go': (el) => {
            const t = TOPICS.find(x => x[0] === el.dataset.key);
            if (current) { current.close(); current = null; }
            if (t) App.go(t[3][0], t[3][1] ? { focus: t[3][1] } : {});
        }
    });

    window.Tools = { openHelp, TOPICS, alerts, updateBadge };
})();
