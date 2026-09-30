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

    // ---------------------------------------------------------------- this month
    const bar = (share, color) => `<div class="mini-bar"><span style="width:${Math.max(0, Math.min(100, share * 100)).toFixed(1)}%;background:${color}"></span></div>`;
    const pctChange = (now, before) => before > 0 ? (now - before) / before : null;

    function monthDashboard(ctx) {
        const s = ctx.state, t = ctx.today;
        const y = t.getFullYear(), m = String(t.getMonth() + 1);
        const [py, pm] = m === '1' ? [y - 1, '12'] : [y, String(Number(m) - 1)];
        UI.text('dash-month-name', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
        const txns = s.transactions;
        const items = Engine.monthItems(Store.effective(y), m);
        const plannedSpend = items.filter(i => !Engine.isSavingsItem(i)).reduce((a, i) => a + (Number(i.real) || 0), 0);

        // Spending so far vs. last month, day by day.
        const curve = Engine.monthSpendCurve(txns, t);
        UI.text('dash-spent', money0(curve.spent));
        UI.html('dash-curve-note', curve.sameDayLast > 0
            ? (curve.diff <= 0 ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> Llevas <strong>${money0(-curve.diff)} menos</strong> que el mes pasado a esta fecha.` : `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> Llevas <strong>${money0(curve.diff)} más</strong> que el mes pasado a esta fecha.`)
            : 'Registra tus gastos: el próximo mes verás la comparación con este.');
        const days = curve.current.length;
        const prev = Array.from({ length: days }, (_, i) => i < curve.previous.length ? curve.previous[i] : curve.previous[curve.previous.length - 1]);
        UI.chart('dash-curve-chart', {
            type: 'line',
            data: {
                labels: Array.from({ length: days }, (_, i) => i + 1),
                datasets: [
                    { label: 'Este mes', data: curve.current, borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,.10)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, fill: true, cubicInterpolationMode: 'monotone' },
                    { label: 'Mes pasado', data: prev, borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, cubicInterpolationMode: 'monotone' },
                    { label: 'Planeado', data: Array(days).fill(plannedSpend), borderColor: '#cbd5e1', borderDash: [2, 4], borderWidth: 2, pointRadius: 0, fill: false }
                ]
            },
            options: { interaction: { mode: 'index', intersect: false } }
        });

        // Today: what's left per day for flexible spending, spent today, payday.
        const spend = Engine.lineSpend(items, txns, y, m);
        const flex = items.filter(i => i.type === 'Gasto Variable');
        const flexPlanned = flex.reduce((a, i) => a + (Number(i.real) || 0), 0);
        const flexSpent = flex.reduce((a, i) => a + ((spend.byLine[String(i.id)] || {}).spent || 0), 0);
        const allow = Engine.dailyAllowance({ planned: flexPlanned, spent: flexSpent, today: t });
        const iso = Engine.isoDate(t);
        const spentToday = txns.filter(x => (x.type || 'Gasto') === 'Gasto' && x.date === iso).reduce((a, x) => a + (Number(x.amount) || 0), 0);
        const pay = Engine.nextPayday(s.settings.paydays, t);
        const streak = Engine.loggingStreak(txns, t);
        const DOW = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
        UI.html('dash-today', `
            <div class="kpi ${allow.perDay > 0 ? (spentToday > allow.perDay ? 'tone-amber' : 'tone-emerald') : 'tone-red'}">
                <span class="kpi-label">Puedes gastar hoy</span>
                <span class="kpi-value">${money0(allow.perDay)}</span>
                <span class="kpi-note">${allow.perDay > 0 ? `Te quedan ${money0(allow.remaining)} de gastos variables para ${allow.daysLeft} día${allow.daysLeft === 1 ? '' : 's'}. Hoy llevas ${money0(spentToday)}.` : `Ya usaste tus gastos variables del mes (${money0(flexSpent)} de ${money0(flexPlanned)}).`}</span>
            </div>
            <div class="kpi tone-slate">
                <span class="kpi-label">Próximo día de pago</span>
                <span class="kpi-value">${pay ? (pay.days === 0 ? '¡Hoy!' : `En ${pay.days} día${pay.days === 1 ? '' : 's'}`) : '—'}</span>
                <span class="kpi-note">${pay ? `${pay.date.getDate()} de ${Fmt.MONTH_NAMES[pay.date.getMonth()].toLowerCase()}` : '<a href="#" class="link" data-goto="presupuesto/ingresos">Dinos qué días cobras</a>'}</span>
            </div>
            <div class="kpi ${streak.days >= 3 ? 'tone-amber' : 'tone-slate'}">
                <span class="kpi-label">${streak.days ? '🔥 Racha registrando' : 'Registra hoy'}</span>
                <span class="kpi-value">${streak.days} día${streak.days === 1 ? '' : 's'}</span>
                <div class="streak-week">${streak.week.map((on, i) => `<span class="${on ? 'on' : ''}" title="${on ? 'Registraste' : 'Sin registros'}">${DOW[i]}</span>`).join('')}</div>
                <span class="kpi-note">${streak.today ? '¡Ya registraste hoy!' : streak.days ? 'Registra algo hoy para no perder la racha.' : 'Anotar tus gastos cada día es el hábito que más ayuda.'} <button type="button" class="link" data-action="quick.open">+ Registrar</button></span>
            </div>`);

        // Cash flow: money in vs. out this month, compared with last month.
        const cf = Engine.cashFlow(txns, y, m), cfp = Engine.cashFlow(txns, py, pm);
        const mx = Math.max(cf.income, cf.expense, 1);
        const chg = (now, before, goodUp) => { const c = pctChange(now, before); if (c === null) return ''; const up = c > 0; return `<span class="text-[11px] font-bold ${up === goodUp ? 'text-emerald-700' : 'text-red-600'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}%</span>`; };
        UI.html('dash-cash', `
            <div class="space-y-3 text-xs">
                <div><div class="flex justify-between"><span class="font-semibold text-slate-600">Entró</span><span><strong class="text-slate-900">${money0(cf.income)}</strong> ${chg(cf.income, cfp.income, true)}</span></div>${bar(cf.income / mx, '#1baf7a')}</div>
                <div><div class="flex justify-between"><span class="font-semibold text-slate-600">Salió</span><span><strong class="text-slate-900">${money0(cf.expense)}</strong> ${chg(cf.expense, cfp.expense, false)}</span></div>${bar(cf.expense / mx, '#2a78d6')}</div>
                <div class="flex justify-between border-t border-slate-100 pt-2"><span class="font-semibold text-slate-600">Balance</span><strong class="${cf.net < 0 ? 'text-red-600' : 'text-emerald-700'}">${cf.net < 0 ? '−' : '+'}${money0(Math.abs(cf.net))}</strong></div>
                <p class="help">Según tus transacciones registradas. ▲▼ comparado con ${Fmt.MONTH_NAMES[pm - 1].toLowerCase()}.</p>
            </div>`);

        // Where the money went.
        const pad = (n) => String(n).padStart(2, '0');
        const br = Engine.categoryBreakdown(txns, { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-31` });
        const top = br.items.slice(0, 5);
        const rest = br.items.slice(5).reduce((a, r) => a + r.amount, 0);
        UI.html('dash-top', br.total ? `<div class="space-y-2.5 text-xs">${top.map(r => `<div><div class="flex justify-between gap-2"><span class="font-semibold text-slate-700 truncate">${esc(r.category)}</span><span class="whitespace-nowrap"><strong>${money0(r.amount)}</strong> <span class="text-slate-400">${Math.round(r.share * 100)}%</span></span></div>${bar(r.amount / top[0].amount, '#2a78d6')}</div>`).join('')}
            ${rest ? `<div class="flex justify-between text-slate-500"><span>Otras categorías</span><span>${money0(rest)}</span></div>` : ''}
            <p class="help">Total: ${money0(br.total)} en ${Fmt.MONTH_NAMES[m - 1].toLowerCase()}.</p></div>` : '<p class="help">Aún no registras gastos este mes.</p>');

        // Insights
        const ins = Engine.monthInsights(txns, t);
        const out = [];
        const tip = (icon, color, title, text) => out.push(`<div class="flex gap-2.5"><span class="insight-ico" style="background:${color}"><i class="fa-solid ${icon}"></i></span><div class="text-xs"><div class="font-bold text-slate-800">${title}</div><div class="text-slate-600">${text}</div></div></div>`);
        if (ins.spent > 0) {
            const over = plannedSpend > 0 && ins.projected > plannedSpend;
            tip(over ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', over ? '#dc2626' : '#059669', over ? 'Vas a pasarte' : 'Vas bien', `A este ritmo terminarás el mes con <strong>${money0(ins.projected)}</strong> en gastos${plannedSpend ? ` (planeaste ${money0(plannedSpend)})` : ''}.`);
        }
        if (ins.top) tip('fa-arrow-up', '#7c3aed', 'Donde más gastas', `<strong>${esc(ins.top.category)}</strong>: ${money0(ins.top.amount)}, el ${Math.round(ins.top.share * 100)}% de lo que gastaste este mes.`);
        if (ins.jump) tip('fa-circle-exclamation', '#ea580c', 'Mayor aumento', `<strong>${esc(ins.jump.category)}</strong>: +${money0(ins.jump.change)} frente a los mismos días del mes pasado.`);
        if (ins.drop) tip('fa-circle-minus', '#0891b2', 'Mayor baja', `<strong>${esc(ins.drop.category)}</strong>: ${money0(-ins.drop.change)} menos que el mes pasado a esta fecha.`);
        if (!ins.hasHistory && ins.spent > 0) out.push('<p class="help">Con un mes más de datos verás qué subió y qué bajó.</p>');
        UI.html('dash-insights', out.join('') || '<p class="help">Registra algunos gastos y aquí verás proyecciones y comparaciones.</p>');

        // Accounts
        const accts = s.accounts || [];
        UI.show('dash-accounts-card', accts.length > 0);
        if (accts.length) {
            const KIND = { corriente: 'fa-building-columns', ahorros: 'fa-piggy-bank', efectivo: 'fa-money-bill-wave' };
            const total = accts.reduce((a, x) => a + (Number(x.balance) || 0), 0);
            UI.html('dash-accounts', `<div class="space-y-2 text-xs">${accts.map(a => `<div class="flex items-center justify-between gap-2"><span class="flex items-center gap-2 min-w-0"><i class="fa-solid ${KIND[a.kind] || KIND.corriente} text-blue-600 w-4 text-center"></i><span class="truncate font-semibold text-slate-800">${esc(a.name)}</span></span><span class="text-right"><strong>${money(a.balance)}</strong><span class="block text-[10px] text-slate-400">${esc(a.updatedAt || '')}</span></span></div>`).join('')}
                <div class="flex justify-between border-t border-slate-100 pt-2"><span class="font-semibold text-slate-600">Disponible</span><strong class="${total < 0 ? 'text-red-600' : 'text-emerald-700'}">${money(total)}</strong></div></div>`);
        }

        // Household contributions
        const members = s.members || [];
        UI.show('dash-members-card', members.length > 0);
        if (members.length) {
            UI.text('dash-members-month', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
            const mt = Engine.memberTotals(txns, members, y, m);
            UI.html('dash-members', `<div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div class="kpi tone-slate"><span class="kpi-label">Ingresos del hogar</span><span class="kpi-value">${money0(mt.income)}</span><span class="kpi-note">Gastos: ${money0(mt.expense)}</span></div>
                <div class="md:col-span-2 space-y-3">${mt.rows.map(r => `<div class="grid grid-cols-[auto_1fr_1fr] gap-3 items-center">
                    <span class="flex items-center gap-2 font-bold text-slate-800 min-w-[6rem]"><span class="member-dot" style="background:${r.color || '#94a3b8'}">${esc((r.name || '?').charAt(0).toUpperCase())}</span>${esc(r.name)}</span>
                    <div><div class="flex justify-between"><span class="text-emerald-700 font-bold">+${money0(r.income)}</span><span class="text-slate-400">${Math.round(r.incomeShare * 100)}%</span></div>${bar(r.incomeShare, '#1baf7a')}</div>
                    <div><div class="flex justify-between"><span class="font-bold">−${money0(r.expense)}</span><span class="text-slate-400">${Math.round(r.expenseShare * 100)}%</span></div>${bar(r.expenseShare, '#2a78d6')}</div>
                </div>`).join('')}
                <p class="help">Según quién registraste en cada transacción. Barras: parte de los ingresos (verde) y de los gastos (azul) del hogar.</p></div></div>`);
        }
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
        monthDashboard(ctx);
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
