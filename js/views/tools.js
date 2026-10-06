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
            'A donut of where the money went, by category, for a month or the last 3 / 6 months.',
            'Tap a slice to see its transactions.']],
        ['budgets', 'fa-circle-nodes', 'Budgets', ['presupuesto/plan', ''], [
            'Give every dollar a job: plan each line until what\'s left to assign is $0.',
            'Bubbles show each category: green on track, yellow almost spent, red over.']],
        ['trends', 'fa-clock-rotate-left', 'Trends', ['transacciones/reportes', 'trends-card'], [
            'Spending by category month by month, with your income as a line.',
            'Pick 3, 6, 9 or 12 months, one category or one account.']],
        ['debts', 'fa-sack-dollar', 'Debts', ['futuro/metas', 'metas-debts'], [
            'List your debts smallest to largest and pay the minimums on all but the first.',
            'Every extra dollar goes to the first one; when it\'s gone, its payment rolls to the next (the snowball).']],
        ['networth', 'fa-chart-line', 'Net Worth', ['patrimonio', 'nw-sheet'], [
            'What you own minus what you owe, saved on its own every month.',
            'Bars show what you own and owe; the line is your net worth.']],
        ['goals', 'fa-bullseye', 'Goals', ['futuro/metas', 'metas-goals'], [
            'Save for something in cash: set the amount and the date, and the monthly amount goes into your budget.']],
        ['cashflow', 'fa-calendar-days', 'Cash Flow', ['resumen', 'dash-flow-card'], [
            'Your balance day by day for the next 30, 60 or 90 days: pay, bills and everyday spending.',
            'Add one-off money coming in or going out; red means you\'d go below $0.']],
        ['alerts', 'fa-bell', 'Alerts', ['resumen', ''], [
            'The Overview warns you about bills due soon, days you\'d run short and lines over budget.']],
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

    UI.register({
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

    window.Tools = { openHelp, TOPICS };
})();
