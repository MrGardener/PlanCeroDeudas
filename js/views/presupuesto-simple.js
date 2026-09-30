/*
 * Presupuesto del Mes → vista Simple: the budget as cards, one per group, with a
 * Planeado / Gastado / Restante switch (the EveryDollar way of reading a budget).
 * Planned amounts are edited in place; what was spent comes from the transactions
 * assigned to each line (see Engine.lineSpend). The detailed table stays available.
 */
(function (root) {
    'use strict';
    const { money, money0, esc } = Fmt;

    const GROUPS = [
        { type: 'Gasto Fijo', label: 'Gastos fijos', icon: 'fa-house' },
        { type: 'Gasto Variable', label: 'Gastos variables', icon: 'fa-basket-shopping' },
        { type: 'Deuda', label: 'Pagos de deudas', icon: 'fa-credit-card' },
        { type: 'Ahorro', label: 'Ahorro e inversión', icon: 'fa-piggy-bank' }
    ];
    const MODES = { planned: 'Planeado', spent: 'Gastado', remaining: 'Restante', all: 'Todo' };
    const INCOME_MODES = { planned: 'Planeado', spent: 'Recibido', remaining: 'Por recibir', all: 'Todo' };

    const groupOf = (item) => {
        const t = item.type || '';
        if (GROUPS.some(g => g.type === t)) return t;
        return t.includes('Ahorro') ? 'Ahorro' : 'Otros';
    };
    // "Todo" (planned, spent and remaining side by side) needs a wide screen; phones get one
    // column at a time, like EveryDollar.
    const mode = () => Store.ui.budgetMode || (typeof window !== 'undefined' && window.innerWidth >= 1024 ? 'all' : 'planned');

    // Spending is always monthly. On the base budget it's the current month's (when the
    // active year is this year); for another year's base there's no month to show.
    function spendMonth(ctx) {
        const m = Store.ui.month;
        if (m !== 'base') return m;
        return ctx.state.activeYear === ctx.today.getFullYear() ? String(ctx.today.getMonth() + 1) : null;
    }

    // Everything the cards show for the selected month, computed once per update.
    function model(ctx) {
        const sm = spendMonth(ctx);
        const plannedItems = Engine.monthItems(ctx.budgetYear, Store.ui.month);
        const spend = sm ? Engine.lineSpend(Engine.monthItems(ctx.budgetYear, sm), ctx.state.transactions, ctx.state.activeYear, sm)
            : { byLine: {}, unassigned: [], unassignedTotal: 0 };
        const other = Engine.otherIncome(ctx.budgetYear, sm || 'base');
        const planned = Engine.otherIncome(ctx.budgetYear, Store.ui.month);
        const salaryReceived = sm ? other.payroll.reduce((t, x) => t + (Number(x.amount) || 0), 0) : 0;
        return { sm, plannedItems, spend, other, planned, salaryReceived };
    }

    // ------------------------------------------------------------------ markup
    function valueCell(inputHTML) {
        return `<div class="bs-val">${inputHTML || ''}<span class="bs-num" data-v></span></div>
            <span class="bs-num bs-all" data-s></span><span class="bs-num bs-all bs-rem" data-r></span>`;
    }
    const colsHTML = (labels) => `<span class="bs-col" data-col></span><span class="bs-col bs-all">${labels.spent}</span><span class="bs-col bs-all">${labels.remaining}</span>`;

    function lineRow(item) {
        const id = esc(String(item.id));
        let input = '';
        if (item.sweep) input = '';
        else if (item.link) input = `<input type="number" class="bs-input" min="0" step="10" value="${Number(item.real) || 0}" data-input="budget.setLinked" data-kind="${item.link}" data-ref="${item.refId}" aria-label="Planeado para ${esc(item.name)}">`;
        else input = `<input type="number" class="bs-input" min="0" step="10" value="${Number(item.real) || 0}" data-input="budget.set" data-id="${id}" data-field="real" data-sync="prep" aria-label="Planeado para ${esc(item.name)}">`;
        const badge = item.link ? `<a href="#" class="badge ${item.link === 'debt' ? 'badge-bad' : 'badge-purple'}" data-goto="metas" data-focus="${item.link === 'debt' ? 'metas-debts' : 'metas-goals'}"><i class="fa-solid fa-link"></i> ${item.link === 'debt' ? 'Deuda' : 'Meta'}</a>`
            : item.sweep ? '<span class="badge badge-ok"><i class="fa-solid fa-wand-magic-sparkles"></i> Automático</span>' : '';
        const canDue = !item.sweep && item.link !== 'goal';
        return `<div class="bs-row" data-line="${id}">
                <div class="bs-name">${item.link || item.sweep ? `<span class="bs-label">${esc(item.sweep ? 'Sobrante del mes' : item.name)}</span>`
                    : `<input class="bs-name-input" value="${esc(item.name)}" data-change="budget.set" data-id="${id}" data-field="name" aria-label="Nombre del rubro">`} ${badge}
                    ${!item.link && !item.sweep ? `<button type="button" class="row-del bs-del" data-action="budget.delete" data-id="${id}" title="Eliminar rubro" aria-label="Eliminar rubro"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    ${canDue ? `<button type="button" class="bs-due" data-action="budget.dueDay" data-id="${id}" data-kind="${item.link || 'line'}" data-ref="${item.refId || ''}" title="Fecha de pago"><i class="fa-regular fa-calendar"></i> <span data-due></span></button>` : ''}
                    <span class="bs-sub" data-sub></span></div>
                ${valueCell(input)}
                <div class="bs-bar"><span data-bar></span></div>
            </div>`;
    }

    function incomeCard(ctx, m) {
        const rows = [`<div class="bs-row" data-income="salary">
                <div class="bs-name"><span class="bs-label">Sueldo neto</span> <a href="#" class="badge badge-ok" data-goto="presupuesto/ingresos"><i class="fa-solid fa-link"></i> Tu Sueldo</a><span class="bs-sub" data-sub></span></div>
                ${valueCell()}<div class="bs-bar"><span data-bar></span></div></div>`];
        (ctx.year.otherIncomes || []).forEach(src => {
            rows.push(`<div class="bs-row" data-income="${src.id}">
                <div class="bs-name"><input class="bs-name-input" value="${esc(src.name)}" data-change="income.set" data-id="${src.id}" data-field="name" aria-label="Nombre del ingreso">
                    <button type="button" class="row-del bs-del" data-action="income.delete" data-id="${src.id}" title="Eliminar ingreso" aria-label="Eliminar ingreso"><i class="fa-solid fa-trash-can"></i></button><span class="bs-sub" data-sub></span></div>
                ${valueCell(`<input type="number" class="bs-input" min="0" step="10" value="${Number(src.amount) || 0}" data-input="income.set" data-id="${src.id}" data-field="amount" aria-label="Planeado para ${esc(src.name)}">`)}
                <div class="bs-bar"><span data-bar></span></div></div>`);
        });
        m.other.unplanned.forEach(u => {
            rows.push(`<div class="bs-row" data-income="cat:${esc(u.category)}">
                <div class="bs-name"><span class="bs-label">${esc(u.category)}</span><span class="bs-sub">Registrado: ${esc(u.txns.map(t => t.description).join(', '))} · <button type="button" class="mini-btn" data-action="income.fromCategory" data-category="${esc(u.category)}" data-amount="${u.amount}">Es mensual</button></span></div>
                ${valueCell()}<div class="bs-bar"><span data-bar></span></div></div>`);
        });
        return `<section class="bs-card" data-group="income">
                <header class="bs-head"><span class="bs-title"><i class="fa-solid fa-sack-dollar text-emerald-600"></i> Ingresos</span>${colsHTML(INCOME_MODES)}</header>
                ${rows.join('')}
                <footer class="bs-foot"><button type="button" class="link" data-action="income.add"><i class="fa-solid fa-plus"></i> Agregar ingreso</button><span class="bs-total" data-total></span></footer>
            </section>`;
    }

    function render(ctx) {
        const host = document.getElementById('bud-simple');
        if (!host) return;
        const m = model(ctx);
        const byGroup = {};
        m.plannedItems.forEach(it => { (byGroup[groupOf(it)] = byGroup[groupOf(it)] || []).push(it); });
        if (ctx.year.sweepSavings) (byGroup.Ahorro = byGroup.Ahorro || []).push({ id: 'sweep', sweep: true, type: 'Ahorro' });
        const order = GROUPS.map(g => g.type).concat(Object.keys(byGroup).filter(k => !GROUPS.some(g => g.type === k)));
        const cards = order.map(g => {
            const def = GROUPS.find(x => x.type === g) || { label: g, icon: 'fa-folder' };
            const list = byGroup[g] || [];
            return `<section class="bs-card" data-group="${esc(g)}">
                <header class="bs-head"><span class="bs-title"><i class="fa-solid ${def.icon} text-slate-400"></i> ${esc(def.label)}</span>${colsHTML(MODES)}</header>
                ${list.map(lineRow).join('') || '<p class="bs-empty">Sin rubros todavía.</p>'}
                <footer class="bs-foot">${GROUPS.some(x => x.type === g) && g !== 'Deuda' ? `<button type="button" class="link" data-action="budget.addRow" data-type="${esc(g === 'Ahorro' ? 'Ahorro/Inversión' : g)}"><i class="fa-solid fa-plus"></i> Agregar rubro</button>`
                    : g === 'Deuda' ? '<a href="#" class="link" data-goto="metas" data-focus="metas-debts"><i class="fa-solid fa-plus"></i> Agregar deuda</a>' : '<span></span>'}<span class="bs-total" data-total></span></footer>
            </section>`;
        });
        host.innerHTML = `
            <div class="bs-toolbar">
                <div class="segmented bs-modes" role="tablist" aria-label="Qué mostrar">${Object.keys(MODES).map(k => `<button type="button" data-action="budget.mode" data-mode="${k}">${MODES[k]}</button>`).join('')}</div>
                <span class="bs-month" id="bs-month"></span>
            </div>
            <div id="bs-banner" class="bs-banner"></div>
            <section class="bs-card bs-unassigned hidden" id="bs-unassigned"></section>
            <div class="bs-grid">${incomeCard(ctx, m)}${cards.join('')}</div>`;
        update(ctx);
    }

    // ------------------------------------------------------------------ numbers
    function setRow(row, { value, planned, spent, progress, sub, negative, invert }) {
        if (!row) return;
        const md = mode();
        const input = row.querySelector('.bs-input');
        const num = row.querySelector('[data-v]');
        const editing = (md === 'planned' || md === 'all') && input;
        if (md === 'all') {
            value = planned;
            row.querySelector('[data-s]').textContent = money(spent || 0);
            const rem = invert ? Math.max(0, (planned || 0) - (spent || 0)) : (planned || 0) - (spent || 0);
            const r = row.querySelector('[data-r]');
            r.textContent = money(rem);
            r.className = `bs-num bs-all bs-rem ${rem < -0.005 && !invert ? 'neg' : Math.abs(rem) < 0.005 ? 'zero' : 'pos'}`;
            negative = false;
        }
        if (input) {
            input.classList.toggle('hidden', !editing);
            if (editing && input !== document.activeElement) input.value = Math.round((Number(planned) || 0) * 100) / 100;
        }
        num.classList.toggle('hidden', !!editing);
        num.textContent = money(value);
        num.classList.toggle('text-red-600', !!negative);
        const bar = row.querySelector('[data-bar]');
        const p = Math.max(0, Math.min(1, progress || 0));
        bar.style.width = (p * 100).toFixed(1) + '%';
        bar.className = progress > 1.0001 ? 'over' : progress >= 0.8 && md !== 'planned' ? 'warn' : '';
        if (sub !== undefined) { const s = row.querySelector('[data-sub]'); if (s) s.innerHTML = sub; }
    }

    function pick(planned, spent) {
        const md = mode();
        return md === 'planned' || md === 'all' ? planned : md === 'spent' ? spent : planned - spent;
    }

    function update(ctx) {
        const host = document.getElementById('bud-simple');
        if (!host || !host.firstElementChild) return;
        const m = model(ctx);
        const md = mode();
        const mb = ctx.monthBudget;
        const monthName = m.sm ? Fmt.MONTH_NAMES[m.sm - 1] : null;

        UI.$$('#bud-simple [data-action="budget.mode"]').forEach(b => b.classList.toggle('active', b.dataset.mode === md));
        host.classList.toggle('mode-all', md === 'all');
        UI.$$('#bud-simple .bs-card[data-group]').forEach(c => {
            const col = c.querySelector('[data-col]');
            if (col) col.textContent = md === 'all' ? 'Planeado' : (c.dataset.group === 'income' ? INCOME_MODES : MODES)[md];
        });
        const t = ctx.today;
        const isCurrent = m.sm && ctx.state.activeYear === t.getFullYear() && Number(m.sm) === t.getMonth() + 1;
        const daysLeft = isCurrent ? new Date(t.getFullYear(), t.getMonth() + 1, 0).getDate() - t.getDate() : null;
        UI.html('bs-month', md === 'planned' ? '' : m.sm
            ? `<i class="fa-regular fa-calendar"></i> ${Store.ui.month === 'base' ? `Gastos de ${monthName} (mes actual)` : `Gastos de ${monthName}`}${daysLeft !== null ? ` · ${daysLeft === 0 ? 'último día del mes' : `quedan ${daysLeft} día${daysLeft === 1 ? '' : 's'}`}` : ''}`
            : '<span class="text-amber-700">Elige un mes para ver lo gastado.</span>');

        // Zero-based banner
        const bal = mb.balanceReal;
        const banner = document.getElementById('bs-banner');
        banner.className = `bs-banner ${Math.abs(bal) < 0.005 ? 'ok' : bal > 0 ? 'warn' : 'bad'}`;
        banner.innerHTML = Math.abs(bal) < 0.005 ? '<i class="fa-regular fa-circle-check"></i> ¡Es un presupuesto base cero! Cada dólar tiene un trabajo.'
            : bal > 0 ? `<i class="fa-solid fa-circle-info"></i> Te quedan <strong>${money(bal)}</strong> por asignar.`
            : `<i class="fa-solid fa-triangle-exclamation"></i> Planeaste <strong>${money(-bal)}</strong> más de lo que ganas.`;

        // Income
        const salaryRow = host.querySelector('[data-income="salary"]');
        setRow(salaryRow, {
            value: md === 'remaining' ? Math.max(0, mb.salary - m.salaryReceived) : pick(mb.salary, m.salaryReceived), planned: mb.salary, spent: m.salaryReceived, invert: true, progress: mb.salary > 0 ? m.salaryReceived / mb.salary : 0,
            sub: md === 'planned' ? 'Calculado de tu sueldo bruto' : m.salaryReceived > 0 ? 'Registrado en Transacciones' : 'Regístralo como Sueldo/Salario para verlo recibido'
        });
        m.other.sources.forEach(src => {
            const pl = (m.planned.sources.find(x => x.id === src.id) || src).planned;
            setRow(host.querySelector(`[data-income="${src.id}"]`), {
                value: md === 'remaining' ? Math.max(0, pl - src.received) : pick(pl, src.received), planned: pl, spent: src.received, invert: true, progress: pl > 0 ? src.received / pl : (src.received > 0 ? 1 : 0),
                negative: md === 'remaining' && src.received > pl + 0.005 ? false : undefined,
                sub: src.txns.length ? `Recibido: ${esc(src.txns.map(t => t.description).join(', '))}` : (src.category ? esc(src.category) : '')
            });
        });
        m.other.unplanned.forEach(u => setRow(host.querySelector(`[data-income="cat:${CSS.escape(u.category)}"]`), { value: md === 'remaining' ? 0 : pick(0, u.amount), planned: 0, spent: u.amount, invert: true, progress: 1 }));
        const incPlanned = mb.incomePrep;
        const incReceived = m.salaryReceived + m.other.sources.reduce((t, s) => t + s.received, 0) + m.other.unplanned.reduce((t, u) => t + u.amount, 0);
        const incTotal = host.querySelector('.bs-card[data-group="income"] [data-total]');
        if (incTotal) incTotal.textContent = money(md === 'remaining' ? Math.max(0, incPlanned - incReceived) : pick(incPlanned, incReceived));

        // Expense lines
        const spentOf = (id) => (m.spend.byLine[String(id)] || { spent: 0, txns: [] });
        const today = ctx.today;
        m.plannedItems.forEach(it => {
            const row = host.querySelector(`[data-line="${CSS.escape(String(it.id))}"]`);
            if (!row) return;
            const planned = Number(it.real) || 0;
            const s = spentOf(it.id);
            const subParts = [];
            if (it.link === 'debt') subParts.push(planned + 0.005 >= it.minPayment ? `Cubre el mínimo (${money0(it.minPayment)})` : `<span class="text-red-600">Mínimo ${money0(it.minPayment)}</span>`);
            if (it.link === 'goal') {
                const g = ctx.state.goals.find(x => x.id === it.refId) || {};
                const r = Engine.goalMonths(g);
                subParts.push(r.status === 'reached' ? '¡Meta alcanzada!' : r.status === 'never' ? '<span class="text-red-600">Sin aporte: nunca llega</span>' : `Lista en ${Fmt.monthYear(Engine.addMonths(today, r.months))}`);
            }
            if (md !== 'planned' && s.txns.length) subParts.push(`${s.txns.length} transacci${s.txns.length === 1 ? 'ón' : 'ones'}`);
            setRow(row, {
                value: pick(planned, s.spent), planned, spent: s.spent, progress: planned > 0 ? s.spent / planned : (s.spent > 0 ? 1.01 : 0),
                negative: md === 'remaining' && planned - s.spent < -0.005,
                sub: subParts.join(' · ')
            });
            const due = row.querySelector('[data-due]');
            if (due) due.textContent = Number(it.dueDay) >= 1 ? `día ${it.dueDay}` : '';
        });
        const sweepRow = host.querySelector('[data-line="sweep"]');
        if (sweepRow) setRow(sweepRow, { value: md === 'spent' ? 0 : mb.sweep, planned: mb.sweep, spent: 0, progress: 0, sub: mb.sweep > 0 ? 'Pásalo a tu cuenta de ahorro o póliza' : 'No sobra nada' });

        // Card totals
        UI.$$('#bud-simple .bs-card[data-group]').forEach(c => {
            const g = c.dataset.group;
            if (g === 'income') return;
            const list = m.plannedItems.filter(it => groupOf(it) === g);
            const planned = list.reduce((t, it) => t + (Number(it.real) || 0), 0) + (g === 'Ahorro' ? mb.sweep : 0);
            const spent = list.reduce((t, it) => t + spentOf(it.id).spent, 0);
            const el = c.querySelector('[data-total]');
            const v = pick(planned, spent);
            el.textContent = money(v);
            el.classList.toggle('text-red-600', md === 'remaining' && v < -0.005);
        });

        // Spending that isn't on any line yet
        const un = document.getElementById('bs-unassigned');
        const show = md !== 'planned' && m.spend.unassigned.length > 0;
        un.classList.toggle('hidden', !show);
        if (show) {
            const options = lineOptions(Engine.monthItems(ctx.budgetYear, m.sm));
            un.innerHTML = `<header class="bs-head"><span class="bs-title text-amber-800"><i class="fa-solid fa-triangle-exclamation"></i> Gastos sin rubro en ${monthName}</span><span class="bs-total">${money(m.spend.unassignedTotal)}</span></header>
                <p class="bs-sub mb-2">No cuentan en ningún rubro. Arrástralos a un rubro de arriba (o elígelo en la lista) para que tu presupuesto refleje lo que gastaste.</p>
                ${m.spend.unassigned.map(t => `<div class="bs-row bs-txn" draggable="true" data-txn="${t.id}" title="Arrástralo a un rubro, o elige el rubro a la derecha"><div class="bs-name"><span class="bs-label">${esc(t.description)}</span><span class="bs-sub">${esc(t.date)} · ${esc(t.parentCategory)}</span></div>
                    <div class="bs-val"><span class="bs-num">${money(t.amount)}</span></div>
                    <select class="chip-select empty" data-change="txn.assignLine" data-id="${t.id}" aria-label="Asignar a un rubro"><option value="">+ Asignar a un rubro</option>${options}</select></div>`).join('')}`;
        }
    }

    // <option>s for every expense line of a month's budget, grouped.
    function lineOptions(items, selected) {
        const byGroup = {};
        items.forEach(it => { (byGroup[groupOf(it)] = byGroup[groupOf(it)] || []).push(it); });
        return Object.keys(byGroup).map(g => `<optgroup label="${esc((GROUPS.find(x => x.type === g) || { label: g }).label)}">${byGroup[g].map(it =>
            `<option value="${esc(String(it.id))}" ${String(selected) === String(it.id) ? 'selected' : ''}>${esc(it.name)}</option>`).join('')}</optgroup>`).join('');
    }

    // Drag a transaction onto a budget line to assign it there.
    if (typeof document !== 'undefined') {
        document.addEventListener('dragstart', (e) => {
            const t = e.target.closest && e.target.closest('[data-txn]');
            if (!t) return;
            e.dataTransfer.setData('text/plain', 'txn:' + t.dataset.txn);
            e.dataTransfer.effectAllowed = 'move';
            // Restyling during dragstart makes Chrome cancel the drag: highlight a tick later.
            setTimeout(() => document.body.classList.add('dragging-txn'), 0);
        });
        document.addEventListener('dragend', () => document.body.classList.remove('dragging-txn'));
        document.addEventListener('dragover', (e) => {
            const row = e.target.closest && e.target.closest('#bud-simple [data-line]');
            if (!row || row.dataset.line === 'sweep') return;
            e.preventDefault();
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
            UI.$$('#bud-simple .drop-target').forEach(r => { if (r !== row) r.classList.remove('drop-target'); });
            row.classList.add('drop-target');
        });
        document.addEventListener('drop', (e) => {
            const row = e.target.closest && e.target.closest('#bud-simple [data-line]');
            UI.$$('#bud-simple .drop-target').forEach(r => r.classList.remove('drop-target'));
            const data = e.dataTransfer && e.dataTransfer.getData('text/plain');
            if (!row || !data || !data.startsWith('txn:') || row.dataset.line === 'sweep') return;
            e.preventDefault();
            assignLine(Number(data.slice(4)), row.dataset.line);
        });
    }

    function assignLine(txnId, lineId) {
        const t = Store.state.transactions.find(x => x.id === txnId);
        if (!t) return;
        if (lineId) t.budgetLine = lineId; else delete t.budgetLine;
        App.changed({ structural: true, step: true });
        if (lineId) {
            const item = Engine.monthItems(Store.effective(Number(t.date.slice(0, 4))), String(Number(t.date.slice(5, 7)))).find(i => String(i.id) === String(lineId));
            UI.toast(`"${t.description}" ahora cuenta en «${item ? item.name : lineId}».`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    }

    UI.register({
        'txn.assignLine': (el) => assignLine(Number(el.dataset.id), el.value),
        'budget.mode': (el) => { Store.ui.budgetMode = el.dataset.mode; App.update(); },
        'budget.layout': (el) => { Store.ui.budgetLayout = el.dataset.layout; App.render(); }
    });

    root.BudgetSimple = { render, update, lineOptions, groupOf, GROUPS, assignLine };
})(this);
