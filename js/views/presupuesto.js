/* Presupuesto → Presupuesto del Mes: zero-based budget table, grouped by type. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    const GROUPS = [
        { type: 'Gasto Fijo', label: 'Gastos fijos' },
        { type: 'Gasto Variable', label: 'Gastos variables' },
        { type: 'Deuda', label: 'Pagos de deudas' },
        { type: 'Ahorro', label: 'Ahorro e inversión' }
    ];
    const groupOf = (item) => {
        const t = item.type || '';
        if (GROUPS.some(g => g.type === t)) return t;
        return t.includes('Ahorro') ? 'Ahorro' : 'Otros';
    };

    const month = () => Store.ui.month;
    // Includes the lines generated from your debts and goals (see Store.linkedRows).
    const items = (ctx) => Engine.monthItems(ctx.budgetYear, month());

    // Editing a specific month for the first time gives it its own copy of the base budget.
    function editableItems() {
        const yd = Store.active();
        const m = month();
        if (m !== 'base' && !yd.monthOverrides[m]) yd.monthOverrides[m] = Defaults.clone(yd.budgetBase);
        return Engine.monthItems(yd, m);
    }

    // Debt and goal lines: their amount is the debt's/goal's monthly budget (same number in
    // every month); name, type and deletion are managed from Deudas y Metas.
    function linkedRowHTML(item) {
        const isDebt = item.link === 'debt';
        const input = (field) => `<input type="number" class="cell-input num money" step="10" min="0" value="${Number(item[field]) || 0}" data-input="budget.setLinked" data-kind="${item.link}" data-ref="${item.refId}" data-field="${field}" aria-label="${field === 'prep' ? 'Presupuestado' : 'Real'}" title="Monto mensual para todo el año. También se edita en Deudas y Metas.">`;
        return `
            <tr data-row="${item.id}" class="bg-slate-50/60">
                <td><div class="flex items-center gap-2 px-1"><span class="font-semibold text-slate-800 truncate">${esc(item.name)}</span><a href="#" class="badge ${isDebt ? 'badge-bad' : 'badge-purple'} shrink-0" data-goto="metas" data-focus="${isDebt ? 'metas-debts' : 'metas-goals'}" title="Se gestiona en Deudas y Metas"><i class="fa-solid fa-link"></i> ${isDebt ? 'Deuda' : 'Meta'}</a></div></td>
                <td class="text-xs text-slate-500 px-3">${isDebt ? 'Pago Deuda' : 'Ahorro (meta)'}</td>
                <td class="text-center text-slate-300">—</td>
                <td>${input('prep')}</td>
                <td>${input('real')}</td>
                <td class="num font-bold" data-cell="diff"></td>
                <td class="text-xs text-slate-500 px-3">${esc(item.linkedCategory)}</td>
                <td data-cell="spend"></td>
                <td class="text-center"><a href="#" class="row-del" data-goto="metas" data-focus="${isDebt ? 'metas-debts' : 'metas-goals'}" title="Editar o eliminar en Deudas y Metas"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>
            </tr>`;
    }

    // ---------------------------------------------------------------- income
    // The salary (from "Tu Sueldo"), the person's other recurring income, and income logged
    // as transactions this month. See Engine.otherIncome for how they combine.
    function incomeRowsHTML(ctx) {
        const m = month();
        const other = Engine.otherIncome(ctx.budgetYear, m);
        const cats = [{ value: 'none', label: 'Sin vincular' }].concat(Object.keys(ctx.state.taxonomy.income).map(c => ({ value: c, label: c })));
        const catOptions = (cur) => Views.selectOptions(cur && cur !== 'none' && !cats.some(c => c.value === cur) ? cats.concat([{ value: cur, label: cur }]) : cats, cur || 'none');
        const cells = '<td class="num font-bold" data-cell="prep"></td><td class="num font-bold" data-cell="real"></td><td class="num font-bold" data-cell="diff"></td>';
        let html = `<tr class="group-row" data-group="income"><td colspan="3">Ingresos <span data-gcell="note" class="normal-case font-semibold text-emerald-700"></span></td><td class="num" data-gcell="prep"></td><td class="num" data-gcell="real"></td><td class="num" data-gcell="diff"></td><td colspan="3"></td></tr>
            <tr data-income="salary" class="bg-emerald-50/40">
                <td><div class="flex items-center gap-2 px-1"><span class="font-semibold text-slate-800">Sueldo neto</span><a href="#" class="badge badge-ok shrink-0" data-goto="presupuesto/ingresos" title="Se calcula en Ingresos e Impuestos"><i class="fa-solid fa-link"></i> Tu Sueldo</a></div></td>
                <td class="text-xs text-slate-500 px-3">Sueldo</td><td class="text-center text-slate-300">—</td>${cells}
                <td class="text-xs text-slate-500 px-3">Ingresos Laborales</td><td class="text-xs text-slate-500" data-cell="spend"></td>
                <td class="text-center"><a href="#" class="row-del" data-goto="presupuesto/ingresos" title="Editar tu sueldo"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>
            </tr>`;
        (ctx.year.otherIncomes || []).forEach(src => {
            html += `<tr data-income="${src.id}" class="bg-emerald-50/40">
                <td><input class="cell-input" value="${esc(src.name)}" data-change="income.set" data-id="${src.id}" data-field="name" aria-label="Nombre del ingreso"></td>
                <td class="text-xs text-slate-500 px-3">Otro ingreso</td><td class="text-center text-slate-300">—</td>
                <td><input type="number" class="cell-input num money" step="10" min="0" value="${Number(src.amount) || 0}" data-input="income.set" data-id="${src.id}" data-field="amount" aria-label="Monto mensual" title="Lo que recibes cada mes (neto). Aplica a todos los meses del año."></td>
                <td class="num font-bold" data-cell="real"></td><td class="num font-bold" data-cell="diff"></td>
                <td><select class="cell-input" data-change="income.set" data-id="${src.id}" data-field="category" title="Categoría de ingreso de tus transacciones">${catOptions(src.category)}</select></td>
                <td data-cell="spend"></td>
                <td class="text-center"><button class="row-del" data-action="income.delete" data-id="${src.id}" title="Eliminar ingreso"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`;
        });
        other.unplanned.forEach(u => {
            html += `<tr data-income="cat:${esc(u.category)}" class="bg-emerald-50/40">
                <td><div class="px-1"><span class="font-semibold text-slate-800">${esc(u.category)}</span><span class="block text-[10px] text-slate-500">Registrado este mes: ${esc(u.txns.map(t => t.description).join(', '))}</span></div></td>
                <td class="text-xs text-slate-500 px-3">Transacciones</td><td class="text-center text-slate-300">—</td>${cells}
                <td class="text-xs text-slate-500 px-3">${esc(u.category)}</td>
                <td><button type="button" class="mini-btn" data-action="income.fromCategory" data-category="${esc(u.category)}" data-amount="${u.amount}" title="Lo recibes todos los meses: agrégalo como ingreso mensual">Es mensual</button></td>
                <td class="text-center"><a href="#" class="row-del" data-goto="presupuesto/transacciones" title="Ver transacciones"><i class="fa-solid fa-arrow-up-right-from-square"></i></a></td>
            </tr>`;
        });
        if (other.payroll.length) {
            html += `<tr><td colspan="9" class="text-[11px] text-amber-900 bg-amber-50 px-3 py-2"><i class="fa-solid fa-circle-info text-amber-600"></i> No sumamos ${other.payroll.length === 1 ? 'este ingreso registrado' : 'estos ingresos registrados'} como sueldo/décimo, porque tu sueldo ya viene de "Tu Sueldo": `
                + other.payroll.map(t => `<strong>${esc(t.description)}</strong> (${money(t.amount)}) <button type="button" class="mini-btn" data-action="income.countExtra" data-id="${t.id}">Es un ingreso extra</button>`).join(' · ') + '</td></tr>';
        }
        return html;
    }

    function updateIncome(ctx) {
        const m = month();
        const mb = ctx.monthBudget;
        const other = Engine.otherIncome(ctx.budgetYear, m);
        const bonus = Engine.bonusForMonth(ctx.budgetYear, m);
        const set = (row, prep, real) => {
            if (!row) return;
            const p = row.querySelector('[data-cell="prep"]');
            if (p) p.textContent = money(prep);
            row.querySelector('[data-cell="real"]').textContent = money(real);
            const dc = row.querySelector('[data-cell="diff"]');
            dc.textContent = money(real - prep);
            dc.className = `num font-bold ${real - prep >= -0.005 ? 'text-emerald-600' : 'text-red-600'}`;
        };
        const salaryRow = document.querySelector('#bud-body tr[data-income="salary"]');
        set(salaryRow, mb.salary, mb.salary);
        if (salaryRow) salaryRow.querySelector('[data-cell="spend"]').textContent = bonus > 0 ? `Incluye décimo (${money0(bonus)})` : 'Calculado de tu sueldo bruto';
        other.sources.forEach(src => {
            const row = document.querySelector(`#bud-body tr[data-income="${src.id}"]`);
            if (!row) return;
            set(row, src.planned, src.amount);
            const cell = row.querySelector('[data-cell="spend"]');
            if (m === 'base') cell.innerHTML = '<span class="text-xs text-slate-500">Todos los meses</span>';
            else if (!src.category) cell.innerHTML = '<span class="text-[11px] text-slate-500">Vincúlalo a una categoría para comparar con lo registrado</span>';
            else if (src.sharedWith) cell.innerHTML = `<span class="text-[11px] text-slate-500">Lo registrado en esta categoría ya cuenta en «${esc(src.sharedWith)}»</span>`;
            else cell.innerHTML = (src.received + 0.005 >= src.planned
                ? `<span class="badge badge-ok">Recibido ${money0(src.received)}</span>`
                : `<span class="badge badge-warn">Recibido ${money0(src.received)} de ${money0(src.planned)}</span>`)
                + (src.txns.length ? `<span class="block text-[10px] text-slate-500 mt-0.5">${esc(src.txns.map(t => t.description).join(', '))}</span>` : '');
        });
        other.unplanned.forEach(u => set(document.querySelector(`#bud-body tr[data-income="cat:${CSS.escape(u.category)}"]`), 0, u.amount));
        const g = document.querySelector('#bud-body tr.group-row[data-group="income"]');
        if (g) {
            g.querySelector('[data-gcell="prep"]').textContent = money(mb.incomePrep);
            g.querySelector('[data-gcell="real"]').textContent = money(mb.income);
            g.querySelector('[data-gcell="diff"]').textContent = money(mb.income - mb.incomePrep);
            g.querySelector('[data-gcell="note"]').textContent = mb.otherIncome > 0 ? ` · sueldo + ${money0(mb.otherIncome)} de otros ingresos` : '';
        }
        return other;
    }

    function rowHTML(item, taxonomy) {
        if (item.link) return linkedRowHTML(item);
        const cats = [{ value: 'none', label: 'Sin vincular' }].concat(Object.keys(taxonomy).map(c => ({ value: c, label: c })));
        const linked = item.linkedCategory || 'none';
        if (linked !== 'none' && !taxonomy[linked]) cats.push({ value: linked, label: linked + ' (eliminada)' });
        const id = item.id;
        return `
            <tr data-row="${id}">
                <td><input class="cell-input" value="${esc(item.name)}" data-change="budget.set" data-id="${id}" data-field="name" aria-label="Nombre del rubro"></td>
                <td><select class="cell-input" data-change="budget.set" data-id="${id}" data-field="type">${Views.selectOptions(Defaults.BUDGET_TYPES, item.type)}</select></td>
                <td class="text-center"><input type="checkbox" class="w-4 h-4 accent-emerald-600" ${item.isDeductible ? 'checked' : ''} data-change="budget.set" data-id="${id}" data-field="isDeductible" title="Deducible en el impuesto a la renta"></td>
                <td><input type="number" class="cell-input num money" step="10" min="0" value="${Number(item.prep) || 0}" data-input="budget.set" data-id="${id}" data-field="prep" aria-label="Presupuestado"></td>
                <td><input type="number" class="cell-input num money" step="10" min="0" value="${Number(item.real) || 0}" data-input="budget.set" data-id="${id}" data-field="real" aria-label="Real"></td>
                <td class="num font-bold" data-cell="diff"></td>
                <td><select class="cell-input" data-change="budget.set" data-id="${id}" data-field="linkedCategory">${Views.selectOptions(cats, linked)}</select></td>
                <td data-cell="spend"></td>
                <td class="text-center"><button class="row-del" data-action="budget.delete" data-id="${id}" title="Eliminar rubro"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`;
    }

    function render(ctx) {
        const yd = ctx.year;
        const m = month();
        UI.html('budget-month', Views.selectOptions(Views.monthOptions(yd), m));

        const list = items(ctx);
        const tax = ctx.state.taxonomy.expense;
        const byGroup = {};
        list.forEach(it => { (byGroup[groupOf(it)] = byGroup[groupOf(it)] || []).push(it); });
        const order = GROUPS.map(g => g.type).concat(Object.keys(byGroup).filter(k => !GROUPS.some(g => g.type === k)));
        const body = order.filter(g => byGroup[g]).map(g => {
            const label = (GROUPS.find(x => x.type === g) || { label: g }).label;
            return `<tr class="group-row" data-group="${esc(g)}"><td colspan="3">${esc(label)} <span data-gcell="note" class="normal-case font-semibold text-emerald-700"></span></td><td class="num" data-gcell="prep"></td><td class="num" data-gcell="real"></td><td class="num" data-gcell="diff"></td><td colspan="3"></td></tr>`
                + byGroup[g].map(it => rowHTML(it, tax)).join('');
        }).join('');
        UI.html('bud-body', incomeRowsHTML(ctx) + (body || '<tr class="empty-row"><td colspan="9">No hay rubros. Agrega el primero.</td></tr>'));
        update(ctx);
    }

    function update(ctx) {
        const yd = ctx.year;
        const m = month();
        const mb = ctx.monthBudget;
        const today = ctx.today;
        const list = items(ctx);

        const note = document.getElementById('bud-month-note');
        if (m === 'base') {
            note.innerHTML = 'Este es tu <strong>presupuesto base</strong>: aplica a todos los meses que no tengan uno propio. Elige un mes para ajustar gastos puntuales (útiles escolares, Navidad…).';
        } else if (yd.monthOverrides[m]) {
            note.innerHTML = `<strong>${Fmt.MONTH_NAMES[m - 1]}</strong> tiene su propio presupuesto. <button type="button" class="link" data-action="budget.resetMonth">Volver al presupuesto base</button>`;
        } else {
            note.innerHTML = `${Fmt.MONTH_NAMES[m - 1]} usa el presupuesto base. Al editar cualquier valor se crea un presupuesto propio para este mes.`;
        }

        // Income that was logged in the current month shows up in that month, not in the base
        // budget: point at it so it isn't missed.
        if (m === 'base' && ctx.state.activeYear === today.getFullYear()) {
            const cm = String(today.getMonth() + 1);
            const cur = Engine.otherIncome(ctx.budgetYear, cm);
            if (cur.extraReceived > 0.005) note.innerHTML += ` <span class="block mt-1 text-emerald-800"><i class="fa-solid fa-circle-plus"></i> En ${Fmt.MONTH_NAMES[cm - 1]} registraste ${money(cur.extraReceived)} de ingresos extra: se suman a ese mes. <button type="button" class="link" data-action="budget.showMonth" data-month="${cm}">Ver ${Fmt.MONTH_NAMES[cm - 1]}</button></span>`;
        }

        const other = updateIncome(ctx);

        // Summary tiles
        UI.text('bud-income', money(mb.income));
        const bonus = Engine.bonusForMonth(yd, m);
        const parts = ['Sueldo neto'];
        if (bonus > 0) parts.push(`décimo (${money0(bonus)})`);
        if (other.total > 0) parts.push(`otros ingresos (${money0(other.total)})`);
        UI.text('bud-income-note', parts.join(' + '));
        UI.text('bud-assigned', money(mb.expReal + mb.sweep));
        UI.text('bud-assigned-prep', money(mb.expPrep));
        const bal = mb.balanceReal;
        const box = document.getElementById('bud-balance-box');
        const noteEl = document.getElementById('bud-balance-note');
        UI.text('bud-balance-label', bal < -0.005 ? 'Te falta' : 'Por asignar');
        if (Math.abs(bal) < 0.005) { box.className = 'kpi tone-emerald'; noteEl.textContent = mb.sweep > 0 ? `✓ Cada dólar tiene un destino (${money(mb.sweep)} barridos a ahorro).` : '✓ Presupuesto base cero: cada dólar tiene un destino.'; }
        else if (bal > 0) { box.className = 'kpi tone-amber'; noteEl.textContent = 'Asígnalo a un rubro (o activa el barrido a ahorro).'; }
        else {
            box.className = 'kpi tone-red';
            noteEl.textContent = `Tus rubros superan tu ingreso por ${money(-bal)}. ${yd.sweepSavings ? 'El barrido solo mueve dinero que sobra; no puede cubrir lo que falta. ' : ''}Recorta rubros o agrega otro ingreso.`;
        }
        UI.text('bud-balance', money(bal));

        const sweepEl = document.getElementById('bud-sweep');
        const shortfall = yd.sweepSavings && bal < -0.005;
        sweepEl.className = `badge ${shortfall ? 'badge-bad' : 'badge-ok'}`;
        UI.show(sweepEl, yd.sweepSavings && (mb.sweep > 0 || shortfall));
        sweepEl.textContent = shortfall ? `Nada que barrer: te faltan ${money(-bal)}` : `+${money(mb.sweep)} barrido a ahorro`;

        // Rows: diff and spend-vs-budget cells
        const period = m === 'base' ? 'base' : m;
        list.forEach(it => {
            const row = document.querySelector(`#bud-body tr[data-row="${it.id}"]`);
            if (!row) return;
            const diff = (Number(it.prep) || 0) - (Number(it.real) || 0);
            const dc = row.querySelector('[data-cell="diff"]');
            dc.textContent = money(diff);
            dc.className = `num font-bold ${diff >= 0 ? 'text-emerald-600' : 'text-red-600'}`;
            if (it.link) {
                // Keep the twin input (Presupuestado/Real of the same line) in step.
                row.querySelectorAll('[data-input="budget.setLinked"]').forEach(inp => { if (inp !== document.activeElement) inp.value = Number(it.prep) || 0; });
                const cell = row.querySelector('[data-cell="spend"]');
                if (it.link === 'debt') {
                    cell.innerHTML = it.real + 0.005 >= it.minPayment
                        ? `<span class="badge badge-ok" title="Pago mínimo del banco">Cubre el mínimo (${money0(it.minPayment)})</span>`
                        : `<span class="badge badge-bad" title="Pago mínimo del banco">Mínimo: ${money0(it.minPayment)}</span>`;
                } else {
                    const g = ctx.state.goals.find(x => x.id === it.refId) || {};
                    const r = Engine.goalMonths(g);
                    cell.innerHTML = r.status === 'reached' ? '<span class="badge badge-ok">¡Meta alcanzada!</span>'
                        : r.status === 'never' ? '<span class="badge badge-bad">Sin aporte: nunca llega</span>'
                        : `<span class="badge badge-purple">Lista en ${Fmt.monthYear(Engine.addMonths(today, r.months))}</span>`;
                }
                return;
            }
            const spent = Engine.categorySpend(ctx.state.transactions, it.linkedCategory, ctx.state.activeYear, period);
            const target = Engine.categoryTarget(it, ctx.state.activeYear, period, today);
            row.querySelector('[data-cell="spend"]').innerHTML = Views.spendBadge(Engine.spendStatus(spent, target));
        });
        UI.text('bud-spend-head', m === 'base' ? 'Gastado vs. presupuesto (año a la fecha)' : 'Gastado vs. presupuesto (mes)');

        // Group subtotals
        UI.$$('#bud-body tr.group-row').forEach(gr => {
            const g = gr.dataset.group;
            if (g === 'income') return;
            const gi = list.filter(it => groupOf(it) === g);
            const prep = gi.reduce((s, i) => s + (Number(i.prep) || 0), 0);
            const real = gi.reduce((s, i) => s + (Number(i.real) || 0), 0);
            gr.querySelector('[data-gcell="prep"]').textContent = money(prep);
            gr.querySelector('[data-gcell="real"]').textContent = money(real);
            gr.querySelector('[data-gcell="diff"]').textContent = money(prep - real);
            const noteCell = gr.querySelector('[data-gcell="note"]');
            if (g === 'Ahorro') noteCell.textContent = mb.sweep > 0 ? ` + ${money(mb.sweep)} barrido` : '';
            if (g === 'Deuda') {
                const plan = ctx.debts;
                noteCell.innerHTML = plan.totalBalance <= 0 ? ''
                    : plan.shortfall > 0 ? ` <span class="text-red-600">· faltan ${money0(plan.shortfall)} para los mínimos</span>`
                    : ` · libre de deudas en ${Fmt.monthYear(Engine.addMonths(today, plan.months))}${plan.extra > 0 ? ` (${money0(plan.extra)} extra a la bola de nieve)` : ''}`;
            }
        });

        // Footer
        UI.text('bud-f-inc-prep', money(mb.incomePrep));
        UI.text('bud-f-inc-real', money(mb.income));
        UI.text('bud-f-exp-prep', money(mb.expPrep));
        UI.text('bud-f-exp-real', money(mb.expReal + mb.sweep));
        UI.text('bud-f-exp-diff', money(mb.expPrep - mb.expReal - mb.sweep));
        UI.text('bud-f-bal-prep', money(mb.balancePrep));
        UI.text('bud-f-bal-real', money(bal));

        // Budgeted but untouched categories → money that could go to debts or savings
        // Only categories you actually log transactions for: "no spending" in a category you
        // never track just means "not tracked", not money saved.
        const tracked = new Set(ctx.state.transactions.map(t => t.parentCategory));
        const opps = list
            .filter(it => tracked.has(it.linkedCategory) && !Engine.isSavingsItem(it))
            .map(it => ({ it, target: Engine.categoryTarget(it, ctx.state.activeYear, period, today), spent: Engine.categorySpend(ctx.state.transactions, it.linkedCategory, ctx.state.activeYear, period) }))
            .filter(o => o.target > 0 && o.spent === 0);
        UI.show('bud-opportunities', opps.length > 0);
        if (opps.length) {
            UI.text('bud-opp-total', money(opps.reduce((s, o) => s + o.target, 0)));
            UI.text('bud-opp-list', opps.map(o => `${o.it.name} (${money0(o.target)})`).join(', '));
        }

        // Budget vs actual trend
        const trend = Engine.budgetVsActualByMonth(ctx.budgetYear, ctx.state.transactions, ctx.state.activeYear);
        const anyLinked = Engine.MONTHS.some(mm => Engine.monthItems(ctx.budgetYear, mm).some(i => i.linkedCategory && i.linkedCategory !== 'none'));
        UI.show('bud-trend-empty', !anyLinked);
        UI.show(document.getElementById('bud-trend-chart').parentElement, anyLinked);
        if (anyLinked) {
            UI.chart('bud-trend-chart', {
                type: 'bar',
                data: {
                    labels: Fmt.MONTH_SHORT,
                    datasets: [
                        { label: 'Presupuestado', data: trend.map(t => t.budgeted), backgroundColor: 'rgba(245,158,11,.55)', borderColor: '#f59e0b', borderWidth: 1, borderRadius: 3 },
                        { label: 'Real gastado', data: trend.map(t => t.actual), backgroundColor: 'rgba(220,38,38,.6)', borderColor: '#dc2626', borderWidth: 1, borderRadius: 3 }
                    ]
                }
            });
        }
    }

    UI.register({
        'budget.setMonth': (el) => { Store.ui.month = el.value; App.render(); },
        'budget.showMonth': (el) => { Store.ui.month = el.dataset.month; App.render(); },
        'income.add': () => {
            const yd = Store.active();
            const list = yd.otherIncomes || (yd.otherIncomes = []);
            const id = Store.nextId(list);
            // Starts unlinked: linking it to a category is the person's choice, so it never
            // absorbs income already logged under that category by surprise.
            list.push({ id, name: 'Nuevo ingreso', amount: 0, category: 'none' });
            App.changed({ structural: true, step: true });
            UI.toast('Ingreso agregado. Escribe su nombre y cuánto recibes al mes (neto).', 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
            const input = document.querySelector(`#bud-body tr[data-income="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'income.set': (el) => {
            const src = (Store.active().otherIncomes || []).find(x => x.id === Number(el.dataset.id));
            if (!src) return;
            const f = el.dataset.field;
            src[f] = f === 'amount' ? Math.max(0, parseNum(el.value, 0)) : el.value;
            // A new category can absorb (or release) this month's logged income rows.
            App.changed({ structural: f === 'category' });
        },
        'income.delete': (el) => {
            const yd = Store.active();
            const src = (yd.otherIncomes || []).find(x => x.id === Number(el.dataset.id));
            if (!src) return;
            App.undoable(`Ingreso "${src.name}" eliminado`, () => { Store.active().otherIncomes = Store.active().otherIncomes.filter(x => x.id !== src.id); });
        },
        'income.fromCategory': (el) => {
            const yd = Store.active();
            const list = yd.otherIncomes || (yd.otherIncomes = []);
            list.push({ id: Store.nextId(list), name: el.dataset.category, amount: Math.round(Number(el.dataset.amount) * 100) / 100, category: el.dataset.category });
            App.changed({ structural: true });
            UI.toast(`"${el.dataset.category}" ahora cuenta como ingreso de todos los meses.`);
        },
        'income.countExtra': (el) => {
            const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id));
            if (!t) return;
            t.countAsExtra = true;
            App.changed({ structural: true });
            UI.toast(`"${t.description}" ahora se suma a tus ingresos del mes.`);
        },
        'budget.set': (el) => {
            const id = Number(el.dataset.id), field = el.dataset.field;
            const item = editableItems().find(i => i.id === id);
            if (!item) return;
            if (field === 'prep' || field === 'real') item[field] = Math.max(0, parseNum(el.value, 0));
            else if (field === 'isDeductible') item.isDeductible = el.checked;
            else item[field] = el.value;
            // Changing the type moves the row to another group; everything else only
            // refreshes numbers, so the field being typed in keeps its focus.
            App.changed({ structural: field === 'type' });
        },
        'budget.setLinked': (el) => {
            const list = el.dataset.kind === 'debt' ? Store.state.debts : Store.state.goals;
            const obj = list.find(x => x.id === Number(el.dataset.ref));
            if (!obj) return;
            obj.monthly = Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'budget.addRow': () => {
            const list = editableItems();
            const id = Store.nextId(list);
            list.push({ id, name: 'Nuevo rubro', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'none' });
            App.changed({ structural: true });
            const input = document.querySelector(`#bud-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'budget.delete': (el) => {
            const id = Number(el.dataset.id);
            const name = (Engine.monthItems(Store.active(), month()).find(i => i.id === id) || {}).name;
            App.undoable(`Rubro "${name}" eliminado`, () => {
                const yd = Store.active();
                const m = month();
                if (m === 'base') yd.budgetBase = yd.budgetBase.filter(i => i.id !== id);
                else { editableItems(); yd.monthOverrides[m] = yd.monthOverrides[m].filter(i => i.id !== id); }
            });
        },
        'budget.resetMonth': () => {
            const m = month();
            App.undoable(`${Fmt.MONTH_NAMES[m - 1]} vuelve a usar el presupuesto base`, () => { delete Store.active().monthOverrides[m]; });
        }
    });

    App.defineView('presupuesto/plan', { render, update });
})();
