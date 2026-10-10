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
    const MODES = { planned: 'Planned', spent: 'Spent', remaining: 'Remaining', all: 'All' };
    const INCOME_MODES = { planned: 'Planned', spent: 'Received', remaining: 'To receive', all: 'All' };

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
        const badge = item.link ? `<a href="#" class="badge ${item.link === 'debt' ? 'badge-bad' : 'badge-purple'}" data-goto="futuro/metas" data-focus="${item.link === 'debt' ? 'metas-debts' : 'metas-goals'}"><i class="fa-solid fa-link"></i> ${item.link === 'debt' ? 'Deuda' : 'Goal'}</a>`
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
        const effLines = ctx.budgetYear.otherIncomes || [];
        (ctx.year.otherIncomes || []).forEach(src => {
            const taxed = src.pay ? (effLines.find(x => x.id === src.id) || src) : null;
            rows.push(`<div class="bs-row" data-income="${src.id}">
                <div class="bs-name"><input class="bs-name-input" value="${esc(src.name)}" data-change="income.set" data-id="${src.id}" data-field="name" aria-label="Income name">
                    <button type="button" class="row-del bs-del" data-action="income.delete" data-id="${src.id}" title="Delete income" aria-label="Delete income"><i class="fa-solid fa-trash-can"></i></button><span class="bs-sub" data-sub></span></div>
                ${valueCell(taxed ? `<a href="#" class="bs-input link text-right" data-goto="presupuesto/ingresos" data-focus="inc-earners-card" title="After taxes: figured in Income & Taxes">${money(taxed.amount)}</a>` : `<input type="number" class="bs-input" min="0" step="10" value="${Number(src.amount) || 0}" data-input="income.set" data-id="${src.id}" data-field="amount" aria-label="Planned for ${esc(src.name)}">`)}
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
            const opts = [{ value: '', label: `Automatic (${auto})` }, { value: 'emergencia', label: 'Emergency fund' }, { value: 'jubilacion', label: 'Retirement' }, { value: 'general', label: 'General savings' }];
            return `<label class="field mt-3 max-w-sm"><span class="field-label">What is this saving for?</span><select class="input" data-change="line.setPurpose" data-id="${esc(String(lineId))}">${Views.selectOptions(opts, it.purpose || '')}</select>
                <span class="help">The emergency fund doesn't count as retirement saving (Step 4).</span></label>`;
        };
        m.plannedItems.forEach(it => { if (it.group && !it.link && !custom.includes(it.group)) custom.push(it.group); });
        // A group can sit inside another (Car → Gas, Repairs): it's a section of its parent's card.
        const tree = Engine.groupTree(custom.map(n => (ctx.year.groups || []).find(x => x.name === n) || { name: n }));
        const kids = {};
        tree.forEach(t => { kids['g:' + t.name] = t.children.map(c => c.name); });
        const subHTML = (name) => {
            const gdef = (ctx.year.groups || []).find(x => x.name === name), list = byGroup['g:' + name] || [];
            const addType = (gdef && gdef.type) || (list[0] && list[0].type) || 'Gasto Variable';
            return `<div class="bs-subgroup" data-subgroup="${esc('g:' + name)}"><div class="bs-subhead"><span><i class="fa-solid fa-folder-tree text-slate-400"></i> ${esc(name)}</span><span class="bs-total" data-subtotal></span></div>
                ${list.map(lineRow).join('') || '<p class="bs-empty">No lines yet.</p>'}
                <div class="bs-subfoot"><button type="button" class="link" data-action="budget.addRow" data-type="${esc(addType)}" data-group="${esc(name)}"><i class="fa-solid fa-plus"></i> Add line</button>${!list.length ? ` <button type="button" class="mini-btn text-red-600 ml-2" data-action="group.delete" data-name="${esc(name)}">Remove group</button>` : ''}</div></div>`;
        };
        const order = GROUPS.map(g => g.type).concat(tree.map(t => 'g:' + t.name), Object.keys(byGroup).filter(k => !GROUPS.some(g => g.type === k) && !k.startsWith('g:')));
        const cards = order.map(g => {
            const isCustom = g.startsWith('g:');
            const name = isCustom ? g.slice(2) : g;
            const def = isCustom ? { label: name, icon: 'fa-folder-open' } : (GROUPS.find(x => x.type === g) || { label: g, icon: 'fa-folder' });
            const list = byGroup[g] || [];
            const gdef = (ctx.year.groups || []).find(x => x.name === name);
            const addType = isCustom ? ((gdef && gdef.type) || (list[0] && list[0].type) || 'Gasto Variable') : g;
            const sub = (kids[g] || []);
            const foot = g === 'Deuda' ? '<a href="#" class="link" data-goto="futuro/metas" data-focus="metas-debts"><i class="fa-solid fa-plus"></i> Add debt</a>'
                : GROUPS.some(x => x.type === g) || isCustom ? `<button type="button" class="link" data-action="budget.addRow" data-type="${esc(addType)}" ${isCustom ? `data-group="${esc(name)}"` : ''}><i class="fa-solid fa-plus"></i> Add line</button>${isCustom && !list.length && !sub.length ? ` <button type="button" class="mini-btn text-red-600 ml-2" data-action="group.delete" data-name="${esc(name)}">Remove group</button>` : ''}` : '<span></span>';
            return `<section class="bs-card" data-group="${esc(g)}">
                <header class="bs-head"><span class="bs-title"><i class="fa-solid ${def.icon} text-slate-400"></i> ${esc(def.label)}</span>${colsHTML(MODES)}</header>
                ${list.map(lineRow).join('') || (sub.length ? '' : '<p class="bs-empty">No lines yet.</p>')}${sub.map(subHTML).join('')}
                <footer class="bs-foot">${foot}<span class="bs-total" data-total></span></footer>
            </section>`;
        });
        cards.push('<button type="button" class="bs-add-group" data-action="group.add"><i class="fa-solid fa-folder-plus"></i> Add group<span class="block text-[11px] font-normal text-slate-500 mt-1">E.g. Giving, Pets, Car, Kids</span></button>');
        host.innerHTML = `
            <div class="bs-toolbar">
                <div class="segmented bs-modes" role="tablist" aria-label="What to show">${Object.keys(MODES).map(k => `<button type="button" data-action="budget.mode" data-mode="${k}">${MODES[k]}</button>`).join('')}</div>
                <button type="button" class="btn btn-secondary bs-view" data-action="budget.bubbles" aria-pressed="false"><i class="fa-solid fa-circle-nodes"></i> <span>Bubbles</span></button>
                <button type="button" class="btn btn-secondary" data-action="budget.suggest"><i class="fa-solid fa-wand-magic-sparkles"></i> <span>Suggest from my last 90 days</span></button>
                <span class="bs-month" id="bs-month"></span>
            </div>
            <section class="bs-card hidden" id="bs-bubbles" aria-label="Budget lines as bubbles"></section>
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
            if (col) col.textContent = md === 'all' ? 'Planned' : (c.dataset.group === 'income' ? INCOME_MODES : MODES)[md];
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
        // A card's total takes in its sub-groups; each sub-group shows its own.
        const inside = (c) => [...c.querySelectorAll('[data-subgroup]')].map(x => x.dataset.subgroup);
        UI.$$('#bud-simple .bs-subgroup[data-subgroup]').forEach(sg => {
            const list = m.plannedItems.filter(it => groupOf(it) === sg.dataset.subgroup);
            const v = pick(list.reduce((t, it) => t + (Number(it.real) || 0), 0), list.reduce((t, it) => t + spentOf(it.id).spent, 0));
            const el = sg.querySelector('[data-subtotal]');
            el.textContent = money(v);
            el.classList.toggle('text-red-600', md === 'remaining' && v < -0.005);
        });
        UI.$$('#bud-simple .bs-card[data-group]').forEach(c => {
            const g = c.dataset.group;
            if (g === 'income') return;
            const subs = inside(c);
            const list = m.plannedItems.filter(it => groupOf(it) === g || subs.includes(groupOf(it)));
            const planned = list.reduce((t, it) => t + (Number(it.real) || 0), 0) + (g === 'Ahorro' ? mb.sweep : 0);
            const spent = list.reduce((t, it) => t + spentOf(it.id).spent, 0);
            const el = c.querySelector('[data-total]');
            const v = pick(planned, spent);
            el.textContent = money(v);
            el.classList.toggle('text-red-600', md === 'remaining' && v < -0.005);
        });

        // For the bubbles' summary: spent of budgeted, earned of projected, still unbudgeted.
        const budgeted = m.plannedItems.reduce((t, it) => t + (Number(it.real) || 0), 0);
        bubbles(ctx, m, spentOf, { budgeted, spent: m.plannedItems.reduce((t, it) => t + spentOf(it.id).spent, 0), earned: incReceived, projected: incPlanned, unbudgeted: mb.balanceReal });

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

    // Bubbles (the bank's Budgets): one per category, sized by what's planned (area), filled by
    // how much of it is spent — under 80%, 80–100%, over — with an icon and a word too, never
    // color alone. They pack like soap bubbles (Engine.packCircles); drag one and the others move
    // aside. Tap one for its details. Above: Bubbles | List, the month ‹ › and "+ Manage budgets";
    // below: spent of budgeted, earned of projected and what's still unbudgeted.
    const BUBBLE_STATE = { ok: { icon: 'fa-circle-check', label: 'On track' }, warn: { icon: 'fa-circle-exclamation', label: 'Almost spent' }, over: { icon: 'fa-triangle-exclamation', label: 'Over budget' } };
    const catIcon = (c) => (root.Defaults && Defaults.categoryIcon ? Defaults.categoryIcon(c) : 'fa-tag');
    let lastBubbles = [], bubCtx = null;
    const bubPos = {};          // category → {x, y} where it was left (kept while the app is open)
    let field = null;           // { circles, list, W, H }
    function monthLabel(y, m) { return `${Fmt.MONTH_NAMES[m - 1]} ${y}`; }
    function bubbles(ctx, m, spentOf, totals) {
        const on = !!Store.ui.budgetBubbles;
        const box = document.getElementById('bs-bubbles');
        const btn = document.querySelector('#bud-simple [data-action="budget.bubbles"]');
        if (btn) { btn.setAttribute('aria-pressed', String(on)); btn.classList.toggle('active', on); btn.querySelector('span').textContent = I18n.t(on ? 'Cards' : 'Bubbles'); btn.querySelector('i').className = `fa-solid ${on ? 'fa-table-list' : 'fa-circle-nodes'}`; }
        UI.$$('#bud-simple .bs-grid').forEach(g => g.classList.toggle('hidden', on));
        if (!box) return;
        box.classList.toggle('hidden', !on);
        if (!on) return;
        bubCtx = { ctx, m, spentOf, totals };
        const y = ctx.state.activeYear, sm = Number(m.sm) || 0;
        const bar = `<div class="bub-bar">
                <div class="segmented" role="group" aria-label="View"><button type="button" class="active" aria-pressed="true" aria-label="Bubbles"><i class="fa-solid fa-circle-nodes"></i></button><button type="button" data-action="budget.view" data-view="list" aria-label="List"><i class="fa-solid fa-list-ul"></i></button></div>
                <div class="txn-range" role="group" aria-label="Month"><button type="button" class="txn-range-step" data-action="budget.bubMonth" data-dir="-1" aria-label="Previous month"><i class="fa-solid fa-chevron-left"></i></button>
                    <span class="txn-range-pick" id="bub-month" data-i18n-skip>${sm ? esc(monthLabel(y, sm)) : esc(String(y))}</span>
                    <button type="button" class="txn-range-step" data-action="budget.bubMonth" data-dir="1" aria-label="Next month"><i class="fa-solid fa-chevron-right"></i></button></div>
                <button type="button" class="link text-sm" data-action="budget.view" data-view="manage"><i class="fa-solid fa-plus"></i> Manage budgets</button>
            </div>`;
        if (!m.sm) { box.innerHTML = bar + '<p class="bs-empty">Pick a month to see what was spent.</p>'; return; }
        const list = lastBubbles = Engine.budgetBubbles(m.plannedItems, id => spentOf(id).spent).filter(x => x.planned > 0.005);
        // Nothing planned yet besides debt and goal payments: the intro.
        if (!m.plannedItems.some(it => !it.link && !it.sweep && Number(it.real) > 0.005)) { box.innerHTML = bar + intro(); return; }
        box.innerHTML = `${bar}<div class="bub-field" id="bub-field"></div>${summary(totals)}
            <p class="bubble-key">${Object.keys(BUBBLE_STATE).map(k => `<span class="is-${k}"><i class="fa-solid ${BUBBLE_STATE[k].icon}"></i> ${BUBBLE_STATE[k].label}</span>`).join('')}<span>Size: money planned</span></p>
            <p class="help">Green under 80% spent, yellow 80–100%, red over. Tap a bubble for its details; drag it to move it.</p>`;
        layoutField(list);
    }
    function bubbleHTML(x, i, d, style) {
        const info = BUBBLE_STATE[x.state], name = I18n.t(x.category);
        const p = x.planned > 0 ? Math.min(100, Math.round(x.spent / x.planned * 100)) : 100;
        return `<button type="button" class="bubble is-${x.state}" style="${style}width:${d}px;height:${d}px;font-size:${Math.max(9, Math.min(13, d / 10)).toFixed(1)}px;--p:${p}" data-action="budget.bubble" data-index="${i}"
            aria-label="${esc(`${name}: ${money0(x.spent)} / ${money0(x.planned)} · ${I18n.t(info.label)}`)}">
            <i class="fa-solid ${catIcon(x.category)} bubble-icon" aria-hidden="true"></i>
            <span class="bubble-name ${d >= 104 ? '' : 'sr-only'}" data-i18n-skip>${esc(name)}</span>
            ${d >= 64 ? `<span class="bubble-amt"><b>${money0(x.spent)}</b> /<br>${money0(x.planned)}</span>` : ''}
            <span class="sr-only"><i class="fa-solid ${info.icon}"></i> ${x.share === null ? '' : Math.round(x.share * 100) + '%'}</span></button>`;
    }
    // Sizes by area (they fill about half the field), positions from where they were or a spiral.
    function layoutField(list) {
        const el = document.getElementById('bub-field');
        if (!el) return;
        const W = Math.max(280, el.clientWidth || 340), H = Math.round(Math.min(560, Math.max(320, W * (W < 640 ? 1.1 : 0.6))));
        el.style.height = H + 'px';
        const total = list.reduce((a, x) => a + x.planned, 0) || 1, area = W * H * 0.5;
        const maxR = Math.min(W, H) * 0.28, minR = 24;
        let radii = list.map(x => Math.max(minR, Math.min(maxR, Math.sqrt(area * x.planned / total / Math.PI)))), circles = null;
        // Pack; if some still overlap (too many for the box), shrink them a little and pack again.
        for (let k = 0; k < 8; k++) {
            const start = Engine.spiralStart(radii, W, H).map((c, i) => { const p = bubPos[list[i].category]; return p ? { x: p.x * W, y: p.y * H, r: c.r } : c; });
            circles = Engine.packCircles(start, { width: W, height: H, rounds: 300 });
            const overlap = circles.some((a, i) => circles.slice(i + 1).some(c => Math.hypot(a.x - c.x, a.y - c.y) < a.r + c.r - 0.5));
            if (!overlap) break;
            radii = radii.map(r => Math.max(16, r * 0.92));
        }
        field = { circles, list, W, H };
        el.innerHTML = list.map((x, i) => bubbleHTML(x, i, Math.round(circles[i].r * 2), `left:${(circles[i].x - circles[i].r).toFixed(1)}px;top:${(circles[i].y - circles[i].r).toFixed(1)}px;`)).join('');
        list.forEach((x, i) => { bubPos[x.category] = { x: circles[i].x / W, y: circles[i].y / H }; });
    }
    function placeAll() {
        const el = document.getElementById('bub-field');
        if (!el || !field) return;
        const nodes = el.querySelectorAll('.bubble');
        field.circles.forEach((c, i) => { const n = nodes[i]; if (n) { n.style.left = (c.x - c.r).toFixed(1) + 'px'; n.style.top = (c.y - c.r).toFixed(1) + 'px'; } bubPos[field.list[i].category] = { x: c.x / field.W, y: c.y / field.H }; });
    }
    // Drag: the held bubble follows the finger, the others make room; let go and they settle.
    let drag = null, justDragged = false;
    if (typeof document !== 'undefined') {
        document.addEventListener('pointerdown', (e) => {
            const b = e.target.closest && e.target.closest('#bub-field .bubble');
            if (!b || !field || e.button > 0) return;
            const r = document.getElementById('bub-field').getBoundingClientRect();
            drag = { i: Number(b.dataset.index), ox: e.clientX, oy: e.clientY, r, moved: false, el: b };
        });
        document.addEventListener('pointermove', (e) => {
            if (!drag || !field) return;
            if (!drag.moved && Math.hypot(e.clientX - drag.ox, e.clientY - drag.oy) < 6) return;
            if (!drag.moved) { drag.moved = true; drag.el.classList.add('is-dragging'); try { drag.el.setPointerCapture(e.pointerId); } catch (err) { /* ok */ } }
            const c = field.circles[drag.i];
            c.x = Math.min(field.W - c.r, Math.max(c.r, e.clientX - drag.r.left));
            c.y = Math.min(field.H - c.r, Math.max(c.r, e.clientY - drag.r.top));
            field.circles = Engine.packCircles(field.circles, { width: field.W, height: field.H, rounds: 6, fixed: drag.i, pull: 0.004 });
            placeAll();
            e.preventDefault();
        });
        const end = () => {
            if (!drag) return;
            const d = drag; drag = null;
            if (!d.moved) return;
            d.el.classList.remove('is-dragging');
            justDragged = true; setTimeout(() => { justDragged = false; }, 50);
            // The dropped bubble stays where it was let go; the others settle around it.
            let n = 0;
            const settle = () => {
                if (!field) return;
                const last = ++n >= 20;
                field.circles = Engine.packCircles(field.circles, { width: field.W, height: field.H, rounds: last ? 80 : 3, fixed: d.i, pull: last ? 0 : 0.004 });
                // Wedged against an edge: let the dropped one give way a little too.
                const c = field.circles;
                if (last && c.some((a, i) => c.slice(i + 1).some(b => Math.hypot(a.x - b.x, a.y - b.y) < a.r + b.r - 0.5))) field.circles = Engine.packCircles(c, { width: field.W, height: field.H, rounds: 200, pull: 0 });
                placeAll();
                if (!last) requestAnimationFrame(settle);
            };
            requestAnimationFrame(settle);
        };
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
    }

    // The first screen when the month has nothing planned: what the colors mean, and a budget made
    // from the last 3 months' spending, or a blank one.
    function intro() {
        return `<div class="bub-intro">
            <h3 class="text-lg font-bold">Understand the health of your finances</h3>
            <p class="text-sm text-slate-500">And keep your budget on track.</p>
            <div class="bub-intro-key">
                <span class="bubble is-ok" style="--p:50"><i class="fa-solid fa-utensils bubble-icon"></i></span><span><b>Green</b> · 0–79% used</span>
                <span class="bubble is-warn" style="--p:90"><i class="fa-solid fa-house bubble-icon"></i></span><span><b>Yellow</b> · 80–100% used</span>
                <span class="bubble is-over" style="--p:100"><i class="fa-solid fa-car bubble-icon"></i></span><span><b>Red</b> · over budget</span>
            </div>
            <p class="text-sm">Bubbles show which budgets need attention first: the bigger the bubble, the more money it has.</p>
            <p class="text-sm">Get started with budgets made from what you spent in the last 3 months.</p>
            <button type="button" class="btn btn-primary" data-action="budget.autoGen"><i class="fa-solid fa-wand-magic-sparkles"></i> Auto-generate budgets</button>
            <button type="button" class="link text-sm" data-action="budget.view" data-view="manage">No thanks. I'll start from scratch.</button>
        </div>`;
    }
    // Spent of budgeted and earned of projected, as two bars; open it for the words and what's
    // still unbudgeted.
    function summary(t) {
        const open = !!Store.ui.bubSumOpen, pct = (a, b) => Math.max(0, Math.min(100, b > 0 ? a / b * 100 : 0)).toFixed(1);
        return `<div class="bub-sum ${open ? 'is-open' : ''}">
            <button type="button" class="bub-sum-toggle" data-action="budget.sumToggle" aria-expanded="${open}" aria-label="${open ? 'Hide details' : 'Show details'}"><i class="fa-solid ${open ? 'fa-chevron-down' : 'fa-chevron-up'}"></i></button>
            <div class="bub-sum-row"><div class="bub-sum-bar"><span class="${t.spent > t.budgeted + 0.005 ? 'is-over' : 'is-spent'}" style="width:${pct(t.spent, t.budgeted)}%"></span></div><span class="bub-sum-label">Spent</span></div>
            ${open ? `<p class="text-sm">Spent <b>${money0(t.spent)}</b> of <b>${money0(t.budgeted)}</b> budgeted</p>` : ''}
            <div class="bub-sum-row"><div class="bub-sum-bar"><span class="is-income" style="width:${pct(t.earned, t.projected)}%"></span></div><span class="bub-sum-label">Income</span></div>
            ${open ? `<p class="text-sm">Earned <b>${money0(t.earned)}</b> of <a href="#" class="link" data-goto="presupuesto/ingresos">${money0(t.projected)}</a> projected income</p>
                <p class="text-sm ${t.unbudgeted < -0.005 ? 'text-red-600' : 'text-slate-500'}">${t.unbudgeted < -0.005 ? `${money0(-t.unbudgeted)} budgeted over your income` : `${money0(t.unbudgeted)} unbudgeted`}</p>` : ''}
        </div>`;
    }

    // ------------------------------------------------------------------ a bubble's details
    // The bubble big, with ✎ (edit its budget) and + (a sub-budget: one of its subcategories), its
    // spending for 12 months (this month darker, the budget as a dashed line; tap a month for its
    // value), "View transactions", the month's pace and its lines. Everything stays in one sheet.
    let bubbleMonth = null, bubView = 'main', bubTarget = null;
    function openBubble(i) {
        const b = lastBubbles[i];
        if (!b || justDragged) return;
        bubbleMonth = b; bubView = 'main'; bubTarget = null;
        const y = Store.state.activeYear, m = Number(spendMonth(App.buildContext())) || (new Date().getMonth() + 1);
        bubbleSheet = UI.sheet({ title: monthLabel(y, m), icon: 'fa-circle-nodes', wide: true, html: '<div id="bub-detail"></div>', onClose: () => { bubbleSheet = null; } });
        drawBubble();
    }
    function bubItems() { return Engine.monthItems(Store.active(), Store.ui.month); }
    const editableOf = (cat) => bubItems().filter(it => !it.link && !it.sweep && (it.linkedCategory || 'Otros') === cat);
    function refreshBubble() {
        const ctx = App.buildContext(), m = model(ctx);
        const sp = (id) => (m.spend.byLine[String(id)] || { spent: 0 }).spent;
        const b = Engine.budgetBubbles(m.plannedItems, sp).find(x => x.category === bubbleMonth.category);
        bubbleMonth = b || Object.assign({}, bubbleMonth, { planned: 0, lines: [], share: null, state: 'ok' });
    }
    function drawBubble() {
        const host = document.getElementById('bub-detail'), b = bubbleMonth;
        if (!host || !b) return;
        if (bubView === 'edit') { drawEdit(host); return; }
        if (bubView === 'add') { drawAdd(host); return; }
        const items = bubItems();
        const editable = (l) => { const it = items.find(x => String(x.id) === String(l.id)); return it && !it.link && !it.sweep; };
        const row = (l) => {
            const max = Math.max(50, Math.ceil(Math.max(l.planned, l.spent) * 2 / 10) * 10);
            return `<div class="bub-line" data-line="${esc(String(l.id))}">
                <div class="flex justify-between gap-2 text-sm"><span class="font-semibold truncate" data-i18n-skip>${esc(I18n.t(l.name))}</span><span class="flex gap-1">${editable(l) ? `<button type="button" class="mini-btn" data-action="budget.bubEdit" data-id="${esc(String(l.id))}" aria-label="Edit ${esc(I18n.t(l.name))}"><i class="fa-solid fa-pen"></i></button>` : ''}<button type="button" class="mini-btn" data-action="budget.bubbleLine" data-id="${esc(String(l.id))}">Details</button></span></div>
                <div class="flex justify-between text-xs text-slate-500 mt-1"><span>Planned <strong class="text-slate-800" data-planned>${money(l.planned)}</strong></span><span class="${l.spent > l.planned + 0.005 ? 'text-red-600 font-bold' : ''}">Spent ${money(l.spent)}</span></div>
                ${editable(l) ? `<input type="range" class="bub-slider" min="0" max="${max}" step="5" value="${Math.round(l.planned)}" data-input="budget.slide" data-id="${esc(String(l.id))}" data-field="real" data-sync="prep" aria-label="Planned for ${esc(I18n.t(l.name))}">` : ''}
            </div>`;
        };
        host.innerHTML = `<div class="bub-detail-head">
                <div class="bub-actions"><button type="button" class="bub-act" data-action="budget.bubAdd" aria-label="Add a sub-budget" title="Add a sub-budget"><i class="fa-solid fa-plus"></i></button>
                    <button type="button" class="bub-act" data-action="budget.bubEdit" aria-label="Edit the budget" title="Edit the budget"><i class="fa-solid fa-pen"></i></button></div>
                ${bubbleHTML(b, -1, 150, 'position:relative;')}
            </div>
            <div class="chart-box" style="height:11rem"><canvas id="bub-months" aria-label="${esc(I18n.t(b.category))}: 12 months"></canvas></div>
            <div class="flex justify-center my-2"><button type="button" class="btn btn-secondary btn-sm" data-action="budget.bubTxns"><i class="fa-solid fa-list-ul"></i> View transactions</button></div>
            <div id="bub-pace"></div>${b.lines.map(row).join('')}`;
        host.querySelector('.bub-detail-head .bubble').removeAttribute('data-action');
        drawMonths();
        drawPace();
    }
    function drawMonths() {
        const b = bubbleMonth, ctx = App.buildContext(), pal = UI.palette();
        const y = ctx.state.activeYear, m = Number(spendMonth(ctx)) || (ctx.today.getMonth() + 1);
        const budgetOf = (yy, mm) => { if (!ctx.state.years[yy]) return 0; return Engine.monthItems(Store.effective(yy), String(mm)).filter(it => !it.sweep && (it.linkedCategory || 'Otros') === b.category).reduce((a, it) => a + (Number(it.real) || 0), 0); };
        const r = Engine.categoryMonths(ctx.state.transactions, { category: b.category, end: new Date(y, m - 1, 1), months: 12, budgetOf });
        UI.chart('bub-months', {
            type: 'bar',
            data: { labels: r.map(x => Fmt.MONTH_SHORT[x.month - 1]), datasets: [
                { type: 'bar', label: 'Spent', data: r.map(x => Math.round(x.spent * 100) / 100), backgroundColor: r.map((x, i) => (i === r.length - 1 ? pal.series[0] : pal.series[0] + '66')), borderRadius: 4, order: 2 },
                { type: 'line', label: 'Budget', data: r.map(x => Math.round(x.budget * 100) / 100), borderColor: pal.muted, borderDash: [4, 4], borderWidth: 1.5, pointRadius: 0, stepped: 'middle', fill: false, order: 1 }
            ] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true, ticks: { callback: (v) => money0(v) } } } }
        });
    }
    // The category's month so far: where spending should be by today, and what's left per day.
    function drawPace() {
        const b = bubbleMonth, host = document.getElementById('bub-pace');
        if (!b || !host) return;
        const t = new Date(), m = Store.ui.month === 'base' ? t.getMonth() + 1 : Number(Store.ui.month);
        const current = Store.state.activeYear === t.getFullYear() && m === t.getMonth() + 1;
        const planned = b.lines.reduce((a, l) => a + l.planned, 0);
        if (!current || !(planned > 0)) { host.innerHTML = `<p class="text-sm mb-3">${money(b.spent)} spent of ${money(planned)} planned.</p>`; return; }
        const days = new Date(t.getFullYear(), m, 0).getDate();
        const p = Engine.spendPace({ planned, spent: b.spent, day: t.getDate(), daysInMonth: days });
        const pct = (v) => Math.max(0, Math.min(100, v / Math.max(planned, b.spent) * 100)).toFixed(1);
        host.innerHTML = `<div class="pace mb-3">
            <div class="pace-bar"><span class="pace-fill is-${p.state}" style="width:${pct(b.spent)}%"></span><span class="pace-mark" style="left:${pct(p.expected)}%" title="Where spending would be by today"></span></div>
            <div class="flex justify-between text-xs mt-1"><span>${money(b.spent)} of ${money(planned)}</span><span class="text-slate-500">By today: ${money(p.expected)}</span></div>
            <p class="text-sm mt-1 ${p.state === 'ok' ? 'text-emerald-700' : 'text-red-600'}"><i class="fa-solid ${p.state === 'ok' ? 'fa-circle-check' : 'fa-triangle-exclamation'}"></i> ${p.state === 'over' ? 'Over the plan for this month.' : p.state === 'fast' ? 'Spending faster than planned.' : 'On pace.'} ${money(p.perDay)} a day left for ${p.daysLeft} day${p.daysLeft === 1 ? '' : 's'}.</p>
        </div>`;
    }
    // ✎: "Edit Housing budget?" — the amount (the difference goes to its biggest line), what's
    // still unbudgeted, Cancel / Save, and "Delete Housing budget" (undoable).
    function drawEdit(host) {
        const b = bubbleMonth, line = bubTarget ? bubItems().find(it => String(it.id) === String(bubTarget)) : null;
        const name = line ? I18n.t(line.name) : I18n.t(b.category);
        const amount = line ? Number(line.real) || 0 : editableOf(b.category).reduce((a, it) => a + (Number(it.real) || 0), 0);
        const unb = bubCtx && bubCtx.totals ? bubCtx.totals.unbudgeted : 0;
        host.innerHTML = `<div class="bub-edit">
            <div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="budget.bubBack" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong><span>Edit budget:</span> <span data-i18n-skip>${esc(name)}</span></strong></div>
            <p class="text-sm text-slate-500 text-center">Total unbudgeted: <span class="${unb < -0.005 ? 'text-red-600' : ''}">${money0(unb)}</span></p>
            <input type="number" class="input bub-edit-amt" id="bub-edit-amt" min="0" step="1" value="${Math.round(amount * 100) / 100}" aria-label="Budget for ${esc(name)}">
            ${!line && editableOf(b.category).length > 1 ? `<p class="help">This budget has ${editableOf(b.category).length} lines: the change goes to the biggest one. Edit a line with its ✎ for more control.</p>` : ''}
            ${!line && !editableOf(b.category).length ? '<p class="help">Its lines are debt or goal payments: change them in Debts & Goals. Saving adds a line for the rest.</p>' : ''}
            <div class="grid grid-cols-2 gap-2 mt-3"><button type="button" class="btn btn-secondary justify-center" data-action="budget.bubBack">Cancel</button><button type="button" class="btn btn-primary justify-center" data-action="budget.bubSave">Save</button></div>
            ${line || editableOf(b.category).length ? `<button type="button" class="link text-sm text-red-600 mt-4 mx-auto block" data-action="budget.bubDelete"><i class="fa-solid fa-trash-can"></i> <span>Delete budget:</span> <span data-i18n-skip>${esc(name)}</span></button>` : ''}
        </div>`;
        setTimeout(() => { const i = document.getElementById('bub-edit-amt'); if (i) { i.focus(); i.select(); } }, 30);
    }
    // +: "Add sub-budget": the category's subcategories (one with its own line is checked); pick one
    // to give it a budget, or add a new subcategory.
    function drawAdd(host) {
        const b = bubbleMonth, subs = (Store.state.taxonomy.expense || {})[b.category] || [];
        const have = new Set(editableOf(b.category).map(it => String(it.name).toLowerCase()));
        host.innerHTML = `<div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="budget.bubBack" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong>Add a sub-budget</strong></div>
            <div class="cat-pick"><div class="cat-pick-head"><span><i class="fa-solid ${catIcon(b.category)}"></i> ${esc(I18n.t(b.category))}</span></div>
            <div class="cat-pick-subs">${subs.map(s => { const on = have.has(I18n.t(s).toLowerCase()) || have.has(s.toLowerCase()); return `<button type="button" data-action="budget.bubSub" data-sub="${esc(s)}" ${on ? 'disabled' : ''}>${esc(I18n.t(s))}${on ? ' <i class="fa-solid fa-circle-check text-emerald-600"></i>' : ''}</button>`; }).join('')}
                <button type="button" class="link" data-action="budget.bubSubNew"><i class="fa-solid fa-plus"></i> Add a subcategory</button></div></div>`;
    }
    function monthList() {
        const yd = Store.active(), m = Store.ui.month;
        if (m !== 'base' && !yd.monthOverrides[m]) yd.monthOverrides[m] = Defaults.clone(yd.budgetBase);
        return Engine.monthItems(yd, m);
    }
    const lineType = (cat) => (['Vivienda', 'Servicios Básicos y Comunicación', 'Seguros y Protección'].includes(cat) ? 'Gasto Fijo' : cat === 'Ahorro e Inversión' ? 'Ahorro' : 'Gasto Variable');
    function setLineAmount(it, v) {
        if (Math.abs((Number(it.prep) || 0) - (Number(it.real) || 0)) < 0.005) it.prep = v;
        it.real = v;
    }
    function addLine(list, cat, name, amount) {
        const it = { id: Store.nextId(list), name, type: lineType(cat), isDeductible: false, prep: amount, real: amount, linkedCategory: cat };
        list.push(it);
        return it;
    }
    function autoGenerate() {
        const rows = Engine.autoBudget(Store.state.transactions, new Date());
        if (!rows.length) { UI.toast('No spending in the last 3 months yet: log or import a few months first, or start from scratch.', 'error'); return; }
        App.undoable(rows.length === 1 ? 'Budgets made from your last 3 months: 1 category' : `Budgets made from your last 3 months: ${rows.length} categories`, () => {
            const list = monthList();
            rows.forEach(r => {
                const same = list.filter(it => !it.link && !it.sweep && (it.linkedCategory || 'Otros') === r.category);
                if (same.length) { if (!same.some(it => Number(it.real) > 0)) setLineAmount(same[0], r.suggested); }
                else addLine(list, r.category, I18n.t(r.category), r.suggested);
            });
        });
    }
    function bubMonthStep(dir) {
        const ctx = App.buildContext(), s = ctx.state;
        let y = s.activeYear, m = (Number(spendMonth(ctx)) || (ctx.today.getMonth() + 1)) + dir;
        if (m < 1) { y--; m = 12; } else if (m > 12) { y++; m = 1; }
        if (y < s.configStartYear || y > s.configEndYear) { UI.toast('That month is outside the years in your plan (Settings).', 'error'); return; }
        if (y !== s.activeYear) { s.activeYear = y; Store.year(y); }
        Store.ui.month = String(m);
        App.changed({ structural: true });
    }
    // Transactions of the category in the month, in the same sheet, with ← back to the bubble.
    function drawBubTxns() {
        const host = document.getElementById('bub-detail'), b = bubbleMonth;
        if (!host || !b) return;
        const ctx = App.buildContext(), y = ctx.state.activeYear, m = Number(spendMonth(ctx)) || (ctx.today.getMonth() + 1);
        const from = `${y}-${String(m).padStart(2, '0')}-01`, to = Engine.isoDate(new Date(y, m, 0)), accts = Store.state.accounts || [];
        const list = Store.state.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && !Engine.isTransfer(t) && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === b.category).sort((a, c) => c.date.localeCompare(a.date));
        bubView = 'txns';
        host.innerHTML = `<div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="budget.bubBack" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong data-i18n-skip>${esc(I18n.t(b.category))} · ${esc(monthLabel(y, m))}</strong></div>
            <div class="acd-txns">${list.map(t => { const a = accts.find(z => z.id === t.accountId); return `<button type="button" class="acd-txn w-full text-left" style="grid-template-columns:4.6rem 1fr auto" data-action="budget.bubTxn" data-id="${t.id}">
                <span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span>
                <span class="min-w-0"><span class="block truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="block truncate text-[11px] text-slate-500"><span>${esc(I18n.t(t.category || t.parentCategory || ''))}</span>${a ? ` · <span data-i18n-skip>${esc(a.name)}</span>` : ''}</span></span>
                <span class="font-semibold whitespace-nowrap">${money(Engine.spendAmount(t))}</span></button>`; }).join('')}</div>
            <p class="text-center text-xs text-slate-400 mt-3">${list.length ? 'End of the list' : 'No transactions.'}</p>`;
    }

    // "Suggest from my last 90 days": each everyday line's average of the last 3 full months, in a
    // preview; you pick which to apply (undoable).
    let suggestSheet = null, suggestRows = [];
    function openSuggest() {
        const t = new Date(), months = [];
        for (let k = 1; k <= 3; k++) {
            const d = new Date(t.getFullYear(), t.getMonth() - k, 1), y = d.getFullYear(), m = String(d.getMonth() + 1);
            const items = Engine.monthItems(Store.effective(y), m);
            months.push({ spend: Engine.lineSpend(items, Store.state.transactions, y, m) });
        }
        const items = Engine.monthItems(Store.active(), Store.ui.month);
        suggestRows = Engine.suggestBudget(months, items).filter(r => r.avg > 0.5 || r.planned > 0);
        const differs = (r) => r.avg > 0.5 && Math.abs(r.suggested - r.planned) >= Math.max(5, r.planned * 0.1);
        suggestSheet = UI.sheet({ title: 'Suggest from my last 90 days', icon: 'fa-wand-magic-sparkles', wide: true, html: suggestRows.length ? `
            <p class="help mb-2">What you spent on average in the last 3 full months, per line. Check the ones to use; debts, goals and savings stay as they are.</p>
            <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Line</th><th class="num">Planned</th><th class="num">Suggested</th></tr></thead><tbody>
            ${suggestRows.map((r, i) => `<tr><td><input type="checkbox" class="sug-pick" data-i="${i}" ${differs(r) ? 'checked' : ''} aria-label="Use the suggestion"></td><td data-i18n-skip>${esc(I18n.t(r.name))}</td><td class="num">${money0(r.planned)}</td><td class="num"><span class="font-bold ${r.suggested > r.planned ? 'text-red-600' : r.suggested < r.planned ? 'text-emerald-700' : ''}">${money0(r.suggested)}</span><span class="block text-[11px] text-slate-500">avg ${money0(r.avg)}</span></td></tr>`).join('')}
            </tbody></table></div>
            <div class="flex justify-end mt-3"><button type="button" class="btn btn-primary" data-action="budget.suggestApply">Use the checked ones</button></div>`
            : '<p class="help">No spending in the last 3 months yet: log or import a few months first.</p>' });
    }
    function applySuggest() {
        const picked = UI.$$('.sug-pick').filter(c => c.checked).map(c => suggestRows[Number(c.dataset.i)]).filter(Boolean);
        if (!picked.length) { UI.toast('Check at least one line.', 'error'); return; }
        const yd = Store.active(), m = Store.ui.month;
        App.undoable(`Budget updated from your spending: ${picked.length} line${picked.length === 1 ? '' : 's'}`, () => {
            if (m !== 'base' && !yd.monthOverrides[m]) yd.monthOverrides[m] = Defaults.clone(yd.budgetBase);
            const items = Engine.monthItems(yd, m);
            picked.forEach(r => {
                const it = items.find(x => String(x.id) === String(r.id));
                if (!it) return;
                if (Math.abs((Number(it.prep) || 0) - (Number(it.real) || 0)) < 0.005) it.prep = r.suggested;
                it.real = r.suggested;
            });
        });
        if (suggestSheet) { suggestSheet.close(); suggestSheet = null; }
    }

    let bubbleSheet = null;

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
            UI.toast(`"${t.description}" now counts in «${item ? item.name : lineId}».`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
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
            const opts = [{ value: '', label: `Automatic (${auto})` }, { value: 'emergencia', label: 'Emergency fund' }, { value: 'jubilacion', label: 'Retirement' }, { value: 'general', label: 'General savings' }];
            return `<label class="field mt-3 max-w-sm"><span class="field-label">What is this saving for?</span><select class="input" data-change="line.setPurpose" data-id="${esc(String(lineId))}">${Views.selectOptions(opts, it.purpose || '')}</select>
                <span class="help">The emergency fund doesn't count as retirement saving (Step 4).</span></label>`;
        };
        const settings = item.link ? `<p class="help">It's ${item.link === 'debt' ? 'a debt' : 'a goal'}'s line: edit it in <a href="#" class="link" data-goto="futuro/metas">Debts & Goals</a>.</p>` : `
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <label class="field"><span class="field-label">Group</span><select class="input" data-change="line.setGroup" data-id="${esc(String(id))}"><option value="">By its type</option>${custom.map(n => { const p = ((Store.active().groups || []).find(x => x.name === n) || {}).parent; return `<option value="${esc(n)}" ${n === item.group ? 'selected' : ''}>${p ? `${esc(p)} › ` : ''}${esc(n)}</option>`; }).join('')}</select></label>
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
                { label: 'Planned', data: hist.map(h => h.planned), borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, stepped: true },
                { label: 'Spent', data: hist.map(h => h.spent), borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,.10)', borderWidth: 2, pointRadius: 4, fill: true, cubicInterpolationMode: 'monotone' }
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
        const r = await UI.form({ title: `Dividir "${t.description}" (${money(t.amount)})`, message: 'Split the amount across lines. Whatever you don\'t split counts as usual (by its category).', fields, confirmText: 'Save',
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
            // A group can go inside another one (one level): Car → Gas, Repairs.
            const tops = Engine.groupTree(Store.active().groups || []).map(g => ({ value: g.name, label: g.name }));
            const r = await UI.form({ title: 'New group', fields: [
                { name: 'name', label: 'Group name', placeholder: 'E.g. Giving, Pets, Car' },
                { name: 'type', label: 'What kind of money is it?', options: [{ value: 'Gasto Variable', label: 'Expenses that vary' }, { value: 'Gasto Fijo', label: 'Fixed expenses' }, { value: 'Ahorro', label: 'Savings & investing' }] }
            ].concat(tops.length ? [{ name: 'parent', label: 'Inside another group (optional)', options: [{ value: '', label: 'No: a group of its own' }].concat(tops), help: 'It shows as a section of that group, which adds it to its total.' }] : []),
            confirmText: 'Create', validate: v => !v.name.trim() ? 'Type a name.' : (Store.active().groups || []).some(g => g.name === v.name.trim()) ? 'There\'s already a group with that name.' : null });
            if (!r) return;
            const yd = Store.active();
            (yd.groups || (yd.groups = [])).push(Object.assign({ name: r.name.trim().slice(0, 40), type: r.type }, r.parent ? { parent: r.parent } : {}));
            App.changed({ structural: true, step: true });
            UI.toast(`Group "${r.name.trim()}" created. Add lines to it or move one from its detail (chart icon).`);
        },
        'group.delete': (el) => {
            const yd = Store.active();
            // Its sub-groups (if any) become groups of their own.
            App.undoable(`Grupo "${el.dataset.name}" quitado`, () => { yd.groups = (yd.groups || []).filter(g => g.name !== el.dataset.name).map(g => (g.parent === el.dataset.name ? Object.assign({}, g, { parent: undefined }) : g)); });
        },
        'budget.mode': (el) => { Store.ui.budgetMode = el.dataset.mode; App.update(); },
        'budget.bubbles': () => { Store.ui.budgetBubbles = !Store.ui.budgetBubbles; App.update(); },
        'budget.bubble': (el) => openBubble(Number(el.dataset.index)),
        // List: the cards; Manage: the cards with the planned column, to add and change lines.
        'budget.view': (el) => { Store.ui.budgetBubbles = false; if (el.dataset.view === 'manage') Store.ui.budgetMode = 'planned'; App.update(); const g = document.querySelector('#bud-simple .bs-grid'); if (g && el.dataset.view === 'manage') g.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
        // Tools bar → Budgets: the bubbles (the bank's way in).
        'budget.openBubbles': () => { Store.ui.budgetBubbles = true; App.update(); },
        'budget.bubMonth': (el) => bubMonthStep(Number(el.dataset.dir) || 0),
        'budget.sumToggle': () => { Store.ui.bubSumOpen = !Store.ui.bubSumOpen; App.update(); },
        'budget.autoGen': () => autoGenerate(),
        'budget.bubEdit': (el) => { bubTarget = el.dataset.id || null; bubView = 'edit'; drawBubble(); },
        'budget.bubAdd': () => { bubView = 'add'; drawBubble(); },
        'budget.bubBack': () => { bubView = 'main'; bubTarget = null; drawBubble(); },
        'budget.bubTxns': () => drawBubTxns(),
        'budget.bubTxn': (el) => {
            const id = Number(el.dataset.id), b = bubbleMonth;
            if (bubbleSheet) bubbleSheet.close();
            // Back from the transaction returns to this bubble's list.
            if (window.TxnDetails) TxnDetails.open(id, { back: () => { const i = lastBubbles.findIndex(x => x.category === b.category); if (i >= 0) { openBubble(i); drawBubTxns(); } } });
        },
        'budget.bubSave': () => {
            const v = Math.max(0, Fmt.parseNum((document.getElementById('bub-edit-amt') || {}).value, NaN));
            if (!isFinite(v)) { UI.toast('Type an amount.', 'error'); return; }
            const b = bubbleMonth, target = bubTarget;
            App.undoable(`Budget for ${I18n.t(b.category)}: ${money0(v)}`, () => {
                const list = monthList();
                if (target) { const it = list.find(x => String(x.id) === String(target)); if (it) setLineAmount(it, v); return; }
                const mine = list.filter(it => !it.link && !it.sweep && (it.linkedCategory || 'Otros') === b.category);
                const fixed = b.planned - mine.reduce((a, it) => a + (Number(it.real) || 0), 0);   // debt/goal lines
                if (!mine.length) { if (v - fixed > 0.005) addLine(list, b.category, I18n.t(b.category), Math.round((v - fixed) * 100) / 100); return; }
                const big = mine.slice().sort((x, y) => (Number(y.real) || 0) - (Number(x.real) || 0))[0];
                const others = mine.reduce((a, it) => a + (it === big ? 0 : Number(it.real) || 0), 0);
                setLineAmount(big, Math.max(0, Math.round((v - fixed - others) * 100) / 100));
            });
            refreshBubble(); bubView = 'main'; bubTarget = null; drawBubble();
        },
        'budget.bubDelete': async () => {
            const b = bubbleMonth, target = bubTarget;
            const ok = await UI.confirm({ title: 'Delete this budget?', message: target ? 'This line is removed from the month\'s budget. You can undo it.' : 'Its lines are removed from the month\'s budget (debt and goal payments stay). You can undo it.', confirmText: 'Delete', danger: true });
            if (!ok) return;
            App.undoable(`Budget for ${I18n.t(b.category)} deleted`, () => {
                const list = monthList();
                for (let i = list.length - 1; i >= 0; i--) {
                    const it = list[i];
                    if (target ? String(it.id) === String(target) : (!it.link && !it.sweep && (it.linkedCategory || 'Otros') === b.category)) list.splice(i, 1);
                }
            });
            refreshBubble();
            if (!target || !bubbleMonth.lines.length) { if (bubbleSheet) bubbleSheet.close(); return; }
            bubView = 'main'; bubTarget = null; drawBubble();
        },
        'budget.bubSub': (el) => {
            const b = bubbleMonth, sub = el.dataset.sub;
            let created = null;
            App.undoable(`Sub-budget added: ${I18n.t(sub)}`, () => { created = addLine(monthList(), b.category, I18n.t(sub), 0); });
            refreshBubble(); bubTarget = created ? created.id : null; bubView = 'edit'; drawBubble();
        },
        'budget.bubSubNew': async () => {
            const b = bubbleMonth;
            const r = await UI.form({ title: 'Add a subcategory', fields: [{ name: 'name', label: `Subcategory of ${I18n.t(b.category)}`, value: '' }], confirmText: 'Add' });
            if (!r || !r.name.trim()) return;
            const name = r.name.trim().slice(0, 60), tax = Store.state.taxonomy.expense;
            let created = null;
            App.undoable(`Sub-budget added: ${name}`, () => {
                if (!(tax[b.category] || []).includes(name)) (tax[b.category] = tax[b.category] || []).push(name);
                created = addLine(monthList(), b.category, name, 0);
            });
            refreshBubble(); bubTarget = created ? created.id : null; bubView = 'edit'; drawBubble();
        },
        'budget.slide': (el) => {
            const yd = Store.active(), m = Store.ui.month, v = Math.max(0, Fmt.parseNum(el.value, 0));
            if (m !== 'base' && !yd.monthOverrides[m]) yd.monthOverrides[m] = Defaults.clone(yd.budgetBase);
            const it = Engine.monthItems(yd, m).find(x => String(x.id) === el.dataset.id);
            if (!it || it.link || it.sweep) return;
            // Presupuestado follows the planned amount while they were the same (as in the cards).
            if (Math.abs((Number(it.prep) || 0) - (Number(it.real) || 0)) < 0.005) it.prep = v;
            it.real = v;
            App.changed();
            const line = el.closest('.bub-line');
            if (line) line.querySelector('[data-planned]').textContent = money(v);
            const l = bubbleMonth && bubbleMonth.lines.find(x => String(x.id) === el.dataset.id);
            if (l) { l.planned = v; drawPace(); }
        },
        'budget.suggest': () => openSuggest(),
        'budget.suggestApply': () => applySuggest(),
        'budget.bubbleLine': (el) => { if (bubbleSheet) bubbleSheet.close(); bubbleSheet = null; openDetail(el.dataset.id); },
        'budget.layout': (el) => { Store.ui.budgetLayout = el.dataset.layout; App.render(); }
    });

    root.BudgetSimple = { render, update, lineOptions, groupOf, GROUPS, assignLine, openSplit };
})(this);
