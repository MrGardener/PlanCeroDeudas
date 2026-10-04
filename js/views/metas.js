/* Deudas y Metas: Baby Steps progress, emergency fund, debt payoff plan and savings goals. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    // On phones these tables show as one card per row (css: .table-cards); data-label names each field.
    function debtRow(d) {
        return `<tr data-row="${d.id}">
            <td class="c-wide" data-label="Deuda"><input class="cell-input" value="${esc(d.name)}" data-change="debt.set" data-id="${d.id}" data-field="name" aria-label="Nombre de la deuda"></td>
            <td data-label="Tipo"><select class="cell-input" data-change="debt.set" data-id="${d.id}" data-field="kind" aria-label="Tipo">${Views.selectOptions(Engine.DEBT_KINDS.map(k => ({ value: k.id, label: k.label })), d.kind)}</select></td>
            <td data-label="Saldo"><input type="number" class="cell-input num" min="0" step="50" value="${Number(d.balance) || 0}" data-input="debt.set" data-id="${d.id}" data-field="balance" aria-label="Saldo"></td>
            <td data-label="Tasa (%)"><input type="number" class="cell-input num" min="0" step="0.1" value="${Number(d.rate) || 0}" data-input="debt.set" data-id="${d.id}" data-field="rate" aria-label="Tasa"></td>
            <td data-label="Pago mínimo"><input type="number" class="cell-input num" min="0" step="5" value="${Number(d.minPayment) || 0}" data-input="debt.set" data-id="${d.id}" data-field="minPayment" aria-label="Pago mínimo"></td>
            <td data-label="Presupuesto al mes"><input type="number" class="cell-input num money" min="0" step="10" value="${Number(d.monthly) || 0}" data-input="debt.set" data-id="${d.id}" data-field="monthly" aria-label="Monto en tu presupuesto" title="Lo que tu presupuesto le paga cada mes"></td>
            <td class="text-center" data-label="Orden" data-cell="order"></td>
            <td class="text-center whitespace-nowrap font-bold text-slate-700" data-label="Se paga en" data-cell="payoff"></td>
            <td class="c-wide c-actions text-center whitespace-nowrap">${Number(d.balance) > 0 ? `<button class="mini-btn" data-action="debt.pay" data-id="${d.id}" title="Registrar un pago: baja el saldo y queda en Transacciones">Pagar</button> ` : ''}<button class="row-del" data-action="debt.delete" data-id="${d.id}" title="Eliminar deuda"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function goalRow(g) {
        const cell = (field, step, label, cls = '') => `<td data-label="${label}"><input type="number" class="cell-input num ${cls}" min="0" step="${step}" value="${Number(g[field]) || 0}" data-input="goal.set" data-id="${g.id}" data-field="${field}" aria-label="${label}"></td>`;
        return `<tr data-row="${g.id}">
            <td class="c-wide" data-label="Meta"><input class="cell-input" value="${esc(g.name)}" data-change="goal.set" data-id="${g.id}" data-field="name" aria-label="Nombre de la meta"></td>
            ${cell('target', 100, 'Objetivo')}${cell('current', 100, 'Ahorrado')}${cell('monthly', 10, 'Presupuesto al mes', 'money')}${cell('rate', 0.1, Store.COUNTRY === 'US' ? 'Tasa (%)' : 'Tasa DPF (%)')}
            <td data-label="¿Para cuándo?"><input type="month" class="cell-input" value="${esc(g.targetDate || '')}" data-change="goal.set" data-id="${g.id}" data-field="targetDate" aria-label="Fecha meta"></td>
            <td class="c-wide" data-label="Progreso" data-cell="time"></td>
            <td class="c-wide c-actions text-center whitespace-nowrap"><button class="mini-btn" data-action="goal.deposit" data-id="${g.id}" title="Sumar un depósito a lo ahorrado">Depositar</button> ${Number(g.current) > 0 ? `<button class="mini-btn" data-action="goal.spend" data-id="${g.id}" title="Pagar una compra con este dinero ahorrado (no cuenta otra vez en el presupuesto del mes)">Usar</button> ` : ''}<button class="row-del" data-action="goal.delete" data-id="${g.id}" title="Eliminar meta"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function render(ctx) {
        const s = ctx.state;
        UI.html('debt-body', s.debts.length ? s.debts.map(debtRow).join('') : '<tr class="empty-row"><td colspan="9">¡Sin deudas registradas! Si tienes alguna, agrégala para armar tu plan.</td></tr>');
        UI.html('goal-body', s.goals.length ? s.goals.map(goalRow).join('') : '<tr class="empty-row"><td colspan="8">Agrega una meta: un carro, un terreno, la universidad…</td></tr>');
        if (window.Runway) Runway.render(ctx);
        if (window.Insurance) Insurance.render(ctx);
        if (window.College) College.render(ctx);
        update(ctx);
    }

    // "Tu camino": net worth today → projected at retirement, with the debt-free milestone,
    // and the one concrete thing to do now.
    function roadmap(ctx) {
        const s = ctx.state, r = s.retirement, plan = ctx.debts;
        const ageNow = Math.max(0, Number(r.edadActual) || 0), ageEnd = Math.max(ageNow + 1, Number(r.edadJubilacion) || 65);
        const months = Math.min(600, (ageEnd - ageNow) * 12);
        const debtMonths = plan.totalBalance > 0 && !plan.never ? plan.months : 0;
        // Same money and assumptions as Jubilación: what's invested beyond the emergency fund grows
        // at the long-run return (the emergency fund itself is kept, not grown); today's dollars.
        const ri = ctx.retirementInputs;
        const invested = ctx.pools.invested;
        const efMonthly = ctx.year.budgetBase.filter(i => Engine.isSavingsItem(i) && Engine.savingsPurpose(i) === 'emergencia').reduce((t, i) => t + (Number(i.real) || 0), 0);
        const path = Engine.netWorthPath({ start: ctx.netWorth.value, invested, monthlySavings: ctx.retirementMonthly + efMonthly, rate: ri.tasaRetorno, inflation: ri.inflacion, debtBalance: plan.totalBalance, debtMonths, debtPayment: plan.pool, months });
        const years = Math.ceil(months / 12);
        const labels = Array.from({ length: years + 1 }, (_, i) => `${ageNow + i} años`);
        const yearly = labels.map((_, i) => path[Math.min(i * 12, path.length - 1)]);
        const milestones = labels.map(() => null);
        if (debtMonths) milestones[Math.min(years, Math.round(debtMonths / 12))] = yearly[Math.min(years, Math.round(debtMonths / 12))];
        milestones[years] = yearly[years];
        UI.chart('road-chart', {
            type: 'line',
            data: { labels, datasets: [
                { label: 'Patrimonio proyectado', data: yearly, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.12)', borderWidth: 2, pointRadius: 0, fill: true, cubicInterpolationMode: 'monotone' },
                { label: 'Hitos', data: milestones, borderColor: '#2a78d6', backgroundColor: '#2a78d6', pointStyle: 'rectRot', pointRadius: 7, pointHoverRadius: 9, showLine: false }
            ] },
            options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } } }
        });
        const freeDate = plan.totalBalance <= 0 ? '¡Ya!' : plan.never ? 'Nunca (con este presupuesto)' : Fmt.monthYear(Engine.addMonths(ctx.today, plan.months));
        UI.html('road-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Patrimonio hoy</span><span class="kpi-value">${money0(ctx.netWorth.value)}</span><span class="kpi-note"><a href="#" class="link" data-goto="patrimonio">Ver detalle</a></span></div>
            <div class="kpi ${plan.totalBalance <= 0 ? 'tone-emerald' : plan.never ? 'tone-red' : 'tone-blue'}"><span class="kpi-label">🎯 Libre de deudas</span><span class="kpi-value">${freeDate}</span><span class="kpi-note">${plan.totalBalance > 0 ? `Quedan ${money0(plan.totalBalance)}` : 'Sin deudas de consumo'}</span></div>
            <div class="kpi tone-emerald"><span class="kpi-label">🏖️ Proyectado a los ${ageEnd}</span><span class="kpi-value">${money0(yearly[years])}</span><span class="kpi-note">Estimación</span></div>`);
        UI.text('road-note', `Estimación en dólares de hoy (inflación ${ri.inflacion}% anual): tu patrimonio de hoy; tus inversiones (${money0(invested)}) y lo que ahorras al mes según tu presupuesto (${money0(ctx.retirementMonthly + efMonthly)}) crecen al ${ri.tasaRetorno}% anual (tu casa y otros bienes se mantienen); lo que pagas a tus deudas baja lo que debes, y al terminar de pagarlas ese dinero (${money0(plan.pool)}/mes) pasa a ahorro. Cambia tu edad, el retorno y la inflación en Jubilación.`);
        // The next concrete action, by step.
        const st = ctx.steps.current, ef = ctx.ef;
        const paidAll = s.debts.reduce((t, d) => t + Math.max(0, Math.max(Number(d.originalBalance) || 0, Number(d.balance) || 0) - (Number(d.balance) || 0)), 0);
        const next = st === 1 ? `<strong>Paso 1:</strong> junta ${money0(Math.max(0, 1000 - ef.liquid))} más para llegar a $1,000 en tu fondo de emergencia inicial.`
            : st === 2 ? (plan.never || plan.shortfall > 0 ? `<strong>Paso 2:</strong> tu presupuesto no alcanza para salir de deudas. Asigna más dinero a tus deudas en el presupuesto.`
                : `<strong>Paso 2:</strong> envía <strong>${money0(plan.pool)}/mes</strong> a tus deudas (mínimos ${money0(plan.totalMin)}${plan.extra > 0 ? ` + ${money0(plan.extra)} extra` : ''}) y quedas libre en <strong>${freeDate}</strong>.${paidAll > 0 ? ` Ya pagaste ${money0(paidAll)}. ¡Sigue!` : ''}`)
            : st === 3 ? `<strong>Paso 3:</strong> llevas ${ef.monthsCovered.toFixed(1)} de 3–6 meses de gastos (${money0(ef.monthlyEssential)}/mes). Te faltan ${money0(Math.max(0, ef.monthlyEssential * 3 - ef.liquid))} para 3 meses.`
            : st === 4 ? `<strong>Pasos 4–6:</strong> ahorras el ${(ctx.savingsRate * 100).toFixed(0)}% de tu sueldo (meta 15%); luego educación de tus hijos y abonos a la hipoteca.`
            : '<strong>Paso 7:</strong> sigue invirtiendo y da con generosidad.';
        UI.html('road-next', `<i class="fa-solid fa-location-dot text-blue-600"></i> ${next}`);
    }

    // The payoff ladder: one bar per debt from today to the month it's paid off (lighter while it
    // only gets its minimum, solid once the snowball reaches it), and the total owed month by
    // month with this plan vs. paying only the minimums. Data: Engine.debtPayoff (ctx.debts).
    function debtLadder(ctx) {
        const s = ctx.state, plan = ctx.debts, pal = UI.palette();
        const rows = plan.items.filter(i => i.balance > 0 || i.payoffMonth).map(i => ({ ...i, debt: s.debts.find(d => d.id === i.id) })).filter(r => r.debt && Number(r.debt.balance) > 0);
        UI.show('debt-ladder', rows.length > 0);
        if (!rows.length) return;
        const when = (m) => Fmt.monthYear(Engine.addMonths(ctx.today, m));
        const done = rows.filter(r => r.payoffMonth);
        const end = Math.max(1, ...done.map(r => r.payoffMonth));
        const raw = rows.some(r => !r.payoffMonth) ? Math.ceil(end * 1.25) + 1 : end;
        const step = raw <= 12 ? 3 : raw <= 36 ? 6 : 12 * Math.ceil(raw / 60);
        // The axis ends on a tick, so the last date label never collides with an extra one.
        const max = Math.ceil(raw / step) * step;
        const short = (name) => { const n = String(name || ''); return n.length > 18 ? n.slice(0, 17) + '…' : n; };
        // Minimum-only stretch, then the snowball stretch; a debt never reached keeps the first.
        const minPart = rows.map(r => { const stop = r.attackMonth ? r.attackMonth - 1 : (r.payoffMonth || max); return stop > 0 ? [0, stop] : null; });
        const snowPart = rows.map(r => (r.attackMonth && r.payoffMonth ? [r.attackMonth - 1, r.payoffMonth] : null));
        const box = document.getElementById('debt-ladder-box');
        if (box) box.style.height = `${Math.max(120, rows.length * 34 + 64)}px`;
        const rightEnd = { topRight: 4, bottomRight: 4, topLeft: 0, bottomLeft: 0 };
        UI.chart('debt-ladder-chart', {
            type: 'bar',
            data: {
                labels: rows.map(r => short(r.debt.name)),
                datasets: [
                    { label: 'Pagando su mínimo', data: minPart, backgroundColor: pal.seq[0], borderRadius: (c) => (snowPart[c.dataIndex] ? 0 : rightEnd), borderSkipped: false, barThickness: 18, grouped: false },
                    { label: 'Con la bola de nieve', data: snowPart, backgroundColor: pal.blue, borderColor: pal.surface, borderWidth: { left: 2, right: 0, top: 0, bottom: 0 }, borderRadius: rightEnd, borderSkipped: false, barThickness: 18, grouped: false }
                ]
            },
            options: {
                indexAxis: 'y',
                layout: { padding: { right: 62 } },
                interaction: { mode: 'nearest', axis: 'y', intersect: false },
                scales: {
                    x: { min: 0, max, ticks: { stepSize: step, callback: (v) => when(Math.round(v)), maxRotation: 0 }, grid: { display: true } },
                    y: { beginAtZero: false, ticks: { callback(v) { return this.getLabelForValue(v); }, font: { size: 11 } }, grid: { display: false } }
                },
                plugins: {
                    legend: { position: 'top', align: 'start' },
                    tooltip: { callbacks: {
                        title: (items) => (items[0] ? rows[items[0].dataIndex].debt.name : ''),
                        label: (c) => (c.raw ? `${c.dataset.label}: ${when(c.raw[0])} → ${when(c.raw[1])}` : '')
                    } },
                    endLabels: { labels: rows.map(r => (r.payoffMonth ? when(r.payoffMonth) : 'Nunca')), dataset: rows.map((r, i) => (snowPart[i] ? 1 : 0)) }
                }
            }
        });
        const first = rows.find(r => r.payoffMonth);
        UI.text('debt-ladder-note', `${s.debtPlan.strategy === 'avalanche' ? 'Avalancha' : 'Bola de nieve'}: cada barra va de hoy al mes en que pagas esa deuda. La parte clara es cuando solo recibe su mínimo; la oscura, cuando le llega la bola de nieve.${first ? ` La primera en caer: ${first.debt.name}, en ${when(first.payoffMonth)}.` : ''}`);

        // Total owed: this plan vs. minimums only (one axis, same money).
        const start = rows.reduce((t, r) => t + (Number(r.debt.balance) || 0), 0);
        const planLine = [start].concat(plan.history);
        const minLine = [start].concat(plan.minimumsHistory || []);
        const CAP = 360;
        const len = Math.min(CAP, Math.max(planLine.length, minLine.length));
        const labels = Array.from({ length: len }, (_, i) => when(i));
        const freeMin = plan.minimumsNever ? null : plan.minimumsMonths;
        UI.chart('debt-owed-chart', {
            type: 'line',
            data: {
                labels,
                datasets: [
                    { label: plan.never ? 'Tu plan (nunca terminas)' : `Tu plan (libre en ${when(plan.months)})`, data: planLine.slice(0, len), borderColor: pal.blue, backgroundColor: pal.alpha(pal.blue, 0.1), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0 },
                    { label: freeMin ? `Solo pagos mínimos (libre en ${when(freeMin)})` : 'Solo pagos mínimos (nunca terminas)', data: minLine.slice(0, len), borderColor: pal.muted, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0 }
                ]
            },
            options: { scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } } }, plugins: { legend: { position: 'top', align: 'start' } } }
        });
        UI.text('debt-owed-note', plan.minimumsNever || minLine.length > CAP
            ? 'Solo con los pagos mínimos tus deudas no terminan en 30 años: el interés se come el pago.'
            : plan.monthsSaved > 0 ? `Con tu plan terminas ${Fmt.monthsAsYears(plan.monthsSaved)} antes y pagas ${money0(plan.interestSaved)} menos de interés que solo con los mínimos.` : '');

        UI.html('debt-ladder-table', rows.map(r => `<tr><td class="font-semibold" data-i18n-skip>${esc(r.debt.name)}</td><td class="num">${money0(r.debt.balance)}</td>
            <td>${r.attackMonth ? (r.attackMonth <= 1 ? 'Desde hoy' : when(r.attackMonth - 1)) : '—'}</td>
            <td>${r.payoffMonth ? `${when(r.payoffMonth)} (mes ${r.payoffMonth})` : 'Nunca'}</td></tr>`).join(''));
        const marks = [];
        for (let m = 0; m < len; m += 12) marks.push(m);
        if (marks[marks.length - 1] !== len - 1) marks.push(len - 1);
        const cell = (line, m) => (m < line.length ? money0(line[m]) : money0(0));
        UI.html('debt-owed-table', marks.map(m => `<tr><td>${when(m)}</td><td class="num">${cell(planLine, m)}</td><td class="num">${cell(minLine, m)}</td></tr>`).join(''));
    }

    function update(ctx) {
        if (window.Runway) Runway.update(ctx);
        if (window.College) College.update(ctx);
        const s = ctx.state;
        UI.html('metas-steps', Views.stepsHTML(ctx));
        roadmap(ctx);
        debtLadder(ctx);

        // Emergency fund
        const ef = ctx.ef;
        UI.text('ef-liquid', money0(ef.liquid));
        UI.text('ef-essential', `Gastos esenciales: ${money0(ef.monthlyEssential)}/mes`);
        UI.text('ef-step1-label', `${money0(Math.min(ef.liquid, 1000))} / $1,000`);
        document.getElementById('ef-step1-bar').style.width = ef.step1Pct.toFixed(0) + '%';
        UI.text('ef-step3-label', `${ef.monthsCovered.toFixed(1)} meses`);
        document.getElementById('ef-step3-bar').style.width = ef.step3Pct.toFixed(0) + '%';

        // Debts
        const plan = ctx.debts;
        s.debts.forEach(d => {
            const row = document.querySelector(`#debt-body tr[data-row="${d.id}"]`);
            if (!row) return;
            const info = plan.items.find(i => i.id === d.id);
            row.querySelector('[data-cell="order"]').innerHTML = info ? `<span class="badge badge-bad">${info.order}°</span>` : '—';
            const under = plan.underfunded.some(u => u.id === d.id);
            const orig = Math.max(Number(d.originalBalance) || 0, Number(d.balance) || 0);
            const paid = Math.max(0, orig - (Number(d.balance) || 0));
            const paidPct = orig > 0 ? paid / orig : 0;
            row.querySelector('[data-cell="payoff"]').innerHTML = (info && info.payoffMonth ? `Mes ${info.payoffMonth} · ${Fmt.monthYear(Engine.addMonths(ctx.today, info.payoffMonth))}` : (Number(d.balance) > 0 ? 'Nunca' : '—'))
                + (under ? '<span class="block"><span class="badge badge-bad">Bajo el mínimo</span></span>' : '')
                + (orig > 0 ? `<span class="block text-[11px] font-semibold text-slate-500 mt-1">Pagado ${money0(paid)} (${Math.round(paidPct * 100)}%)</span><div class="mini-bar"><span style="width:${(paidPct * 100).toFixed(1)}%;background:#059669"></span></div>` : '');
        });
        UI.text('debt-total', money0(plan.totalBalance));
        UI.text('debt-interest', money0(plan.totalInterest));
        UI.text('debt-saved', plan.minimumsNever ? 'Solo con mínimos: nunca' : `${money0(plan.interestSaved)} · ${plan.monthsSaved} meses`);
        UI.text('debt-free-date', plan.totalBalance <= 0 ? '¡Sin deudas!'
            : plan.never ? 'Nunca con este presupuesto'
            : `${Fmt.monthYear(Engine.addMonths(ctx.today, plan.months))} (${plan.months}m)`);

        // Where the money comes from, and whether the budget can actually pay it.
        UI.text('debt-pool', `${money0(plan.pool)}/mes`);
        UI.html('debt-pool-note', `Mínimos ${money0(plan.totalMin)}${plan.extra > 0 ? ` · ${money0(plan.extra)} extra a la bola de nieve` : ''}${ctx.debtExtraRubros > 0 ? ` (incluye ${money0(ctx.debtExtraRubros)} de otros rubros de deuda)` : ''} · <a href="#" class="link" data-goto="presupuesto/plan">ver presupuesto</a>`);
        document.getElementById('debt-funding').className = `kpi ${plan.totalBalance <= 0 ? 'tone-slate' : plan.shortfall > 0 ? 'tone-red' : 'tone-emerald'}`;
        const warn = document.getElementById('debt-warning');
        const deficit = -ctx.baseBudget.balanceReal;
        let msg = '';
        if (plan.totalBalance > 0 && plan.shortfall > 0) {
            const names = plan.underfunded.map(u => { const d = s.debts.find(x => x.id === u.id); return `<strong>${esc(d.name)}</strong> (le asignas ${money0(d.monthly)}, el mínimo es ${money0(d.minPayment)})`; }).join(', ');
            msg = `<strong>Tu presupuesto no cubre el pago mínimo de:</strong> ${names}. Sin el mínimo el banco te cobra mora y la deuda crece. Sube su monto en "En tu presupuesto" y recorta otros rubros para que te alcance.`;
        } else if (plan.totalBalance > 0 && deficit > 0.005) {
            msg = `<strong>Este plan aún no está financiado:</strong> tu presupuesto gasta ${money0(deficit)} al mes más de lo que ganas. Recorta rubros en tu <a href="#" class="link" data-goto="presupuesto/plan">presupuesto</a> hasta que el balance sea $0 para que estas fechas sean reales.`;
        }
        warn.className = `panel mb-4 text-xs ${msg ? 'tone-red text-red-900' : 'hidden'}`;
        warn.innerHTML = msg ? `<i class="fa-solid fa-triangle-exclamation text-red-600"></i> ${msg}` : '';

        // Goals
        const unfunded = s.goals.filter(g => Engine.goalMonths(g).status === 'never');
        UI.show('goal-warning', unfunded.length > 0);
        if (unfunded.length) UI.html('goal-warning', `<i class="fa-solid fa-circle-info"></i> ${unfunded.map(g => `<strong>${esc(g.name)}</strong>`).join(', ')} no ${unfunded.length > 1 ? 'tienen' : 'tiene'} dinero asignado en tu presupuesto. ${ctx.steps.current <= 2 ? 'Mientras estés en los Pasos 1–2 es normal: primero el fondo de emergencia y las deudas.' : 'Asígnale un monto mensual para que avance.'}`);
        s.goals.forEach(g => {
            const cell = document.querySelector(`#goal-body tr[data-row="${g.id}"] [data-cell="time"]`);
            if (!cell) return;
            const r = Engine.goalMonths(g);
            const sch = Engine.goalSchedule(g, ctx.today);
            const pct = Number(g.target) > 0 ? Math.min(1, (Number(g.current) || 0) / Number(g.target)) : 0;
            const eta = r.status === 'reached' ? '<span class="badge badge-ok">¡Meta alcanzada!</span>'
                : r.status === 'never' ? '<span class="badge badge-bad">Sin aporte en tu presupuesto</span>'
                : `<span class="badge badge-purple">Lista en ${Fmt.monthYear(Engine.addMonths(ctx.today, r.months))}</span>`;
            const track = !sch || r.status === 'reached' ? ''
                : sch.onTrack ? '<span class="badge badge-ok">A tiempo</span>'
                : `<span class="badge badge-bad" title="Para llegar a tiempo">Atrasada: necesitas ${Fmt.money0(sch.required)}/mes</span>`;
            cell.innerHTML = `<div class="flex justify-between text-[11px] text-slate-500"><span>${Fmt.money0(g.current)} de ${Fmt.money0(g.target)}</span><strong>${Math.round(pct * 100)}%</strong></div>
                <div class="mini-bar"><span style="width:${(pct * 100).toFixed(1)}%;background:#7c3aed"></span></div>
                <div class="flex flex-wrap gap-1 mt-1">${eta}${track}</div>`;
        });
    }

    const find = (list, el) => list.find(x => x.id === Number(el.dataset.id));

    UI.register({
        'debt.set': (el) => {
            const d = find(Store.state.debts, el);
            if (!d) return;
            const f = el.dataset.field;
            const v = (f === 'name' || f === 'kind') ? el.value : Math.max(0, parseNum(el.value, 0));
            // If the budgeted amount was just the minimum, keep it following the minimum.
            if (f === 'minPayment' && Math.abs((Number(d.monthly) || 0) - (Number(d.minPayment) || 0)) < 0.005) {
                d.monthly = v;
                const twin = document.querySelector(`#debt-body tr[data-row="${d.id}"] [data-field="monthly"]`);
                if (twin) twin.value = v;
            }
            d[f] = v;
            // A higher balance (a new charge) raises the starting point; paying down doesn't.
            if (f === 'balance' && v > (Number(d.originalBalance) || 0)) d.originalBalance = v;
            App.changed();
        },
        'debt.add': () => {
            const debts = Store.state.debts;
            const id = Store.nextId(debts);
            debts.push({ id, name: 'Nueva deuda', kind: 'personal', balance: 1000, originalBalance: 1000, rate: 15, minPayment: 50, monthly: 50, createdYear: new Date().getFullYear() });
            App.changed({ structural: true });
            UI.toast('Deuda agregada a tu presupuesto con su pago mínimo ($50). Ajusta los montos.');
            const input = document.querySelector(`#debt-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        // A payment: the interest goes first, the rest lowers the balance. It's logged in
        // Transactions on the debt's budget line, and kept in the debt's history.
        'debt.pay': async (el) => {
            const d = find(Store.state.debts, el);
            if (!d) return;
            const est = Engine.debtMonthlyInterest(d);
            const r = await UI.form({
                title: `Pago a "${d.name}"`,
                message: `Saldo: ${money(d.balance)}. Primero se paga el interés del mes y el resto baja el saldo.`,
                fields: [
                    { name: 'amount', label: 'Monto pagado', type: 'number', min: 0, step: '0.01', value: Number(el.dataset.amount) || Number(d.monthly) || Number(d.minPayment) || '' },
                    { name: 'interest', label: 'De eso, interés', type: 'number', min: 0, step: '0.01', value: est, help: `Estimado: saldo × ${Number(d.rate) || 0}% ÷ 12. Si tu estado de cuenta dice otra cifra, escríbela.` },
                    { name: 'date', label: 'Fecha', type: 'date', value: Engine.isoDate(new Date()) },
                    { name: 'log', label: '¿Registrarlo también como movimiento?', options: [{ value: 'yes', label: 'Sí, en Transacciones (cuenta en el rubro de esta deuda)' }, { value: 'no', label: 'No, solo bajar el saldo' }] }
                ],
                confirmText: 'Registrar pago',
                validate: v => !(v.amount > 0) ? 'Escribe un monto mayor a 0.' : v.interest < 0 ? 'El interés no puede ser negativo.' : !v.date ? 'Elige una fecha.' : null
            });
            if (!r) return;
            const amount = Math.round(r.amount * 100) / 100;
            const p = Engine.applyDebtPayment(d.balance, amount, r.interest || 0);
            App.undoable(p.balance <= 0 ? `🎉 ¡Pagaste "${d.name}" por completo!` : `Pago registrado: ${money(p.principal)} al saldo y ${money(p.interest)} de interés. Te quedan ${money(p.balance)}.`, () => {
                d.balance = p.balance;
                d.payments = (d.payments || []).concat([{ date: r.date, amount, interest: p.interest, principal: p.principal, balance: p.balance }]).slice(-120);
                if (r.log === 'yes') {
                    const s = Store.state, tax = s.taxonomy.expense;
                    const cat = tax.Deudas ? 'Deudas' : 'Otros';
                    const kind = Engine.DEBT_KINDS.find(k => k.id === d.kind);
                    const sub = (tax[cat] || []).includes(kind && kind.label) ? kind.label : (tax[cat] || [])[0] || '';
                    s.transactions.push({ id: Store.nextId(s.transactions), type: 'Gasto', description: `Pago: ${d.name}`, store: d.lender || '', parentCategory: cat, category: sub, amount, date: r.date, paymentType: 'Transferencia', budgetLine: 'debt-' + d.id, debtId: d.id, createdAt: new Date().toISOString() });
                }
            });
            if (p.overpaid > 0) UI.toast(`Pagaste ${money(p.overpaid)} más que el saldo: revisa si quedó saldo a tu favor.`, 'warn');
        },
        'debt.delete': (el) => {
            const d = find(Store.state.debts, el);
            App.undoable(`Deuda "${d.name}" eliminada (y quitada de tu presupuesto)`, () => { Store.state.debts = Store.state.debts.filter(x => x !== d); });
        },
        'goal.set': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const f = el.dataset.field;
            g[f] = f === 'name' || f === 'targetDate' ? el.value : Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'goal.add': () => {
            const goals = Store.state.goals;
            const id = Store.nextId(goals);
            goals.push({ id, name: 'Nueva meta', target: 10000, current: 0, monthly: 0, rate: Number(Store.active().tasa) || 0, createdYear: new Date().getFullYear() });
            App.changed({ structural: true });
            UI.toast('Meta agregada al Ahorro de tu presupuesto. Asígnale un monto mensual.');
            const input = document.querySelector(`#goal-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        // A deposit adds to what's saved; optionally it's also logged as a transfer to savings.
        'goal.deposit': async (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const r = await UI.form({
                title: `Depositar en "${g.name}"`,
                fields: [
                    { name: 'amount', label: 'Monto', type: 'number', min: 0, step: '0.01', value: Number(el.dataset.amount) || Number(g.monthly) || '' },
                    { name: 'log', label: '¿Registrarlo también como movimiento?', options: [{ value: 'yes', label: 'Sí, en Transacciones (cuenta en su línea del presupuesto)' }, { value: 'no', label: 'No, solo sumar a lo ahorrado' }] }
                ],
                confirmText: 'Depositar',
                validate: v => Number(v.amount) > 0 ? null : 'Escribe un monto mayor a 0.'
            });
            if (!r) return;
            const amount = Math.round(Number(r.amount) * 100) / 100;
            g.current = Math.round(((Number(g.current) || 0) + amount) * 100) / 100;
            if (r.log === 'yes') {
                const txns = Store.state.transactions;
                const tax = Store.state.taxonomy.expense;
                const cat = tax['Ahorro e Inversión'] ? 'Ahorro e Inversión' : 'Otros';
                txns.push({ id: Store.nextId(txns), type: 'Gasto', description: `Depósito: ${g.name}`, store: '', parentCategory: cat, category: (tax[cat] || [])[0] || '', amount, date: Engine.isoDate(new Date()), paymentType: 'Transferencia', budgetLine: 'goal-' + g.id });
            }
            App.changed({ structural: true, step: true });
            UI.toast(`${Fmt.money(amount)} depositados en "${g.name}". Llevas ${Fmt.money0(g.current)} de ${Fmt.money0(g.target)}.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        },
        // Spend what was saved for this: the purchase is logged in its own category (so reports
        // show where the money went) but paid by the goal, so it doesn't count in this month's
        // budget a second time. What the goal can't cover counts normally.
        'goal.spend': async (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const pre = el.dataset || {};
            const s = Store.state, tax = s.taxonomy.expense;
            const cats = Object.keys(tax);
            if (pre.cat && cats.includes(pre.cat)) cats.unshift(cats.splice(cats.indexOf(pre.cat), 1)[0]);
            const r = await UI.form({
                title: `Usar el dinero de "${g.name}"`,
                message: `Tienes ${money(g.current)} ahorrados aquí. La compra queda en Transacciones, pero no cuenta otra vez en tu presupuesto del mes: ya la fuiste apartando.`,
                fields: [
                    { name: 'amount', label: 'Monto', type: 'number', min: 0, step: '0.01', value: pre.amount || '' },
                    { name: 'desc', label: '¿Qué pagaste?', value: pre.desc || g.name },
                    { name: 'cat', label: 'Categoría', options: cats },
                    { name: 'date', label: 'Fecha', type: 'date', value: Engine.isoDate(new Date()) }
                ],
                confirmText: 'Registrar',
                validate: v => !(v.amount > 0) ? 'Escribe un monto mayor a 0.' : !v.desc.trim() ? 'Escribe qué pagaste.' : !v.date ? 'Elige una fecha.' : null
            });
            if (!r) return;
            const amount = Math.round(r.amount * 100) / 100;
            const covered = Math.min(amount, Math.max(0, Number(g.current) || 0));
            const rest = Math.round((amount - covered) * 100) / 100;
            const sub = pre.sub && (tax[r.cat] || []).includes(pre.sub) ? pre.sub : (tax[r.cat] || [])[0] || '';
            App.undoable(rest > 0 ? `${money(covered)} pagados con «${g.name}»; los otros ${money(rest)} cuentan en tu presupuesto del mes.` : `${money(amount)} pagados con «${g.name}». Quedan ${money(Number(g.current) - covered)}.`, () => {
                g.current = Math.round(((Number(g.current) || 0) - covered) * 100) / 100;
                const base = { type: 'Gasto', description: r.desc.trim(), store: '', parentCategory: r.cat, category: sub, date: r.date, paymentType: 'Tarjeta de Débito', createdAt: new Date().toISOString() };
                if (covered > 0) s.transactions.push(Object.assign({ id: Store.nextId(s.transactions), amount: covered, fromGoal: g.id }, base));
                if (rest > 0) s.transactions.push(Object.assign({ id: Store.nextId(s.transactions), amount: rest }, base));
            });
        },
        'goal.delete': (el) => {
            const g = find(Store.state.goals, el);
            App.undoable(`Meta "${g.name}" eliminada (y quitada de tu presupuesto)`, () => { Store.state.goals = Store.state.goals.filter(x => x !== g); });
        }
    });

    App.defineView('futuro/metas', { render, update });
})();
