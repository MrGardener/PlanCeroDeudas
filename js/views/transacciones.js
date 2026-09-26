/* Presupuesto → Transacciones: log individual purchases/income and see trends. */
(function () {
    'use strict';
    const { money, esc } = Fmt;

    const taxonomyFor = (type) => type === 'Ingreso' ? Store.state.taxonomy.income : Store.state.taxonomy.expense;

    function fillCategorySelects(keepParent) {
        const tax = taxonomyFor(document.getElementById('txn-type').value);
        const parentSel = document.getElementById('txn-parent');
        const prev = keepParent || parentSel.value;
        const parents = Object.keys(tax);
        // Income you log is usually extra income (the salary comes from "Tu Sueldo"), so
        // don't start new income on the salary category.
        const first = document.getElementById('txn-type').value === 'Ingreso' && parents.includes('Ingresos Independientes') ? 'Ingresos Independientes' : parents[0];
        parentSel.innerHTML = Views.selectOptions(parents, parents.includes(prev) ? prev : first);
        fillIncomeSelect();
        fillSubSelect();
    }

    // Income lines of the budget (active year) that a new income can be the receipt of.
    function fillIncomeSelect() {
        const isInc = document.getElementById('txn-type').value === 'Ingreso';
        const lines = Store.active().otherIncomes || [];
        UI.show('txn-income-field', isInc && lines.length > 0);
        const sel = document.getElementById('txn-income');
        const prev = sel.value;
        sel.innerHTML = Views.selectOptions([{ value: '', label: 'No: es un ingreso extra' }].concat(lines.map(x => ({ value: String(x.id), label: `Sí: ${x.name}` }))), lines.some(x => String(x.id) === prev) ? prev : '');
    }

    function fillSubSelect(keepSub) {
        const tax = taxonomyFor(document.getElementById('txn-type').value);
        const subs = tax[document.getElementById('txn-parent').value] || [];
        document.getElementById('txn-sub').innerHTML = Views.selectOptions(subs, keepSub || subs[0]);
        payrollHint();
    }

    function payrollHint() {
        const t = { type: document.getElementById('txn-type').value, category: document.getElementById('txn-sub').value };
        UI.show('txn-payroll-hint', t.type === 'Ingreso' && Engine.isPayrollTxn(t));
    }

    function fillFilters(ctx) {
        const f = Store.ui.txnFilters;
        const years = new Set(ctx.state.transactions.map(t => Number(t.date.slice(0, 4))));
        years.add(ctx.today.getFullYear());
        UI.html('txn-f-year', Views.selectOptions([{ value: 'all', label: 'Todos los años' }].concat([...years].sort().map(y => ({ value: y, label: y }))), f.year));
        UI.html('txn-f-month', Views.selectOptions([{ value: 'all', label: 'Todos los meses' }].concat(Fmt.MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n }))), f.month));
        document.getElementById('txn-f-type').value = f.type;
        // Categories already used by past transactions stay filterable even if deleted.
        const cats = new Set([...Object.keys(ctx.state.taxonomy.expense), ...Object.keys(ctx.state.taxonomy.income), ...ctx.state.transactions.map(t => t.parentCategory)]);
        UI.html('txn-f-category', Views.selectOptions([{ value: 'all', label: 'Todas las categorías' }].concat([...cats].sort().map(c => ({ value: c, label: c }))), f.category));
    }

    function renderCategories() {
        const type = document.getElementById('cat-type').value;
        const tax = taxonomyFor(type);
        const parents = Object.keys(tax);
        UI.html('cat-list', parents.length ? parents.map(p => `
            <div class="panel tone-slate bg-white">
                <div class="flex items-center justify-between mb-1.5">
                    <span class="font-bold text-slate-800 text-xs">${esc(p)}</span>
                    <button class="row-del" data-action="cat.deleteParent" data-parent="${esc(p)}" title="Eliminar categoría"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="flex flex-wrap gap-1.5">${tax[p].map(s => `
                    <span class="inline-flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-full pl-2 pr-1 py-0.5 text-[10px]">${esc(s)}
                        <button class="text-red-400 hover:text-red-700 font-bold px-1" data-action="cat.deleteSub" data-parent="${esc(p)}" data-sub="${esc(s)}" title="Eliminar subcategoría">×</button></span>`).join('') || '<span class="text-slate-400 text-[10px]">(sin subcategorías)</span>'}
                </div>
            </div>`).join('') : '<p class="help">No hay categorías. Agrega una con "+ Nueva".</p>');
    }

    function render(ctx) {
        const dateInput = document.getElementById('txn-date');
        if (!dateInput.value) dateInput.value = ctx.today.toISOString().slice(0, 10);
        fillCategorySelects();
        renderCategories();
        fillFilters(ctx);
        update(ctx);
    }

    function incomeLabel(t) {
        const yd = Store.state.years[Number(t.date.slice(0, 4))];
        const line = yd && (yd.otherIncomes || []).find(x => x.id === t.incomeId);
        return line ? `<span class="block text-[10px] text-emerald-700"><i class="fa-solid fa-link"></i> Recibido de «${esc(line.name)}»</span>` : '';
    }

    function update(ctx) {
        const f = Store.ui.txnFilters;
        const list = Engine.filterTransactions(ctx.state.transactions, f).sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        UI.html('txn-body', list.length ? list.map(t => {
            const inc = (t.type || 'Gasto') === 'Ingreso';
            return `<tr>
                <td class="whitespace-nowrap">${esc(t.date)}</td>
                <td><span class="badge ${inc ? 'badge-ok' : 'badge-bad'}">${inc ? 'Ingreso' : 'Gasto'}</span></td>
                <td class="font-medium">${esc(t.description)}</td>
                <td class="text-slate-500">${esc(t.store || '—')}</td>
                <td>${esc(t.parentCategory)}</td>
                <td class="text-slate-500">${esc(t.category)}${inc && Engine.isPayrollTxn(t) ? `<span class="block text-[10px] text-amber-700" title="Tu sueldo ya se cuenta desde Tu Sueldo">No se suma (es tu sueldo) · <button type="button" class="mini-btn" data-action="income.countExtra" data-id="${t.id}">Es un ingreso extra</button></span>` : ''}${inc && t.countAsExtra ? '<span class="block text-[10px] text-emerald-700">Contado como ingreso extra</span>' : ''}${inc && t.incomeId ? incomeLabel(t) : ''}</td>
                <td class="num font-bold ${inc ? 'text-emerald-700' : 'text-red-700'}">${inc ? '+' : '−'}${money(t.amount)}</td>
                <td><span class="badge badge-muted">${esc(t.paymentType)}</span></td>
                <td class="text-center"><button class="row-del" data-action="txn.delete" data-id="${t.id}" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`;
        }).join('') : '<tr class="empty-row"><td colspan="9">No hay transacciones para este filtro.</td></tr>');

        const inc = list.filter(t => t.type === 'Ingreso').reduce((s, t) => s + Number(t.amount || 0), 0);
        const exp = list.filter(t => (t.type || 'Gasto') === 'Gasto').reduce((s, t) => s + Number(t.amount || 0), 0);
        UI.text('txn-sum-inc', money(inc));
        UI.text('txn-sum-exp', money(exp));
        UI.text('txn-sum-net', money(inc - exp));

        // The trend ignores the month filter: a single month has no trend.
        const trendList = Engine.filterTransactions(ctx.state.transactions, { ...f, month: 'all' });
        UI.show('txn-trend-empty', trendList.length === 0);
        UI.show(document.getElementById('txn-trend-chart').parentElement, trendList.length > 0);
        if (trendList.length) {
            const t = Engine.transactionTrend(trendList);
            const labels = t.keys.map(k => t.yearly ? k : `${Fmt.MONTH_SHORT[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`);
            const datasets = [];
            if (f.type !== 'Gasto') datasets.push({ label: 'Ingresos', data: t.income, backgroundColor: 'rgba(5,150,105,.65)', borderRadius: 3 });
            if (f.type !== 'Ingreso') datasets.push({ label: 'Gastos', data: t.expense, backgroundColor: 'rgba(220,38,38,.65)', borderRadius: 3 });
            UI.chart('txn-trend-chart', { type: 'bar', data: { labels, datasets } });
        }
    }

    UI.register({
        'txn.typeChanged': () => fillCategorySelects(),
        'txn.parentChanged': () => fillSubSelect(),
        'txn.subChanged': () => payrollHint(),
        'txn.filter': () => {
            Store.ui.txnFilters = {
                year: document.getElementById('txn-f-year').value,
                month: document.getElementById('txn-f-month').value,
                type: document.getElementById('txn-f-type').value,
                category: document.getElementById('txn-f-category').value
            };
            App.update();
        },
        'txn.add': () => {
            const get = (id) => document.getElementById(id);
            const description = get('txn-description').value.trim();
            const amount = Fmt.parseNum(get('txn-amount').value, 0);
            if (!description || amount <= 0) {
                UI.toast('Escribe una descripción y un monto mayor a $0.', 'error');
                (description ? get('txn-amount') : get('txn-description')).focus();
                return;
            }
            const s = Store.state;
            s.transactions.push({
                id: Store.nextId(s.transactions),
                type: get('txn-type').value,
                description,
                store: get('txn-store').value.trim(),
                parentCategory: get('txn-parent').value,
                category: get('txn-sub').value,
                amount,
                date: get('txn-date').value || new Date().toISOString().slice(0, 10),
                paymentType: get('txn-payment').value,
                incomeId: get('txn-type').value === 'Ingreso' && get('txn-income').value ? Number(get('txn-income').value) : undefined
            });
            get('txn-income').value = '';
            get('txn-description').value = '';
            get('txn-store').value = '';
            get('txn-amount').value = '';
            App.changed({ structural: true });
            UI.toast(`Transacción de ${money(amount)} registrada`);
            get('txn-description').focus();
        },
        'txn.delete': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Transacción eliminada', () => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== id); });
        },
        'txn.renderCategories': () => renderCategories(),
        'txn.addParent': async () => {
            const type = document.getElementById('txn-type').value;
            const tax = taxonomyFor(type);
            const r = await UI.form({
                title: `Nueva categoría de ${type === 'Ingreso' ? 'ingreso' : 'gasto'}`,
                fields: [{ name: 'name', label: 'Nombre', placeholder: 'Ej: Deportes' }],
                confirmText: 'Crear',
                validate: v => !v.name.trim() ? 'Escribe un nombre.' : tax[v.name.trim()] ? 'Esa categoría ya existe.' : null
            });
            if (!r) return;
            tax[r.name.trim()] = [];
            App.changed({ step: true });
            fillCategorySelects(r.name.trim());
            renderCategories();
            fillFilters(App.buildContext());
        },
        'txn.addSub': async () => {
            const tax = taxonomyFor(document.getElementById('txn-type').value);
            const parent = document.getElementById('txn-parent').value;
            if (!parent) { UI.toast('Primero elige o crea una categoría.', 'warn'); return; }
            const r = await UI.form({
                title: `Nueva subcategoría de "${parent}"`,
                fields: [{ name: 'name', label: 'Nombre', placeholder: 'Ej: Gimnasio' }],
                confirmText: 'Crear',
                validate: v => !v.name.trim() ? 'Escribe un nombre.' : tax[parent].includes(v.name.trim()) ? 'Esa subcategoría ya existe.' : null
            });
            if (!r) return;
            tax[parent].push(r.name.trim());
            App.changed({ step: true });
            fillSubSelect(r.name.trim());
            renderCategories();
        },
        'cat.deleteParent': (el) => {
            const tax = taxonomyFor(document.getElementById('cat-type').value);
            const p = el.dataset.parent;
            const n = Store.state.transactions.filter(t => t.parentCategory === p).length;
            App.undoable(n ? `"${p}" eliminada. Sus ${n} transacciones la conservan.` : `"${p}" eliminada`, () => { delete tax[p]; });
        },
        'cat.deleteSub': (el) => {
            const tax = taxonomyFor(document.getElementById('cat-type').value);
            const { parent, sub } = el.dataset;
            App.undoable(`"${sub}" eliminada`, () => { tax[parent] = tax[parent].filter(s => s !== sub); });
        }
    });

    App.defineView('presupuesto/transacciones', { render, update });
})();
