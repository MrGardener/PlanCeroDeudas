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
        { type: 'Gasto Fijo', label: 'Fixed expenses', icon: 'fa-house' },
        { type: 'Gasto Variable', label: 'Variable expenses', icon: 'fa-basket-shopping' },
        { type: 'Deuda', label: 'Debt payments', icon: 'fa-credit-card' },
        { type: 'Ahorro', label: 'Savings & investing', icon: 'fa-piggy-bank' }
    ];
    const MODES = { planned: 'Planeado', spent: 'Gastado', remaining: 'Restante', all: 'Todo' };
    const INCOME_MODES = { planned: 'Planeado', spent: 'Recibido', remaining: 'To receive', all: 'Todo' };

    // Lines can live in a custom group (item.group); otherwise their type decides.
    const groupOf = (item) => {
        if (item.group && !item.link) return 'g:' + item.group;
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
        else if (item.link) input = `<input type="number" class="bs-input" min="0" step="10" value="${Number(item.real) || 0}" data-input="budget.setLinked" data-kind="${item.link}" data-ref="${item.refId}" aria-label="Planned for ${esc(item.name)}">`;
        else input = `<input type="number" class="bs-input" min="0" step="10" value="${Number(item.real) || 0}" data-input="budget.set" data-id="${id}" data-field="real" data-sync="prep" aria-label="Planned for ${esc(item.name)}">`;
        const badge = item.link ? `<a href="#" class="badge ${item.link === 'debt' ? 'badge-bad' : 'badge-purple'}" data-goto="futuro/metas" data-focus="${item.link === 'debt' ? 'metas-debts' : 'metas-goals'}"><i class="fa-solid fa-link"></i> ${item.link === 'debt' ? 'Deuda' : 'Meta'}</a>`
            : item.sweep ? '<span class="badge badge-ok"><i class="fa-solid fa-wand-magic-sparkles"></i> Automatic</span>' : '';
        const canDue = !item.sweep && item.link !== 'goal';
        return `<div class="bs-row" data-line="${id}">
                <div class="bs-name">${item.link || item.sweep ? `<span class="bs-label">${esc(item.sweep ? 'Monthly leftover' : item.name)}</span>`
                    : `<input class="bs-name-input" value="${esc(item.name)}" data-change="budget.set" data-id="${id}" data-field="name" aria-label="Line name">`} ${badge}
                    ${!item.link && !item.sweep ? `<button type="button" class="row-del bs-del" data-action="budget.delete" data-id="${id}" title="Delete line" aria-label="Delete line"><i class="fa-solid fa-trash-can"></i></button>` : ''}
                    ${canDue ? `<button type="button" class="bs-due" data-action="budget.dueDay" data-id="${id}" data-kind="${item.link || 'line'}" data-ref="${item.refId || ''}" title="Due date"><i class="fa-regular fa-calendar"></i> <span data-due></span></button>` : ''}
                    ${item.sweep ? '' : `<button type="button" class="bs-due" data-action="line.detail" data-id="${id}" title="Details: history, transactions, group"><i class="fa-solid fa-chart-simple"></i></button>`}
                    <span class="bs-sub" data-sub></span></div>
                ${valueCell(input)}
                <div class="bs-bar"><span data-bar></span></div>
            </div>`;
    }

    function incomeCard(ctx, m) {
        const rows = [`<div class="bs-row" data-income="salary">
                <div class="bs-name"><span class="bs-label">Net salary</span> <a href="#" class="badge badge-ok" data-goto="presupuesto/ingresos"><i class="fa-solid fa-link"></i> Your Salary</a><span class="bs-sub" data-sub></span></div>
                ${valueCell()}<div class="bs-bar"><span data-bar></span></div></div>`];
        (ctx.year.otherIncomes || []).forEach(src => {
            rows.push(`<div class="bs-row" data-income="${src.id}">
                <div class="bs-name"><input class="bs-name-input" value="${esc(src.name)}" data-change="income.set" data-id="${src.id}" data-field="name" aria-label="Income name">
                    <button type="button" class="row-del bs-del" data-action="income.delete" data-id="${src.id}" title="Delete income" aria-label="Delete income"><i class="fa-solid fa-trash-can"></i></button><span class="bs-sub" data-sub></span></div>
                ${valueCell(`<input type="number" class="bs-input" min="0" step="10" value="${Number(src.amount) || 0}" data-input="income.set" data-id="${src.id}" data-field="amount" aria-label="Planned for ${esc(src.name)}">`)}
                <div class="bs-bar"><span data-bar></span></div></div>`);
        });
        m.other.unplanned.forEach(u => {
            rows.push(`<div class="bs-row" data-income="cat:${esc(u.category)}">
                <div class="bs-name"><span class="bs-label">${esc(u.category)}</span><span class="bs-sub">Logged: ${esc(u.txns.map(t => t.description).join(', '))} · <button type="button" class="mini-btn" data-action="income.fromCategory" data-category="${esc(u.category)}" data-amount="${u.amount}">It's monthly</button></span></div>
                ${valueCell()}<div class="bs-bar"><span data-bar></span></div></div>`);
        });
        return `<section class="bs-card" data-group="income">
                <header class="bs-head"><span class="bs-title"><i class="fa-solid fa-sack-dollar text-emerald-600"></i> Income</span>${colsHTML(INCOME_MODES)}</header>
                ${rows.join('')}
                <footer class="bs-foot"><button type="button" class="link" data-action="income.add"><i class="fa-solid fa-plus"></i> Add income</button><span class="bs-total" data-total></span></footer>
            </section>`;
    }

    function render(ctx) {
        const host = document.getElementById('bud-simple');
        if (!host) return;
        const m = model(ctx);
        const byGroup = {};
        m.plannedItems.forEach(it => { (byGroup[groupOf(it)] = byGroup[groupOf(it)] || []).push(it); });
        if (ctx.year.sweepSavings) (byGroup.Ahorro = byGroup.Ahorro || []).push({ id: 'sweep', sweep: true, type: 'Ahorro' });
        // Custom groups: the year's list (keeps empty ones) plus any group a line mentions.
        const custom = (ctx.year.groups || []).map(g => g.name);
        // Savings lines say what they're for (emergency money doesn't count toward Step 4).
        const PURPOSE_LABEL = { emergencia: 'emergency fund', jubilacion: 'jubilación', general: 'general savings' };
        const purposeField = (it, lineId) => {
            if (!Engine.isSavingsItem(it)) return '';
            const auto = PURPOSE_LABEL[Engine.savingsPurpose(Object.assign({}, it, { purpose: '' }))];
            const opts = [{ value: '', label: `Automatic (${auto})` }, { value: 'emergencia', label: 'Emergency fund' }, { value: 'jubilacion', label: 'Jubilación' }, { value: 'general', label: 'General savings' }];
            return `<label class="field mt-3 max-w-sm"><span class="field-label">What is this saving for?</span><select class="input" data-change="line.setPurpose" data-id="${esc(String(lineId))}">${Views.selectOptions(opts, it.purpose || '')}</select>
                <span class="help">The emergency fund doesn't count as retirement saving (Step 4).</span></label>`;
        };
        m.plannedItems.forEach(it => { if (it.group && !it.link && !custom.includes(it.group)) custom.push(it.group); });
        const order = GROUPS.map(g => g.type).concat(custom.map(n => 'g:' + n), Object.keys(byGroup).filter(k => !GROUPS.some(g => g.type === k) && !k.startsWith('g:')));
        const cards = order.map(g => {
            const isCustom = g.startsWith('g:');
            const name = isCustom ? g.slice(2) : g;
            const def = isCustom ? { label: name, icon: 'fa-folder-open' } : (GROUPS.find(x => x.type === g) || { label: g, icon: 'fa-folder' });
            const list = byGroup[g] || [];
            const gdef = (ctx.year.groups || []).find(x => x.name === name);
            const addType = isCustom ? ((gdef && gdef.type) || (list[0] && list[0].type) || 'Gasto Variable') : (g === 'Ahorro' ? 'Ahorro/Inversión' : g);
            const foot = g === 'Deuda' ? '<a href="#" class="link" data-goto="futuro/metas" data-focus="metas-debts"><i class="fa-solid fa-plus"></i> Add debt</a>'
                : GROUPS.some(x => x.type === g) || isCustom ? `<button type="button" class="link" data-action="budget.addRow" data-type="${esc(addType)}" ${isCustom ? `data-group="${esc(name)}"` : ''}><i class="fa-solid fa-plus"></i> Add line</button>${isCustom && !list.length ? ` <button type="button" class="mini-btn text-red-600 ml-2" data-action="group.delete" data-name="${esc(name)}">Remove group</button>` : ''}` : '<span></span>';
            return `<section class="bs-card" data-group="${esc(g)}">
                <header class="bs-head"><span class="bs-title"><i class="fa-solid ${def.icon} text-slate-400"></i> ${esc(def.label)}</span>${colsHTML(MODES)}</header>
                ${list.map(lineRow).join('') || '<p class="bs-empty">No lines yet.</p>'}
                <footer class="bs-foot">${foot}<span class="bs-total" data-total></span></footer>
            </section>`;
        });
        cards.push('<button type="button" class="bs-add-group" data-action="group.add"><i class="fa-solid fa-folder-plus"></i> Add group<span class="block text-[11px] font-normal text-slate-500 mt-1">E.g. Giving, Pets, Car, Kids</span></button>');
        host.innerHTML = `
            <div class="bs-toolbar">
                <div class="segmented bs-modes" role="tablist" aria-label="What to show">${Object.keys(MODES).map(k => `<button type="button" data-action="budget.mode" data-mode="${k}">${MODES[k]}</button>`).join('')}</div>
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
        bar.parentElement.classList.toggle('empty', p <= 0);
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
            ? `<i class="fa-regular fa-calendar"></i> ${Store.ui.month === 'base' ? `${monthName} spending (current month)` : `${monthName} spending`}${daysLeft !== null ? ` · ${daysLeft === 0 ? 'last day of the month' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left`}` : ''}`
            : '<span class="text-amber-700">Pick a month to see what was spent.</span>');

        // Zero-based banner
        const bal = mb.balanceReal;
        const banner = document.getElementById('bs-banner');
        banner.className = `bs-banner ${Math.abs(bal) < 0.005 ? 'ok' : bal > 0 ? 'warn' : 'bad'}`;
        banner.innerHTML = Math.abs(bal) < 0.005 ? '<i class="fa-regular fa-circle-check"></i> It\'s a zero-based budget! Every dollar has a job.'
            : bal > 0 ? `<i class="fa-solid fa-circle-info"></i> Still to assign: <strong>${money(bal)}</strong>.`
            : `<i class="fa-solid fa-triangle-exclamation"></i> You planned <strong>${money(-bal)}</strong> more than you earn.`;

        // Income
        const salaryRow = host.querySelector('[data-income="salary"]');
        setRow(salaryRow, {
            value: md === 'remaining' ? Math.max(0, mb.salary - m.salaryReceived) : pick(mb.salary, m.salaryReceived), planned: mb.salary, spent: m.salaryReceived, invert: true, progress: mb.salary > 0 ? m.salaryReceived / mb.salary : 0,
            sub: md === 'planned' ? 'Calculated from your gross salary' : m.salaryReceived > 0 ? 'Logged in Transactions' : 'Log it as Salary/Wages to see it received'
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
            if (it.link === 'debt') subParts.push(planned + 0.005 >= it.minPayment ? `Covers the minimum (${money0(it.minPayment)})` : `<span class="text-red-600">Minimum ${money0(it.minPayment)}</span>`);
            if (it.link === 'goal') {
                const g = ctx.state.goals.find(x => x.id === it.refId) || {};
                const r = Engine.goalMonths(g);
                subParts.push(r.status === 'reached' ? 'Goal reached!' : r.status === 'never' ? '<span class="text-red-600">No contribution: never gets there</span>' : `Ready in ${Fmt.monthYear(Engine.addMonths(today, r.months))}`);
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
        if (sweepRow) setRow(sweepRow, { value: md === 'spent' ? 0 : mb.sweep, planned: mb.sweep, spent: 0, progress: 0, sub: mb.sweep > 0 ? 'Move it to your savings account or CD' : 'Nothing left over' });

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
            un.innerHTML = `<header class="bs-head"><span class="bs-title text-amber-800"><i class="fa-solid fa-triangle-exclamation"></i> Expenses without a line in ${monthName}</span><span class="bs-total">${money(m.spend.unassignedTotal)}</span></header>
                <p class="bs-sub mb-2">They don't count in any line. Drag them onto a line above (or pick it in the list) so your budget reflects what you spent.</p>
                ${m.spend.unassigned.map(t => `<div class="bs-row bs-txn" draggable="true" data-txn="${t.id}" title="Drag it onto a line, or pick the line on the right"><div class="bs-name"><span class="bs-label">${esc(t.description)}</span><span class="bs-sub">${esc(t.date)} · ${esc(t.parentCategory)}</span></div>
                    <div class="bs-val"><span class="bs-num">${money(t.amount)}</span></div>
                    <select class="chip-select empty" data-change="txn.assignLine" data-id="${t.id}" aria-label="Assign to a line"><option value="">+ Assign to a line</option>${options}</select></div>`).join('')}`;
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
            UI.toast(`"${t.description}" now counts in «${item ? item.name : lineId}».`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    }

    // ------------------------------------------------------------------ custom groups
    // The same line in the base budget and every month that has its own copy.
    function lineCopies(yd, id) {
        return [yd.budgetBase].concat(Object.values(yd.monthOverrides || {})).map(l => l.find(i => String(i.id) === String(id))).filter(Boolean);
    }

    // ------------------------------------------------------------------ line detail
    function openDetail(id) {
        const ctx = App.buildContext();
        const s = ctx.state, t = ctx.today;
        const sm = spendMonth(ctx) || String(t.getMonth() + 1);
        const y0 = ctx.state.activeYear;
        const item = Engine.monthItems(ctx.budgetYear, sm).find(i => String(i.id) === String(id));
        if (!item) return;
        // Last 12 months up to the month on screen.
        const months = [];
        for (let k = 11; k >= 0; k--) { const d = new Date(y0, Number(sm) - 1 - k, 1); months.push([d.getFullYear(), String(d.getMonth() + 1)]); }
        const hist = months.map(([y, m]) => {
            const items = Engine.monthItems(Store.effective(y), m);
            const it = items.find(i => String(i.id) === String(id));
            const sp = Engine.lineSpend(items, s.transactions, y, m).byLine[String(id)];
            return { label: `${Fmt.MONTH_SHORT[m - 1]} ${String(y).slice(2)}`, planned: it ? Number(it.real) || 0 : 0, spent: sp ? sp.spent : 0, txns: sp ? sp.txns : [] };
        });
        const cur = hist[hist.length - 1];
        const withData = hist.filter(h => h.spent > 0);
        const avg = withData.length ? withData.reduce((a, h) => a + h.spent, 0) / withData.length : 0;
        const over = hist.filter(h => h.planned > 0 && h.spent > h.planned + 0.005).length;
        const custom = (ctx.year.groups || []).map(g => g.name);
        // Savings lines say what they're for (emergency money doesn't count toward Step 4).
        const PURPOSE_LABEL = { emergencia: 'emergency fund', jubilacion: 'jubilación', general: 'general savings' };
        const purposeField = (it, lineId) => {
            if (!Engine.isSavingsItem(it)) return '';
            const auto = PURPOSE_LABEL[Engine.savingsPurpose(Object.assign({}, it, { purpose: '' }))];
            const opts = [{ value: '', label: `Automatic (${auto})` }, { value: 'emergencia', label: 'Emergency fund' }, { value: 'jubilacion', label: 'Jubilación' }, { value: 'general', label: 'General savings' }];
            return `<label class="field mt-3 max-w-sm"><span class="field-label">What is this saving for?</span><select class="input" data-change="line.setPurpose" data-id="${esc(String(lineId))}">${Views.selectOptions(opts, it.purpose || '')}</select>
                <span class="help">The emergency fund doesn't count as retirement saving (Step 4).</span></label>`;
        };
        const settings = item.link ? `<p class="help">It's ${item.link === 'debt' ? 'a debt' : 'a goal'}'s line: edit it in <a href="#" class="link" data-goto="futuro/metas">Debts & Goals</a>.</p>` : `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="field"><span class="field-label">Group</span><select class="input" data-change="line.setGroup" data-id="${esc(String(id))}"><option value="">By its type</option>${custom.map(n => `<option ${n === item.group ? 'selected' : ''}>${esc(n)}</option>`).join('')}</select></label>
                <label class="field"><span class="field-label">Type</span><select class="input" data-change="line.setType" data-id="${esc(String(id))}">${Views.selectOptions(Defaults.BUDGET_TYPES, item.type)}</select></label>
                <label class="field"><span class="field-label">Linked category</span><select class="input" data-change="line.setCategory" data-id="${esc(String(id))}">${Views.selectOptions([{ value: 'none', label: 'Not linked' }].concat(Object.keys(s.taxonomy.expense).map(c => ({ value: c, label: c }))), item.linkedCategory || 'none')}</select></label>
            </div>${purposeField(item, id)}`;
        const sheet = UI.sheet({ title: item.name, icon: 'fa-chart-simple', wide: true, html: `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-3">
                <div class="kpi tone-slate"><span class="kpi-label">Planeado · ${Fmt.MONTH_NAMES[sm - 1]}</span><span class="kpi-value">${money(cur.planned)}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Spent</span><span class="kpi-value">${money(cur.spent)}</span></div>
                <div class="kpi ${cur.planned - cur.spent < -0.005 ? 'tone-red' : 'tone-emerald'}"><span class="kpi-label">Remaining</span><span class="kpi-value">${money(cur.planned - cur.spent)}</span></div>
            </div>
            <div class="chart-box" style="height:13rem"><canvas id="line-detail-chart"></canvas></div>
            <p class="help mb-3">Average spent: <strong>${money(avg)}</strong>/mo in months with spending · You went over in ${over} of the last 12 months.</p>
            ${settings}
            <div class="section-label mt-4">${Fmt.MONTH_NAMES[sm - 1]} transactions</div>
            ${cur.txns.length ? `<div class="space-y-1 text-xs">${cur.txns.map(x => `<div class="flex justify-between gap-2 bg-slate-50 rounded-lg px-2 py-1.5"><span class="truncate">${esc(x.date)} · <strong>${esc(x.description)}</strong>${Array.isArray(x.splits) && x.splits.length ? ' <span class="badge badge-muted">dividida</span>' : ''}</span><span class="font-bold whitespace-nowrap">${money(x.amount)}</span></div>`).join('')}</div>` : '<p class="help">No transactions this month.</p>'}` });
        UI.chart('line-detail-chart', {
            type: 'line',
            data: { labels: hist.map(h => h.label), datasets: [
                { label: 'Planeado', data: hist.map(h => h.planned), borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, stepped: true },
                { label: 'Gastado', data: hist.map(h => h.spent), borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,.10)', borderWidth: 2, pointRadius: 4, fill: true, cubicInterpolationMode: 'monotone' }
            ] },
            options: { interaction: { mode: 'index', intersect: false } }
        });
        return sheet;
    }

    // Split one expense across several budget lines (up to 3; the rest follows the usual rule).
    async function openSplit(t) {
        const y = Number(t.date.slice(0, 4)), m = String(Number(t.date.slice(5, 7)));
        const items = Engine.monthItems(Store.effective(y), m);
        const options = [{ value: '', label: '—' }].concat(items.map(i => ({ value: String(i.id), label: i.name })));
        const cur = Array.isArray(t.splits) ? t.splits : [];
        const fields = [];
        for (let k = 0; k < 3; k++) {
            fields.push({ name: 'line' + k, label: `Line ${k + 1}`, options, value: cur[k] ? String(cur[k].line) : '' });
            fields.push({ name: 'amt' + k, label: `Amount ${k + 1}`, type: 'number', min: 0, step: '0.01', value: cur[k] ? cur[k].amount : '' });
        }
        const r = await UI.form({ title: `Dividir "${t.description}" (${money(t.amount)})`, message: 'Split the amount across lines. Whatever you don\'t split counts as usual (by its category).', fields, confirmText: 'Guardar',
            validate: v => { const tot = [0, 1, 2].reduce((a, k) => a + (v['line' + k] ? Number(v['amt' + k]) || 0 : 0), 0); return tot > Number(t.amount) + 0.005 ? `You split ${money(tot)}, more than ${money(t.amount)}.` : null; } });
        if (!r) return;
        const splits = [0, 1, 2].map(k => ({ line: r['line' + k], amount: Math.round((Number(r['amt' + k]) || 0) * 100) / 100 })).filter(x => x.line && x.amount > 0);
        if (splits.length) { t.splits = splits; delete t.budgetLine; } else delete t.splits;
        App.changed({ structural: true, step: true });
        UI.toast(splits.length ? `"${t.description}" split across ${splits.length} line${splits.length === 1 ? '' : 's'}.` : 'Split removed.');
    }

    UI.register({
        'txn.assignLine': (el) => {
            if (el.value === '__split') { const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id)); if (t) openSplit(t); return; }
            const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id));
            if (t && t.splits) delete t.splits;
            assignLine(Number(el.dataset.id), el.value);
        },
        'line.detail': (el) => openDetail(el.dataset.id),
        'line.setGroup': (el) => {
            lineCopies(Store.active(), el.dataset.id).forEach(i => { if (el.value) i.group = el.value; else delete i.group; });
            App.changed({ structural: true, step: true });
            openDetail(el.dataset.id);
        },
        'line.setType': (el) => {
            lineCopies(Store.active(), el.dataset.id).forEach(i => { i.type = el.value; });
            App.changed({ structural: true, step: true });
            openDetail(el.dataset.id);
        },
        'line.setCategory': (el) => {
            lineCopies(Store.active(), el.dataset.id).forEach(i => { i.linkedCategory = el.value; });
            App.changed({ structural: true, step: true });
            openDetail(el.dataset.id);
        },
        'line.setPurpose': (el) => {
            lineCopies(Store.active(), el.dataset.id).forEach(i => { if (el.value) i.purpose = el.value; else delete i.purpose; });
            App.changed({ step: true });
            openDetail(el.dataset.id);
        },
        'group.add': async () => {
            const r = await UI.form({ title: 'New group', fields: [
                { name: 'name', label: 'Group name', placeholder: 'E.g. Giving, Pets, Car' },
                { name: 'type', label: 'What kind of money is it?', options: [{ value: 'Gasto Variable', label: 'Expenses that vary' }, { value: 'Gasto Fijo', label: 'Fixed expenses' }, { value: 'Ahorro/Inversión', label: 'Ahorro' }] }
            ], confirmText: 'Crear', validate: v => !v.name.trim() ? 'Type a name.' : (Store.active().groups || []).some(g => g.name === v.name.trim()) ? 'There\'s already a group with that name.' : null });
            if (!r) return;
            const yd = Store.active();
            (yd.groups || (yd.groups = [])).push({ name: r.name.trim().slice(0, 40), type: r.type });
            App.changed({ structural: true, step: true });
            UI.toast(`Group "${r.name.trim()}" created. Add lines to it or move one from its detail (chart icon).`);
        },
        'group.delete': (el) => {
            const yd = Store.active();
            App.undoable(`Grupo "${el.dataset.name}" quitado`, () => { yd.groups = (yd.groups || []).filter(g => g.name !== el.dataset.name); });
        },
        'budget.mode': (el) => { Store.ui.budgetMode = el.dataset.mode; App.update(); },
        'budget.layout': (el) => { Store.ui.budgetLayout = el.dataset.layout; App.render(); }
    });

    root.BudgetSimple = { render, update, lineOptions, groupOf, GROUPS, assignLine };
})(this);
