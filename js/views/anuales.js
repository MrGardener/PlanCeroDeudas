/* Presupuesto → Gastos anuales: yearly and irregular bills (registration, insurance, property tax,
 * school supplies, holiday gifts…) turned into one monthly set-aside, so they never arrive as a
 * surprise. The money is kept in a savings goal ("Gastos anuales") that the budget pays into each
 * month; when a bill comes, it's paid from that goal and doesn't count in that month's budget. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    const bills = () => Store.state.annualBills || (Store.state.annualBills = []);
    const fund = () => (Store.state.goals || []).find(g => g.annualFund);
    const ideas = () => (Store.defaults.annualIdeas ? Store.defaults.annualIdeas() : []);
    const tr = (s) => (window.I18n ? I18n.t(s) : s);
    const EVERY = [{ value: 12, label: 'Every year' }, { value: 6, label: 'Every 6 months' }, { value: 3, label: 'Every 3 months' }];
    const monthLabel = (y, m) => `${Fmt.MONTH_SHORT[m - 1]} ${y}`;

    function rowHTML(b, cats) {
        const opts = cats.includes(b.category) ? cats : cats.concat([b.category]);
        return `<tr data-row="${b.id}">
            <td><input class="cell-input" value="${esc(b.name)}" data-change="annual.set" data-id="${b.id}" data-field="name" aria-label="Gasto"></td>
            <td><input type="number" class="cell-input num" min="0" step="10" value="${Number(b.amount) || 0}" data-input="annual.set" data-id="${b.id}" data-field="amount" aria-label="Amount"></td>
            <td><select class="cell-input" data-change="annual.set" data-id="${b.id}" data-field="every" aria-label="How often">${Views.selectOptions(EVERY, Number(b.every) || 12)}</select></td>
            <td><select class="cell-input" data-change="annual.set" data-id="${b.id}" data-field="month" aria-label="Month it's due">${Views.selectOptions(Fmt.MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n })), Number(b.month) || 1)}</select></td>
            <td><select class="cell-input" data-change="annual.set" data-id="${b.id}" data-field="category" aria-label="Category">${Views.selectOptions(opts.filter(Boolean), b.category)}</select></td>
            <td class="num text-slate-500 whitespace-nowrap" data-cell="monthly"></td>
            <td class="text-center"><button class="row-del" data-action="annual.delete" data-id="${b.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function render(ctx) {
        const card = document.getElementById('bud-annual-card');
        if (!card) return;
        const list = bills();
        const cats = Object.keys(ctx.state.taxonomy.expense);
        UI.html('annual-body', list.length ? list.map(b => rowHTML(b, cats)).join('')
            : `<tr class="empty-row"><td colspan="7">${Views.emptyState('fa-calendar-days', 'List what you pay once or twice a year. We\'ll tell you how much to set aside each month so it never catches you off guard.')}</td></tr>`);
        const have = new Set(list.map(b => b.name.toLowerCase()));
        const left = ideas().map((x, i) => ({ x, i })).filter(({ x }) => !have.has(x.name.toLowerCase()));
        UI.html('annual-ideas', left.length ? `<span class="text-xs text-slate-500 mr-1">Ideas:</span>${left.map(({ x, i }) => `<button type="button" class="quick-chip" data-action="annual.idea" data-i="${i}" title="${esc(money0(x.amount))} · ${esc(EVERY.find(e => e.value === x.every).label)}"><i class="fa-solid fa-plus"></i> ${esc(x.name)}</button>`).join('')}` : '');
        update(ctx);
    }

    function update(ctx) {
        if (!document.getElementById('bud-annual-card')) return;
        const list = bills();
        const g = fund();
        list.forEach(b => {
            const cell = document.querySelector(`#annual-body tr[data-row="${b.id}"] [data-cell="monthly"]`);
            if (cell) cell.textContent = `${money((Number(b.amount) || 0) / (Number(b.every) || 12))}/mes`;
        });
        if (!list.length) { UI.html('annual-summary', ''); UI.html('annual-timeline', ''); return; }
        const need = Engine.annualSetAside(list);
        const plan = Engine.annualBillsPlan(list, { start: g ? Number(g.current) || 0 : 0, monthly: g ? Number(g.monthly) || 0 : need, today: ctx.today });
        const head = `<div class="kpi tone-emerald"><span class="kpi-label">Set aside each month</span><span class="kpi-value">${money(need)}</span><span class="kpi-note">${money0(plan.yearly)} a year across ${list.length} bill${list.length === 1 ? '' : 's'}</span></div>`;
        let fundHTML;
        if (!g) {
            fundHTML = `<div class="panel tone-amber text-xs space-y-2"><p><strong>You're not setting this money aside yet.</strong> Create an «Annual bills» goal of ${money(need)} a month: it shows in your budget like any savings line, and when each bill comes you pay it from there.</p>
                <button type="button" class="btn btn-primary btn-sm" data-action="annual.fund"><i class="fa-solid fa-piggy-bank"></i> Add the set-aside to my budget</button></div>`;
        } else {
            const low = (Number(g.monthly) || 0) + 0.005 < need;
            const msgs = [`Your «${esc(g.name)}» fund has <strong>${money(g.current)}</strong> and your budget puts in <strong>${money(g.monthly)}</strong> a month.`];
            if (low) msgs.push(`That's less than you need (${money(need)}). <button type="button" class="link" data-action="annual.fund">Ajustar a ${money(need)}</button>`);
            if (plan.firstShort) msgs.push(`<span class="text-red-700 font-semibold">In ${monthLabel(plan.firstShort.year, plan.firstShort.month)} you'd be ${money(plan.needed)} short.</span> Deposit that difference into the fund now (or set aside more) to pay on time.`);
            else msgs.push('<span class="text-emerald-700 font-semibold"><i class="fa-solid fa-circle-check"></i> There\'s enough to pay each bill on time.</span>');
            fundHTML = `<div class="panel ${plan.firstShort || low ? 'tone-amber' : 'tone-emerald'} text-xs space-y-1.5">${msgs.map(m => `<p>${m}</p>`).join('')}</div>`;
        }
        UI.html('annual-summary', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${head}<div class="sm:col-span-2">${fundHTML}</div></div>`);

        // The next 12 months that have bills: what's due, and what's left in the fund after.
        const t = ctx.today;
        const thisKey = `${t.getFullYear()}-${String(t.getMonth() + 1).padStart(2, '0')}`;
        const rows = plan.rows.filter(r => r.bills.length);
        UI.html('annual-timeline', rows.length ? `<div class="section-label mt-4"><i class="fa-solid fa-calendar-days text-blue-600"></i> Next 12 months</div>
            <div class="annual-steps">${rows.map(r => `<div class="annual-step ${r.short ? 'short' : ''}">
                <div class="annual-when">${esc(monthLabel(r.year, r.month))}</div>
                <div class="annual-what">${r.bills.map(b => `<div class="flex items-center justify-between gap-2"><span class="truncate" data-i18n-skip>${esc(b.name)}</span><span class="flex items-center gap-2 shrink-0"><strong>${money0(b.amount)}</strong>${g && r.key === thisKey ? `<button type="button" class="mini-btn" data-action="annual.pay" data-id="${b.id}">Pay</button>` : ''}</span></div>`).join('')}</div>
                <div class="annual-after ${r.short ? 'text-red-700' : 'text-slate-500'}">${r.short ? '<i class="fa-solid fa-triangle-exclamation"></i> ' : ''}<span>${money0(r.fund)} left in the fund</span></div>
            </div>`).join('')}</div>` : '');
    }

    UI.register({
        'annual.set': (el) => {
            const b = bills().find(x => x.id === Number(el.dataset.id));
            if (!b) return;
            const f = el.dataset.field;
            b[f] = f === 'name' || f === 'category' ? el.value : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        },
        'annual.add': () => {
            const list = bills();
            const id = Store.nextId(list);
            list.push({ id, name: tr('New annual bill'), amount: 0, every: 12, month: new Date().getMonth() + 2 > 12 ? 1 : new Date().getMonth() + 2, category: 'Otros' });
            App.changed({ structural: true, step: true });
            const input = document.querySelector(`#annual-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'annual.idea': (el) => {
            const x = ideas()[Number(el.dataset.i)];
            if (!x) return;
            const list = bills();
            const tax = Store.state.taxonomy.expense;
            list.push(Object.assign({ id: Store.nextId(list) }, x, { category: tax[x.category] ? x.category : 'Otros' }));
            App.changed({ structural: true, step: true });
        },
        'annual.delete': (el) => {
            const id = Number(el.dataset.id);
            const b = bills().find(x => x.id === id);
            App.undoable(`"${b ? b.name : ''}" removed from your annual bills`, () => { Store.state.annualBills = bills().filter(x => x.id !== id); });
        },
        // Create the savings goal that holds the money, or bring its monthly amount up to what's needed.
        'annual.fund': () => {
            const list = bills();
            const need = Engine.annualSetAside(list);
            const plan = Engine.annualBillsPlan(list, { today: new Date() });
            let g = fund();
            const created = !g;
            App.undoable(created ? `«${tr('Annual bills')}» fund created: ${money(need)} a month in your budget` : `Set-aside adjusted to ${money(need)} a month`, () => {
                const goals = Store.state.goals;
                if (!g) { g = { id: Store.nextId(goals), name: tr('Annual bills'), target: plan.yearly, current: 0, monthly: need, rate: 0, createdYear: new Date().getFullYear(), annualFund: true }; goals.push(g); }
                else { g.monthly = need; g.target = Math.max(Number(g.target) || 0, plan.yearly); }
            });
        },
        'annual.pay': (el) => {
            const b = bills().find(x => x.id === Number(el.dataset.id));
            const g = fund();
            if (!b || !g) return;
            UI.run('goal.spend', { id: String(g.id), amount: String(b.amount), desc: b.name, cat: b.category, sub: b.sub || '' });
        }
    });

    window.AnnualBills = { render, update };
})();
