/* Ingresos → Impuestos de tus ingresos extra: freelance / small-business income of the last 12
 * months (minus its business expenses) and how much of it to set aside for taxes
 * (Engine.sideIncomeTaxes), person by person: each one's self-employment tax, and income tax on the
 * joint return or their own. US: self-employment + income tax + state, and the quarterly due dates. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const SIDE = 'Ingresos Independientes', BIZ = 'Negocio Propio / Freelance';

    // Side income of the last 12 months, person by person: income under SIDE by whose it is (none,
    // the household or the first person = the main earner), each one's business expenses off their
    // own (expenses of someone with no side income go to whoever earns the most of it).
    function facts(ctx) {
        const s = ctx.state, t = ctx.today;
        const since = Engine.isoDate(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1)), month = Engine.isoDate(t).slice(0, 7);
        const inc = s.transactions.filter(x => x.type === 'Ingreso' && x.parentCategory === SIDE && x.date >= since);
        const exp = s.transactions.filter(x => (x.type || 'Gasto') === 'Gasto' && x.parentCategory === BIZ && x.date >= since);
        const members = s.members || [], main = members[0];
        const keyOf = (x) => (members.some(m => m.id === x.memberId) && x.memberId !== (main && main.id) ? x.memberId : 0);
        const by = {};
        const person = (k) => by[k] || (by[k] = { memberId: k || null, name: k ? (members.find(m => m.id === k) || {}).name : (main ? main.name : ''), income: 0, expenses: 0, thisMonth: 0, count: 0 });
        inc.forEach(x => { const p = person(keyOf(x)); p.income += Number(x.amount) || 0; p.count++; if (x.date.startsWith(month)) p.thisMonth += Number(x.amount) || 0; });
        const earning = Object.values(by).sort((a, b) => b.income - a.income);
        exp.forEach(x => { const p = by[keyOf(x)] || earning[0]; if (p) p.expenses += Engine.spendAmount(x); });
        const people = earning.map(p => Object.assign(p, { net: Math.max(0, p.income - p.expenses) }));
        const total = (k) => people.reduce((a, p) => a + p[k], 0);
        const expenses = exp.reduce((a, x) => a + Engine.spendAmount(x), 0);
        return { people, income: total('income'), expenses, net: total('net'), thisMonth: total('thisMonth'), count: inc.length,
            other: people.length === 1 && people[0].memberId ? members.find(m => m.id === people[0].memberId) : null };
    }

    function quarterly(today) {
        const y = today.getFullYear();
        const dues = [[y, 3, 15], [y, 5, 15], [y, 8, 15], [y + 1, 0, 15]].map(([yy, m, d]) => new Date(yy, m, d));
        return dues.find(d => d >= today) || new Date(y + 1, 3, 15);
    }

    // Each person's estimate: US on the joint return or their own (Engine.sideIncomeTaxes);
    // Ecuador taxes each person separately (the main earner's on top of their salary).
    function taxes(ctx, f) {
        const p = ctx.pay, yd = ctx.year;
        if (p.country === 'US') return Engine.sideIncomeTaxes({ yd, pay: p, people: f.people, stateRate: p.stateRate, typedSpouseWages: (yd.withholding || {}).spouseWages });
        return f.people.map(x => Engine.sideIncomeTax({ country: 'EC', net: x.net, yd, ecBase: x.memberId ? 0 : p.baseImponible }));
    }

    function render(ctx) {
        if (!document.getElementById('inc-side')) return;
        const f = facts(ctx), p = ctx.pay, yd = ctx.year, us = p.country === 'US';
        if (!f.count) { UI.html('inc-side', `<p class="help">When you log income under «${esc(SIDE)}» (gigs, sales, professional fees), you'll see here how much to set aside for taxes.</p>`); return; }
        const each = taxes(ctx, f);
        const add = (get) => each.reduce((a, r) => a + (get(r) || 0), 0);
        const r = { total: add(x => x.total), parts: { se: add(x => x.parts.se), fed: add(x => x.parts.fed), state: add(x => x.parts.state) } };
        const pct = f.net > 0 ? Math.round(r.total / f.net * 100) : 0;
        const parts = us ? `autoempleo ${money0(r.parts.se)} + federal ${money0(r.parts.fed)}${r.parts.state ? ` + estatal ${money0(r.parts.state)}` : ''}` : `income tax at your rate`;
        const due = quarterly(ctx.today);
        const joint = us && !!(p.household && p.household.joint);
        // Whose return it goes on (someone other than the main earner).
        const whose = (x) => (!x.memberId ? '' : joint ? 'On your joint return.' : us ? 'On their own return, as single.' : 'Files separately.');
        const byPerson = f.people.length > 1 ? `<div class="table-wrap mt-3"><table class="table"><thead><tr><th style="min-width:9rem">Person</th><th class="num">Side income</th><th class="num">Estimated taxes</th><th class="num">Set aside</th></tr></thead><tbody>${f.people.map((x, i) => `<tr>
                <td><span class="font-semibold" data-i18n-skip>${esc(x.name || '')}</span>${whose(x) ? `<div class="text-[11px] text-slate-500">${whose(x)}</div>` : ''}</td>
                <td class="num whitespace-nowrap">${money0(x.net)}</td><td class="num whitespace-nowrap">${money0(each[i].total)}</td><td class="num">${Math.round(each[i].pct * 100)}%</td></tr>`).join('')}</tbody></table></div>`
            : f.other ? `<p class="text-xs mt-3"><span>Calculated for</span> <strong data-i18n-skip>${esc(f.other.name)}</strong>. <span>${whose(f.people[0])}</span></p>` : '';
        UI.html('inc-side', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="kpi tone-slate"><span class="kpi-label">Side income (12 months)</span><span class="kpi-value">${money0(f.net)}</span><span class="kpi-note">${money0(f.income)} received − ${money0(f.expenses)} of business expenses</span></div>
                <div class="kpi tone-amber"><span class="kpi-label">Estimated taxes</span><span class="kpi-value">${money0(r.total)}</span><span class="kpi-note">${parts}</span></div>
                <div class="kpi tone-emerald"><span class="kpi-label">Set aside from each payment</span><span class="kpi-value">${pct}%</span><span class="kpi-note">${f.thisMonth ? `this month: ${money0(f.thisMonth * pct / 100)} of ${money0(f.thisMonth)}` : 'of what you\'re paid'}</span></div>
            </div>${byPerson}
            <p class="text-xs mt-3">${us
                ? `No one withholds taxes from this money. Pay them quarterly (next: <strong>${esc(Fmt.dayMonth ? Fmt.dayMonth(due) : due.toISOString().slice(0, 10))}</strong>, about ${money0(r.total / 4)}) or raise the withholding on your W-4 to cover them.`
                : '<span>It goes in the yearly income tax return. If clients withhold tax, that part is already paid; under RIMPE the calculation is different (on sales).</span>'}
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
