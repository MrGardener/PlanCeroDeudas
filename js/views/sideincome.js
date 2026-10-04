/* Ingresos → Impuestos de tus ingresos extra: freelance / small-business income of the last 12
 * months (minus its business expenses) and how much of it to set aside for taxes
 * (Engine.sideIncomeTax). US: self-employment + income tax + state, and the quarterly due dates. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const SIDE = 'Ingresos Independientes', BIZ = 'Negocio Propio / Freelance';

    function facts(ctx) {
        const s = ctx.state, t = ctx.today;
        const since = Engine.isoDate(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1)), month = Engine.isoDate(t).slice(0, 7);
        const inc = s.transactions.filter(x => x.type === 'Ingreso' && x.parentCategory === SIDE && x.date >= since);
        const exp = s.transactions.filter(x => (x.type || 'Gasto') === 'Gasto' && x.parentCategory === BIZ && x.date >= since);
        const income = inc.reduce((a, x) => a + Number(x.amount), 0), expenses = exp.reduce((a, x) => a + Engine.spendAmount(x), 0);
        const thisMonth = inc.filter(x => x.date.startsWith(month)).reduce((a, x) => a + Number(x.amount), 0);
        // Who earns it (Ecuador taxes each person separately): when it's all someone other than
        // the main earner (the first person in the household), it isn't added to the salary.
        const members = s.members || [], main = members[0];
        const owners = [...new Set(inc.map(x => x.memberId).filter(Boolean))];
        const other = main && owners.length > 0 && !owners.includes(main.id) ? members.find(m => m.id === owners[0]) : null;
        return { income, expenses, net: Math.max(0, income - expenses), thisMonth, count: inc.length, other: owners.length === 1 ? other : null };
    }

    function quarterly(today) {
        const y = today.getFullYear();
        const dues = [[y, 3, 15], [y, 5, 15], [y, 8, 15], [y + 1, 0, 15]].map(([yy, m, d]) => new Date(yy, m, d));
        return dues.find(d => d >= today) || new Date(y + 1, 3, 15);
    }

    function render(ctx) {
        if (!document.getElementById('inc-side')) return;
        const f = facts(ctx), p = ctx.pay, yd = ctx.year, us = p.country === 'US';
        if (!f.count) { UI.html('inc-side', `<p class="help">When you log income under «${esc(SIDE)}» (gigs, sales, professional fees), you'll see here how much to set aside for taxes.</p>`); return; }
        const w = yd.withholding || {};
        const r = Engine.sideIncomeTax(us
            ? { country: 'US', net: f.net, yd, wages: p.sueldoAnual + (Number(w.spouseWages) || 0), taxableBefore: p.baseImponible + (Number(w.spouseWages) || 0), stateRate: p.stateRate }
            : { country: 'EC', net: f.net, yd, ecBase: f.other ? 0 : p.baseImponible });
        const pct = Math.round(r.pct * 100);
        const parts = us ? `autoempleo ${money0(r.parts.se)} + federal ${money0(r.parts.fed)}${r.parts.state ? ` + estatal ${money0(r.parts.state)}` : ''}` : `income tax at your rate`;
        const due = quarterly(ctx.today);
        UI.html('inc-side', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="kpi tone-slate"><span class="kpi-label">Side income (12 months)</span><span class="kpi-value">${money0(f.net)}</span><span class="kpi-note">${money0(f.income)} received − ${money0(f.expenses)} of business expenses</span></div>
                <div class="kpi tone-amber"><span class="kpi-label">Estimated taxes</span><span class="kpi-value">${money0(r.total)}</span><span class="kpi-note">${parts}</span></div>
                <div class="kpi tone-emerald"><span class="kpi-label">Set aside from each payment</span><span class="kpi-value">${pct}%</span><span class="kpi-note">${f.thisMonth ? `this month: ${money0(f.thisMonth * r.pct)} of ${money0(f.thisMonth)}` : 'of what you\'re paid'}</span></div>
            </div>
            <p class="text-xs mt-3">${us
                ? `No one withholds taxes from this money. Pay them quarterly (next: <strong>${esc(Fmt.dayMonth ? Fmt.dayMonth(due) : due.toISOString().slice(0, 10))}</strong>, about ${money0(r.total / 4)}) or raise the withholding on your W-4 to cover them.`
                : `${f.other ? `<span>Calculated as ${esc(f.other.name)}'s income, who files separately.</span> ` : ''}<span>It goes in the yearly income tax return. If clients withhold tax, that part is already paid; under RIMPE the calculation is different (on sales).</span>`}
                <button type="button" class="link" data-action="side.goal" data-amount="${Math.round(r.total)}">Set up a fund for these taxes</button></p>
            <p class="help mt-1">Estimated with your ${yd.taxTableYear || ctx.state.activeYear} tables. It counts your income under «${esc(SIDE)}» and your expenses under «${esc(BIZ)}».</p>`);
    }

    UI.register({
        // A savings goal that holds the tax money until it's paid.
        'side.goal': (el) => {
            const total = Number(el.dataset.amount) || 0;
            const name = window.I18n ? I18n.t('Taxes to pay') : 'Taxes to pay';
            const goals = Store.state.goals;
            if (goals.some(g => g.taxFund)) { UI.toast('You already have your tax fund in Debts & Goals.', 'warn'); return; }
            App.undoable(`Goal «${name}» created: ${money(total / 12)} a month in your budget`, () => {
                goals.push({ id: Store.nextId(goals), name, target: total, current: 0, monthly: Math.ceil(total / 12), rate: 0, createdYear: new Date().getFullYear(), taxFund: true });
            });
        }
    });

    window.SideIncome = { render, facts };
})();
