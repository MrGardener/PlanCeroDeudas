/* Deudas y Metas: Baby Steps progress, emergency fund, debt payoff plan and savings goals. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    function debtRow(d) {
        return `<tr data-row="${d.id}">
            <td><input class="cell-input" value="${esc(d.name)}" data-change="debt.set" data-id="${d.id}" data-field="name" aria-label="Nombre de la deuda"></td>
            <td><select class="cell-input" data-change="debt.set" data-id="${d.id}" data-field="kind">${Views.selectOptions(Engine.DEBT_KINDS.map(k => ({ value: k.id, label: k.label })), d.kind)}</select></td>
            <td><input type="number" class="cell-input num" min="0" step="50" value="${Number(d.balance) || 0}" data-input="debt.set" data-id="${d.id}" data-field="balance" aria-label="Saldo"></td>
            <td><input type="number" class="cell-input num" min="0" step="0.1" value="${Number(d.rate) || 0}" data-input="debt.set" data-id="${d.id}" data-field="rate" aria-label="Tasa"></td>
            <td><input type="number" class="cell-input num" min="0" step="5" value="${Number(d.minPayment) || 0}" data-input="debt.set" data-id="${d.id}" data-field="minPayment" aria-label="Pago mínimo"></td>
            <td><input type="number" class="cell-input num money" min="0" step="10" value="${Number(d.monthly) || 0}" data-input="debt.set" data-id="${d.id}" data-field="monthly" aria-label="Monto en tu presupuesto" title="Lo que tu presupuesto le paga cada mes"></td>
            <td class="text-center" data-cell="order"></td>
            <td class="text-center whitespace-nowrap font-bold text-slate-700" data-cell="payoff"></td>
            <td class="text-center"><button class="row-del" data-action="debt.delete" data-id="${d.id}" title="Eliminar deuda"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function goalRow(g) {
        const cell = (field, step) => `<td><input type="number" class="cell-input num" min="0" step="${step}" value="${Number(g[field]) || 0}" data-input="goal.set" data-id="${g.id}" data-field="${field}"></td>`;
        return `<tr data-row="${g.id}">
            <td><input class="cell-input" value="${esc(g.name)}" data-change="goal.set" data-id="${g.id}" data-field="name" aria-label="Nombre de la meta"></td>
            ${cell('target', 100)}${cell('current', 100)}${cell('monthly', 10).replace('cell-input num', 'cell-input num money')}${cell('rate', 0.1)}
            <td><input type="month" class="cell-input" value="${esc(g.targetDate || '')}" data-change="goal.set" data-id="${g.id}" data-field="targetDate" aria-label="Fecha meta"></td>
            <td data-cell="time"></td>
            <td class="text-center whitespace-nowrap"><button class="mini-btn" data-action="goal.deposit" data-id="${g.id}" title="Sumar un depósito a lo ahorrado">Depositar</button> <button class="row-del" data-action="goal.delete" data-id="${g.id}" title="Eliminar meta"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function render(ctx) {
        const s = ctx.state;
        UI.html('debt-body', s.debts.length ? s.debts.map(debtRow).join('') : '<tr class="empty-row"><td colspan="9">¡Sin deudas registradas! Si tienes alguna, agrégala para armar tu plan.</td></tr>');
        UI.html('goal-body', s.goals.length ? s.goals.map(goalRow).join('') : '<tr class="empty-row"><td colspan="8">Agrega una meta: un carro, un terreno, la universidad…</td></tr>');
        update(ctx);
    }

    function update(ctx) {
        const s = ctx.state;
        UI.html('metas-steps', Views.stepsHTML(ctx));

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
            row.querySelector('[data-cell="payoff"]').innerHTML = (info && info.payoffMonth ? `Mes ${info.payoffMonth} · ${Fmt.monthYear(Engine.addMonths(ctx.today, info.payoffMonth))}` : (Number(d.balance) > 0 ? 'Nunca' : '—'))
                + (under ? '<span class="block"><span class="badge badge-bad">Bajo el mínimo</span></span>' : '');
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
            cell.innerHTML = `<div class="flex justify-between text-[10px] text-slate-500"><span>${Fmt.money0(g.current)} de ${Fmt.money0(g.target)}</span><strong>${Math.round(pct * 100)}%</strong></div>
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
            App.changed();
        },
        'debt.add': () => {
            const debts = Store.state.debts;
            const id = Store.nextId(debts);
            debts.push({ id, name: 'Nueva deuda', kind: 'personal', balance: 1000, rate: 15, minPayment: 50, monthly: 50, createdYear: new Date().getFullYear() });
            App.changed({ structural: true });
            UI.toast('Deuda agregada a tu presupuesto con su pago mínimo ($50). Ajusta los montos.');
            const input = document.querySelector(`#debt-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
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
                    { name: 'amount', label: 'Monto', type: 'number', min: 0, step: '0.01', value: Number(g.monthly) || '' },
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
        'goal.delete': (el) => {
            const g = find(Store.state.goals, el);
            App.undoable(`Meta "${g.name}" eliminada (y quitada de tu presupuesto)`, () => { Store.state.goals = Store.state.goals.filter(x => x !== g); });
        }
    });

    App.defineView('metas', { render, update });
})();
