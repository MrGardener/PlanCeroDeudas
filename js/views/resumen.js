/* Resumen: one-glance dashboard — your current Baby Step, key numbers and alerts. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    function hero(ctx) {
        const st = ctx.steps, ef = ctx.ef, debts = ctx.debts;
        const s = ctx.state;
        let title, text, cta, goto, focus;
        switch (st.current) {
            case 1:
                title = 'Paso 1: Junta tu fondo de emergencia inicial';
                text = `Reúne $1,000 para imprevistos antes de atacar tus deudas. Hoy tienes ${money0(ef.liquid)} disponibles.`;
                cta = 'Ver mi fondo de emergencia'; goto = 'metas'; focus = 'metas-ef'; break;
            case 2:
                title = 'Paso 2: Sal de deudas con la Bola de Nieve';
                text = debts.never
                    ? `Debes ${money0(debts.totalBalance)} y con los pagos actuales nunca terminarías. Sube tu pago extra.`
                    : `Debes ${money0(debts.totalBalance)} en ${s.debts.filter(d => Number(d.balance) > 0).length} deuda(s). Con tu plan quedas libre en ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}.`;
                cta = 'Ir a mi plan de deudas'; goto = 'metas'; focus = 'metas-debts'; break;
            case 3:
                title = 'Paso 3: Completa tu fondo de emergencia';
                text = `Junta de 3 a 6 meses de gastos esenciales (${money0(ef.monthlyEssential)}/mes). Llevas ${ef.monthsCovered.toFixed(1)} meses cubiertos.`;
                cta = 'Ver mi fondo de emergencia'; goto = 'metas'; focus = 'metas-ef'; break;
            case 4:
                title = 'Pasos 4–6: Invierte, ahorra para tus hijos y paga tu casa';
                text = `Ahorras el ${(ctx.savingsRate * 100).toFixed(0)}% de tu sueldo (meta: 15%). Tu jubilación estimada: ${money0(ctx.retirement.ingresoTotal)}/mes.`;
                cta = 'Ver mi jubilación'; goto = 'jubilacion'; break;
            default:
                title = 'Paso 7: Construye riqueza y da con generosidad';
                text = `Tu patrimonio neto en ${s.activeYear} es ${money0(ctx.netWorth.value)}. Sigue invirtiendo y ayudando a otros.`;
                cta = 'Ver mi patrimonio'; goto = 'patrimonio';
        }
        return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div><div class="hero-kicker">Tu siguiente paso</div><div class="hero-title">${title}</div><p class="hero-text">${text}</p></div>
            <button type="button" class="btn btn-primary shrink-0" data-goto="${goto}" ${focus ? `data-focus="${focus}"` : ''}>${cta} <i class="fa-solid fa-arrow-right"></i></button>
        </div>`;
    }

    function alerts(ctx) {
        const s = ctx.state, out = [];
        const add = (tone, icon, html, goto) => out.push(`<button type="button" class="alert-item w-full text-left ${tone}" data-goto="${goto}"><i class="fa-solid ${icon} mt-0.5"></i><span>${html}</span></button>`);

        ctx.cosede.filter(c => c.exceeded).forEach(c => add('tone-red', 'fa-shield-halved text-red-600', `<strong>${esc(c.name)}</strong> supera la cobertura COSEDE (${money0(c.total)} de ${money0(c.limit)}).`, 'ahorro/polizas'));
        s.polizas.forEach(p => {
            const m = Engine.maturityStatus(p.maturityDate, ctx.today);
            if (m && m.kind === 'vencida') add('tone-amber', 'fa-calendar-xmark text-amber-600', `Póliza <strong>${esc(p.number)}</strong> vencida: renuévala o registra dónde está ese dinero.`, 'ahorro/polizas');
            else if (m && m.kind === 'pronto') add('tone-amber', 'fa-calendar-day text-amber-600', `Póliza <strong>${esc(p.number)}</strong> vence en ${m.days} días.`, 'ahorro/polizas');
        });
        const bal = ctx.baseBudget.balanceReal;
        if (bal < -0.005) add('tone-red', 'fa-scale-unbalanced text-red-600', `Tu presupuesto base supera tu ingreso neto por <strong>${money(-bal)}</strong>.`, 'presupuesto/plan');
        else if (bal > 0.005) add('tone-amber', 'fa-coins text-amber-600', `Tienes <strong>${money(bal)}</strong> al mes sin asignar en tu presupuesto base.`, 'presupuesto/plan');

        // Over-budget categories this calendar month (only meaningful for the current year).
        if (s.activeYear === ctx.today.getFullYear()) {
            const m = String(ctx.today.getMonth() + 1);
            const over = Engine.monthItems(ctx.year, m).filter(it => {
                const spent = Engine.categorySpend(s.transactions, it.linkedCategory, s.activeYear, m);
                return spent !== null && Engine.spendStatus(spent, Number(it.prep) || 0).kind === 'over';
            });
            if (over.length) add('tone-red', 'fa-cart-shopping text-red-600', `Este mes te pasaste en: <strong>${over.map(i => esc(i.name)).join(', ')}</strong>.`, 'presupuesto/plan');
        }
        const sync = Views.netWorthSync(ctx);
        if (sync) add('tone-blue', 'fa-scale-balanced text-teal-600', `Tu patrimonio ${s.activeYear} no refleja tus pólizas (${money0(sync.polizas)}) y deudas (${money0(sync.debts)}) registradas.`, 'patrimonio');
        if (ctx.debts.never && ctx.debts.totalBalance > 0) add('tone-red', 'fa-snowplow text-red-600', 'Con tus pagos actuales una deuda nunca termina de pagarse.', 'metas');
        const p = ctx.pay;
        if (p.sriCap > 0 && p.deductibles.real < p.sriCap * 0.8) add('tone-blue', 'fa-file-invoice-dollar text-blue-600', `Podrías deducir <strong>${money0(p.sriCap - p.deductibles.real)}</strong> más en gastos personales y pagar menos impuesto.`, 'presupuesto/ingresos');

        return out.length ? out.join('') : '<div class="alert-item tone-emerald"><i class="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i><span>Todo en orden. ¡Buen trabajo!</span></div>';
    }

    function update(ctx) {
        const s = ctx.state;
        UI.html('dash-hero', hero(ctx));
        UI.html('dash-steps', Views.stepsHTML(ctx, { compact: true }));

        const bb = ctx.baseBudget, debts = ctx.debts, ef = ctx.ef, r = ctx.retirement;
        const balNote = Math.abs(bb.balanceReal) < 0.005 ? '✓ Base cero: cada dólar asignado' : bb.balanceReal > 0 ? `${money(bb.balanceReal)} sin asignar` : `${money(-bb.balanceReal)} de más`;
        UI.html('dash-kpis', [
            Views.kpiCard({ tone: 'text-emerald-600', icon: 'fa-wallet', label: 'Ingreso neto mensual', value: money(bb.income), note: `Asignado: ${money(bb.expReal + bb.sweep)} · ${balNote}`, goto: 'presupuesto/plan' }),
            Views.kpiCard({ tone: 'text-red-600', icon: 'fa-snowplow', label: 'Deudas de consumo', value: money0(debts.totalBalance), note: debts.totalBalance <= 0 ? '¡Sin deudas!' : debts.never ? 'Nunca terminas: sube el pago' : `Libre en ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}`, goto: 'metas', focus: 'metas-debts' }),
            Views.kpiCard({ tone: 'text-emerald-600', icon: 'fa-shield-heart', label: 'Fondo de emergencia', value: money0(ef.liquid), note: `${ef.monthsCovered.toFixed(1)} meses de gastos esenciales cubiertos`, goto: 'metas', focus: 'metas-ef' }),
            Views.kpiCard({ tone: 'text-amber-500', icon: 'fa-piggy-bank', label: 'Ahorro DPF', value: money0(ctx.polizasCapital), note: `Proyección a ${s.configEndYear}: ${money0(ctx.projection.finalBalance)}`, goto: 'ahorro/proyeccion' }),
            Views.kpiCard({ tone: 'text-teal-600', icon: 'fa-scale-balanced', label: `Patrimonio neto ${s.activeYear}`, value: money0(ctx.netWorth.value), note: `Activos ${money0(ctx.netWorth.assets)} · Pasivos ${money0(ctx.netWorth.liabilities)}`, goto: 'patrimonio' }),
            Views.kpiCard({ tone: 'text-indigo-600', icon: 'fa-person-cane', label: 'Jubilación estimada', value: `${money0(r.ingresoTotal)}/mes`, note: `A los ${r.edadJubilacion} años · ahorro ${money0(r.ingresoAhorro)} + IESS ${money0(r.pension)}`, goto: 'jubilacion' })
        ].join(''));

        UI.html('dash-alerts', alerts(ctx));

        const years = [];
        for (let y = s.configStartYear; y <= s.configEndYear; y++) years.push(y);
        UI.chart('dash-nw-chart', {
            type: 'line',
            data: { labels: years, datasets: [{ label: 'Patrimonio neto', data: years.map(y => Engine.netWorth(s.years, s.assets, y).value), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.1)', fill: true, tension: .25, pointRadius: years.map(y => y === s.activeYear ? 5 : 0) }] },
            options: { scales: { y: { beginAtZero: false } } }
        });
    }

    App.defineView('resumen', { update });
})();
