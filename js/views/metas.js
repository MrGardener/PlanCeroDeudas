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
            <td class="text-center" data-cell="order"></td>
            <td class="text-center whitespace-nowrap font-bold text-slate-700" data-cell="payoff"></td>
            <td class="text-center"><button class="row-del" data-action="debt.delete" data-id="${d.id}" title="Eliminar deuda"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function goalRow(g) {
        const cell = (field, step) => `<td><input type="number" class="cell-input num" min="0" step="${step}" value="${Number(g[field]) || 0}" data-input="goal.set" data-id="${g.id}" data-field="${field}"></td>`;
        return `<tr data-row="${g.id}">
            <td><input class="cell-input" value="${esc(g.name)}" data-change="goal.set" data-id="${g.id}" data-field="name" aria-label="Nombre de la meta"></td>
            ${cell('target', 100)}${cell('current', 100)}${cell('monthly', 10)}${cell('rate', 0.1)}
            <td class="text-center" data-cell="time"></td>
            <td class="text-center"><button class="row-del" data-action="goal.delete" data-id="${g.id}" title="Eliminar meta"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function render(ctx) {
        const s = ctx.state;
        UI.html('debt-body', s.debts.length ? s.debts.map(debtRow).join('') : '<tr class="empty-row"><td colspan="8">¡Sin deudas registradas! Si tienes alguna, agrégala para armar tu plan.</td></tr>');
        UI.html('goal-body', s.goals.length ? s.goals.map(goalRow).join('') : '<tr class="empty-row"><td colspan="7">Agrega una meta: un carro, un terreno, la universidad…</td></tr>');
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
            row.querySelector('[data-cell="payoff"]').textContent = info && info.payoffMonth ? `Mes ${info.payoffMonth} · ${Fmt.monthYear(Engine.addMonths(ctx.today, info.payoffMonth))}` : (Number(d.balance) > 0 ? 'Nunca' : '—');
        });
        UI.text('debt-total', money0(plan.totalBalance));
        UI.text('debt-interest', money0(plan.totalInterest));
        UI.text('debt-saved', `${money0(plan.interestSaved)} · ${plan.monthsSaved} meses`);
        UI.text('debt-free-date', plan.totalBalance <= 0 ? '¡Sin deudas!'
            : plan.never ? 'Nunca: sube el pago'
            : `${Fmt.monthYear(Engine.addMonths(ctx.today, plan.months))} (${plan.months}m)`);

        // Goals
        s.goals.forEach(g => {
            const cell = document.querySelector(`#goal-body tr[data-row="${g.id}"] [data-cell="time"]`);
            if (!cell) return;
            const r = Engine.goalMonths(g);
            cell.innerHTML = r.status === 'reached' ? '<span class="badge badge-ok">¡Meta alcanzada!</span>'
                : r.status === 'never' ? '<span class="badge badge-bad">Nunca: agrega un aporte</span>'
                : `<span class="badge badge-purple">${r.months} meses (${(r.months / 12).toFixed(1)} años)</span><span class="block text-[10px] text-slate-500 mt-0.5">${Fmt.monthYear(Engine.addMonths(ctx.today, r.months))}</span>`;
        });
    }

    const find = (list, el) => list.find(x => x.id === Number(el.dataset.id));

    UI.register({
        'debt.set': (el) => {
            const d = find(Store.state.debts, el);
            if (!d) return;
            const f = el.dataset.field;
            d[f] = (f === 'name' || f === 'kind') ? el.value : Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'debt.add': () => {
            const debts = Store.state.debts;
            const id = Store.nextId(debts);
            debts.push({ id, name: 'Nueva deuda', kind: 'personal', balance: 1000, rate: 15, minPayment: 50 });
            App.changed({ structural: true });
            const input = document.querySelector(`#debt-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'debt.delete': (el) => {
            const d = find(Store.state.debts, el);
            App.undoable(`Deuda "${d.name}" eliminada`, () => { Store.state.debts = Store.state.debts.filter(x => x !== d); });
        },
        'goal.set': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const f = el.dataset.field;
            g[f] = f === 'name' ? el.value : Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'goal.add': () => {
            const goals = Store.state.goals;
            const id = Store.nextId(goals);
            goals.push({ id, name: 'Nueva meta', target: 10000, current: 0, monthly: 150, rate: Number(Store.active().tasa) || 0 });
            App.changed({ structural: true });
            const input = document.querySelector(`#goal-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'goal.delete': (el) => {
            const g = find(Store.state.goals, el);
            App.undoable(`Meta "${g.name}" eliminada`, () => { Store.state.goals = Store.state.goals.filter(x => x !== g); });
        }
    });

    App.defineView('metas', { render, update });
})();
