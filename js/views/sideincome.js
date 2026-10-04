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
        if (!f.count) { UI.html('inc-side', `<p class="help">Cuando registres ingresos en «${esc(SIDE)}» (trabajos por tu cuenta, ventas, honorarios), aquí verás cuánto apartar para impuestos.</p>`); return; }
        const w = yd.withholding || {};
        const r = Engine.sideIncomeTax(us
            ? { country: 'US', net: f.net, yd, wages: p.sueldoAnual + (Number(w.spouseWages) || 0), taxableBefore: p.baseImponible + (Number(w.spouseWages) || 0), stateRate: p.stateRate }
            : { country: 'EC', net: f.net, yd, ecBase: f.other ? 0 : p.baseImponible });
        const pct = Math.round(r.pct * 100);
        const parts = us ? `autoempleo ${money0(r.parts.se)} + federal ${money0(r.parts.fed)}${r.parts.state ? ` + estatal ${money0(r.parts.state)}` : ''}` : `impuesto a la renta a tu tasa`;
        const due = quarterly(ctx.today);
        UI.html('inc-side', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="kpi tone-slate"><span class="kpi-label">Ingreso extra (12 meses)</span><span class="kpi-value">${money0(f.net)}</span><span class="kpi-note">${money0(f.income)} cobrado − ${money0(f.expenses)} de gastos del negocio</span></div>
                <div class="kpi tone-amber"><span class="kpi-label">Impuestos estimados</span><span class="kpi-value">${money0(r.total)}</span><span class="kpi-note">${parts}</span></div>
                <div class="kpi tone-emerald"><span class="kpi-label">Aparta de cada cobro</span><span class="kpi-value">${pct}%</span><span class="kpi-note">${f.thisMonth ? `este mes: ${money0(f.thisMonth * r.pct)} de ${money0(f.thisMonth)}` : 'de lo que cobres'}</span></div>
            </div>
            <p class="text-xs mt-3">${us
                ? `Nadie te retiene impuestos de este dinero. Págalos por trimestre (próximo: <strong>${esc(Fmt.dayMonth ? Fmt.dayMonth(due) : due.toISOString().slice(0, 10))}</strong>, unos ${money0(r.total / 4)}) o súbele a tu retención en el W-4 para cubrirlos.`
                : `${f.other ? `<span>Calculado como ingreso de ${esc(f.other.name)}, que declara por separado.</span> ` : ''}<span>Va en la declaración anual del impuesto a la renta. Si los clientes hacen retención, esa parte ya está pagada; en el RIMPE el cálculo es distinto (sobre las ventas).</span>`}
                <button type="button" class="link" data-action="side.goal" data-amount="${Math.round(r.total)}">Crear un apartado para estos impuestos</button></p>
            <p class="help mt-1">Estimado con tus tablas de ${yd.taxTableYear || ctx.state.activeYear}. Cuenta tus ingresos en «${esc(SIDE)}» y tus gastos en «${esc(BIZ)}».</p>`);
    }

    UI.register({
        // A savings goal that holds the tax money until it's paid.
        'side.goal': (el) => {
            const total = Number(el.dataset.amount) || 0;
            const name = window.I18n ? I18n.t('Impuestos por pagar') : 'Impuestos por pagar';
            const goals = Store.state.goals;
            if (goals.some(g => g.taxFund)) { UI.toast('Ya tienes tu apartado de impuestos en Deudas y Metas.', 'warn'); return; }
            App.undoable(`Meta «${name}» creada: ${money(total / 12)} al mes en tu presupuesto`, () => {
                goals.push({ id: Store.nextId(goals), name, target: total, current: 0, monthly: Math.ceil(total / 12), rate: 0, createdYear: new Date().getFullYear(), taxFund: true });
            });
        }
    });

    window.SideIncome = { render, facts };
})();
