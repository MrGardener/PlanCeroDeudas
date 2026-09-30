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
                text = debts.shortfall > 0
                    ? `Debes ${money0(debts.totalBalance)}, pero tu presupuesto solo asigna ${money0(debts.pool)}/mes a deudas y los mínimos suman ${money0(debts.totalMin)}. Asigna más dinero a tus deudas.`
                    : debts.never
                    ? `Debes ${money0(debts.totalBalance)} y con lo que tu presupuesto asigna nunca terminarías. Asigna más dinero a tus deudas.`
                    : `Debes ${money0(debts.totalBalance)}. Tu presupuesto les envía ${money0(debts.pool)}/mes${debts.extra > 0 ? ` (${money0(debts.extra)} extra a la bola de nieve)` : ''}: quedas libre en ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}.`;
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

    // This month's bills with a due date: overdue first, then upcoming, then paid.
    function billsHTML(ctx) {
        const s = ctx.state;
        const y = ctx.today.getFullYear(), m = String(ctx.today.getMonth() + 1);
        UI.text('dash-bills-month', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, s.transactions, y, m);
        const bills = Engine.billsDue({ items, spend, year: y, month: m, today: ctx.today });
        if (!bills.length) return '<p class="text-xs text-slate-500">Aún no tienes fechas de pago. En tu presupuesto (vista Simple), toca el <i class="fa-regular fa-calendar"></i> junto a un rubro —arriendo, luz, internet, tarjeta— para decir qué día vence.</p>';
        const order = { overdue: 0, soon: 1, later: 2, paid: 3 };
        const label = (b) => b.status === 'paid' ? '<span class="badge badge-ok">Pagado</span>'
            : b.status === 'overdue' ? `<span class="badge badge-bad">Vencido hace ${-b.daysLeft} día${b.daysLeft === -1 ? '' : 's'}</span>`
            : b.daysLeft === 0 ? '<span class="badge badge-warn">Vence hoy</span>'
            : `<span class="badge ${b.status === 'soon' ? 'badge-warn' : 'badge-muted'}">En ${b.daysLeft} día${b.daysLeft === 1 ? '' : 's'}</span>`;
        return bills.slice().sort((a, b) => order[a.status] - order[b.status] || a.day - b.day).map(b => `
            <div class="bill-item ${b.status}">
                <div class="bill-day"><span>${Fmt.MONTH_SHORT[m - 1]}</span><b>${b.day}</b></div>
                <div class="min-w-0"><div class="font-bold text-sm text-slate-800 break-words">${esc(b.item.name)}</div><div class="text-[11px] text-slate-500">${b.spent > 0 && !b.paid ? `Pagado ${money(b.spent)} de ${money(b.planned)}` : money(b.planned)}</div></div>
                <div class="flex flex-col items-end gap-1">${label(b)}${b.paid ? '' : `<button type="button" class="mini-btn" data-action="bill.pay" data-line="${esc(String(b.item.id))}" data-amount="${b.remaining}">Registrar pago</button>`}</div>
            </div>`).join('');
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
            const items = Engine.monthItems(ctx.budgetYear, m);
            const spend = Engine.lineSpend(items, s.transactions, s.activeYear, m);
            const over = items.filter(it => {
                const sp = spend.byLine[String(it.id)];
                return sp && sp.txns.length && Engine.spendStatus(sp.spent, Number(it.real) || 0).kind === 'over';
            });
            const bills = Engine.billsDue({ items, spend, year: s.activeYear, month: m, today: ctx.today });
            const late = bills.filter(b => b.status === 'overdue');
            if (late.length) add('tone-red', 'fa-calendar-xmark text-red-600', `Pagos vencidos: ${late.map(b => `<strong>${esc(b.item.name)}</strong> (día ${b.day})`).join(', ')}.`, 'resumen');
            if (over.length) add('tone-red', 'fa-cart-shopping text-red-600', `Este mes te pasaste en: <strong>${over.map(i => esc(i.name)).join(', ')}</strong>.`, 'presupuesto/plan');
        }
        const sync = Views.netWorthSync(ctx);
        if (sync) add('tone-blue', 'fa-scale-balanced text-teal-600', `Tu patrimonio ${s.activeYear} no refleja tus pólizas (${money0(sync.polizas)}) y deudas (${money0(sync.debts)}) registradas.`, 'patrimonio');
        const last = s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt) : null;
        const days = last ? Math.floor((ctx.today - last) / 86400000) : null;
        if (days === null || days > 30) add('tone-amber', 'fa-download text-amber-600', days === null ? 'Aún no descargas una <strong>copia de respaldo</strong>. Si se borran los datos del navegador perderías tu plan.' : `Tu última copia de respaldo tiene <strong>${days} días</strong>. Descarga una nueva.`, 'config');
        if (ctx.debts.totalBalance > 0 && ctx.debts.shortfall > 0) add('tone-red', 'fa-snowplow text-red-600', `Tu presupuesto no cubre los pagos mínimos de tus deudas: faltan <strong>${money0(ctx.debts.shortfall)}</strong> al mes.`, 'metas');
        else if (ctx.debts.never && ctx.debts.totalBalance > 0) add('tone-red', 'fa-snowplow text-red-600', 'Con lo que tu presupuesto asigna, una deuda nunca termina de pagarse.', 'metas');
        if (ctx.steps.current >= 3) {
            const unfunded = s.goals.filter(g => Engine.goalMonths(g).status === 'never');
            if (unfunded.length) add('tone-amber', 'fa-bullseye text-purple-600', `${unfunded.map(g => `<strong>${esc(g.name)}</strong>`).join(', ')} sin dinero asignado en tu presupuesto.`, 'metas');
        }
        const p = ctx.pay;
        if (p.sriCap > 0 && p.deductibles.real < p.sriCap * 0.8) add('tone-blue', 'fa-file-invoice-dollar text-blue-600', `Podrías deducir <strong>${money0(p.sriCap - p.deductibles.real)}</strong> más en gastos personales y pagar menos impuesto.`, 'presupuesto/ingresos');

        return out.length ? out.join('') : '<div class="alert-item tone-emerald"><i class="fa-solid fa-circle-check text-emerald-600 mt-0.5"></i><span>Todo en orden. ¡Buen trabajo!</span></div>';
    }

    function update(ctx) {
        const s = ctx.state;
        UI.html('dash-bills', billsHTML(ctx));
        const welcome = document.getElementById('dash-welcome');
        UI.show(welcome, !s.settings.welcomeDismissed);
        if (!s.settings.welcomeDismissed) {
            welcome.innerHTML = `<div class="card-head">
                    <div><div class="card-title"><i class="fa-solid fa-hand text-emerald-600"></i> Bienvenido a tu Plan Financiero</div><div class="card-sub">Lee esto una vez: así funciona la app y así cuidas tus datos. Siempre puedes volver a verlo con el botón <i class="fa-solid fa-circle-question"></i> de arriba.</div></div>
                </div>
                ${Views.guideHTML()}
                <div class="flex flex-wrap justify-end gap-2 mt-5">
                    <button class="btn btn-secondary" data-action="app.dismissWelcome">Entendido</button>
                    <button class="btn btn-primary" data-action="app.dismissWelcome" data-then="presupuesto/ingresos">Empezar con mi sueldo <i class="fa-solid fa-arrow-right"></i></button>
                </div>`;
        }
        UI.html('dash-hero', hero(ctx));
        UI.html('dash-steps', Views.stepsHTML(ctx, { compact: true }));

        const bb = ctx.baseBudget, debts = ctx.debts, ef = ctx.ef, r = ctx.retirement;
        const balNote = Math.abs(bb.balanceReal) < 0.005 ? '✓ Base cero: cada dólar asignado' : bb.balanceReal > 0 ? `${money(bb.balanceReal)} sin asignar` : `${money(-bb.balanceReal)} de más`;
        UI.html('dash-kpis', [
            Views.kpiCard({ tone: 'text-emerald-600', icon: 'fa-wallet', label: 'Ingreso neto mensual', value: money(bb.income), note: `Asignado: ${money(bb.expReal + bb.sweep)} · ${balNote}`, goto: 'presupuesto/plan' }),
            Views.kpiCard({ tone: 'text-red-600', icon: 'fa-snowplow', label: 'Deudas de consumo', value: money0(debts.totalBalance), note: debts.totalBalance <= 0 ? '¡Sin deudas!' : debts.shortfall > 0 ? `Presupuesto no cubre mínimos (faltan ${money0(debts.shortfall)})` : debts.never ? 'Nunca terminas con este presupuesto' : `${money0(debts.pool)}/mes · libre en ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}`, goto: 'metas', focus: 'metas-debts' }),
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

    UI.register({
        // Logs this month's payment of a bill as an expense on its budget line.
        'bill.pay': (el) => {
            const today = new Date();
            const y = today.getFullYear(), m = String(today.getMonth() + 1);
            const item = Engine.monthItems(Store.effective(y), m).find(i => String(i.id) === el.dataset.line);
            if (!item) return;
            const tax = Store.state.taxonomy.expense;
            const cat = tax[item.linkedCategory] ? item.linkedCategory : (tax.Otros ? 'Otros' : Object.keys(tax)[0]);
            const txns = Store.state.transactions;
            const amount = Math.round(Number(el.dataset.amount) * 100) / 100;
            txns.push({ id: Store.nextId(txns), type: 'Gasto', description: item.name, store: '', parentCategory: cat, category: (tax[cat] || [])[0] || '', amount, date: Engine.isoDate(today), paymentType: 'Transferencia', budgetLine: String(item.id) });
            App.changed({ structural: true, step: true });
            UI.toast(`Pago de "${item.name}" registrado (${Fmt.money(amount)}).`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        },
        'app.dismissWelcome': (el) => {
            Store.state.settings.welcomeDismissed = true;
            Store.scheduleSave();
            App.commitHistory();  // a preference, not something to undo
            if (el.dataset.then) App.go(el.dataset.then); else App.render();
        }
    });

    App.defineView('resumen', { update });
})();
