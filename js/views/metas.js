/* Deudas y Metas: Baby Steps progress, emergency fund, debt payoff plan and savings goals. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    // On phones these tables show as one card per row (css: .table-cards); data-label names each field.
    function debtRow(d) {
        return `<tr data-row="${d.id}">
            <td class="c-wide" data-label="Deuda"><input class="cell-input" value="${esc(d.name)}" data-change="debt.set" data-id="${d.id}" data-field="name" aria-label="Debt name"></td>
            <td data-label="Type"><select class="cell-input" data-change="debt.set" data-id="${d.id}" data-field="kind" aria-label="Type">${Views.selectOptions(Engine.DEBT_KINDS.map(k => ({ value: k.id, label: k.label })), d.kind)}</select></td>
            <td data-label="Balance"><input type="number" class="cell-input num" min="0" step="50" value="${Number(d.balance) || 0}" data-input="debt.set" data-id="${d.id}" data-field="balance" aria-label="Balance"></td>
            <td data-label="Rate (%)"><input type="number" class="cell-input num" min="0" step="0.1" value="${Number(d.rate) || 0}" data-input="debt.set" data-id="${d.id}" data-field="rate" aria-label="Rate"></td>
            <td data-label="Minimum payment"><input type="number" class="cell-input num" min="0" step="5" value="${Number(d.minPayment) || 0}" data-input="debt.set" data-id="${d.id}" data-field="minPayment" aria-label="Minimum payment"></td>
            <td data-label="Budget per month"><input type="number" class="cell-input num money" min="0" step="10" value="${Number(d.monthly) || 0}" data-input="debt.set" data-id="${d.id}" data-field="monthly" aria-label="Amount in your budget" title="What your budget pays it each month"></td>
            <td class="text-center" data-label="Order" data-cell="order"></td>
            <td class="text-center whitespace-nowrap font-bold text-slate-700" data-label="Paid off in" data-cell="payoff"></td>
            <td class="c-wide c-actions text-center whitespace-nowrap">${Number(d.balance) > 0 ? `<button class="mini-btn" data-action="debt.pay" data-id="${d.id}" title="Log a payment: lowers the balance and is saved in Transactions">Pay</button> <button class="mini-btn" data-action="debt.schedule" data-id="${d.id}" title="Month by month: payment, interest, principal and balance">Schedule</button> ` : ''}<button class="row-del" data-action="debt.delete" data-id="${d.id}" title="Delete debt"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function goalRow(g) {
        const cell = (field, step, label, cls = '') => `<td data-label="${label}"><input type="number" class="cell-input num ${cls}" min="0" step="${step}" value="${Number(g[field]) || 0}" data-input="goal.set" data-id="${g.id}" data-field="${field}" aria-label="${label}"></td>`;
        return `<tr data-row="${g.id}">
            <td class="c-wide" data-label="Goal"><input class="cell-input" value="${esc(g.name)}" data-change="goal.set" data-id="${g.id}" data-field="name" aria-label="Goal name"></td>
            ${cell('target', 100, 'Target')}${cell('current', 100, 'Saved')}${cell('monthly', 10, 'Budget per month', 'money')}${cell('rate', 0.1, Store.COUNTRY === 'US' ? 'Rate (%)' : 'Savings rate (APY %)')}
            <td data-label="By when?"><input type="month" class="cell-input" value="${esc(g.targetDate || '')}" data-change="goal.set" data-id="${g.id}" data-field="targetDate" aria-label="Target date"></td>
            <td class="c-wide" data-label="Progress" data-cell="time"></td>
            <td class="c-wide c-actions text-center whitespace-nowrap"><button class="mini-btn" data-action="goal.deposit" data-id="${g.id}" title="Add a deposit to what's saved">Deposit</button> ${Number(g.current) > 0 ? `<button class="mini-btn" data-action="goal.spend" data-id="${g.id}" title="Pay for a purchase with this saved money (it doesn't count in this month's budget again)">Use</button> ` : ''}<button class="row-del" data-action="goal.delete" data-id="${g.id}" title="Delete goal"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    // Goal cards: progress, status (with an icon and a word), when it's ready, a monthly-amount
    // slider that moves that date, the savings account it's linked to, and what went in lately.
    const GOAL_STATE = { reached: ['fa-circle-check', 'Reached', 'badge-ok'], 'on-track': ['fa-circle-check', 'On track', 'badge-ok'], behind: ['fa-triangle-exclamation', 'Behind', 'badge-bad'], 'no-date': ['fa-calendar', 'No date', 'badge-muted'], never: ['fa-circle-pause', 'Not funded', 'badge-bad'] };
    function goalCard(g) {
        const accts = (Store.state.accounts || []).filter(a => a.kind === 'ahorros' || a.kind === 'retiro');
        return `<div class="goal-card" data-goal="${g.id}">
            <div class="flex items-start justify-between gap-2"><strong class="truncate" data-i18n-skip>${esc(g.name)}</strong><span data-g="state"></span></div>
            <div class="progress-track mt-2"><div class="progress-fill" data-g="bar"></div></div>
            <div class="flex justify-between text-xs mt-1"><span data-g="saved"></span><span class="font-bold" data-g="pct"></span></div>
            <p class="text-sm mt-2" data-g="eta"></p>
            <label class="flex justify-between items-center gap-2 text-xs font-bold mt-2"><span>Each month</span>
                <input type="number" class="cell-input num goal-monthly" min="0" step="any" inputmode="decimal" data-g="monthly" data-change="goal.typeMonthly" data-id="${g.id}" aria-label="Each month for ${esc(g.name)} (type it)"></label>
            <input type="range" class="range-slider" min="0" step="5" data-input="goal.slide" data-id="${g.id}" aria-label="Each month for ${esc(g.name)}">
            <div class="flex justify-between text-[10px] text-slate-400"><span>$0</span><span data-g="cap"></span></div>
            <div class="flex items-center justify-between gap-2 mt-2 text-xs"><span class="text-slate-500">Saved per month (6 mo.)</span><span class="flex items-center gap-2 whitespace-nowrap" data-g="velocity"></span></div>
            ${accts.length ? `<label class="flex items-center gap-2 mt-2 text-xs"><span class="text-slate-500 whitespace-nowrap">Linked account</span><select class="cell-input" data-change="goal.link" data-id="${g.id}">${Views.selectOptions([{ value: '', label: 'None (type what\'s saved)' }].concat(accts.map(a => ({ value: String(a.id), label: a.name }))), g.accountId ? String(g.accountId) : '')}</select></label>` : ''}
        </div>`;
    }
    function goalCards(ctx) {
        const pal = UI.palette();
        (ctx.state.goals || []).forEach(g => {
            const card = document.querySelector(`#goal-cards [data-goal="${g.id}"]`);
            if (!card) return;
            const st = Engine.goalStatus(g, ctx.today), def = GOAL_STATE[st.state];
            const q = (k) => card.querySelector(`[data-g="${k}"]`);
            q('state').innerHTML = `<span class="badge ${def[2]}"><i class="fa-solid ${def[0]}"></i> ${I18n.t(def[1])}</span>`;
            q('bar').style.width = (st.pct * 100).toFixed(1) + '%';
            q('saved').textContent = `${money0(g.current)} / ${money0(g.target)}`;
            q('pct').textContent = Math.round(st.pct * 100) + '%';
            const when = (m) => Fmt.monthYear(Engine.addMonths(ctx.today, m));
            q('eta').innerHTML = st.state === 'reached' ? 'Goal reached!'
                : st.state === 'never' ? (st.required ? `Put ${money0(st.required)} a month in to reach it by ${esc(Fmt.monthYear(new Date(g.targetDate + '-01T00:00:00')))}.` : 'Nothing goes in each month yet: slide to set an amount.')
                : `Ready in <strong>${esc(when(st.months))}</strong>${st.state === 'behind' ? ` · needs ${money0(st.required)} a month for ${esc(Fmt.monthYear(new Date(g.targetDate + '-01T00:00:00')))}` : ''}.`;
            const box = q('monthly');
            if (box !== document.activeElement) box.value = Math.round((Number(g.monthly) || 0) * 100) / 100;
            const slider = card.querySelector('[data-input="goal.slide"]');
            // The slider goes up to your monthly income (what's possible at most), not ever higher
            // as you drag; more than that can still be typed in the box.
            const income = ctx.monthBudget ? Number(ctx.monthBudget.income) || 0 : 0;
            const cap = Math.max(100, Math.ceil((income > 0 ? income : 2000) / 50) * 50);
            const max = Math.max(cap, Math.ceil((Number(g.monthly) || 0) / 50) * 50);
            q('cap').textContent = income > 0 ? `${money0(cap)} · ${I18n.t('your monthly income')}` : money0(cap);
            if (slider !== document.activeElement) { slider.max = max; slider.value = Number(g.monthly) || 0; }
            const v = Engine.goalVelocity(ctx.state.transactions, g.id, { end: ctx.today, months: 6 });
            q('velocity').innerHTML = `${UI.sparkline(v.values, { width: 72, height: 18, color: pal.series[2], label: `Saved per month: ${v.values.map(money0).join(', ')}` })} <strong>${money0(v.average)}</strong>`;
        });
    }

    // A goal linked to an account: money put in or taken out moves the account's balance too
    // (what's saved follows that balance).
    function linkedMove(g, amount) {
        const a = g.accountId && (Store.state.accounts || []).find(x => x.id === g.accountId);
        if (a) { a.balance = Math.round(((Number(a.balance) || 0) + amount) * 100) / 100; a.updatedAt = Engine.isoDate(new Date()); }
    }

    function render(ctx) {
        const s = ctx.state;
        UI.html('debt-body', s.debts.length ? s.debts.map(debtRow).join('') : '<tr class="empty-row"><td colspan="9">No debts entered! If you have any, add it to build your plan.</td></tr>');
        UI.html('goal-body', s.goals.length ? s.goals.map(goalRow).join('') : '<tr class="empty-row"><td colspan="8">Add a goal: a car, land, college…</td></tr>');
        UI.html('goal-cards', s.goals.map(goalCard).join(''));
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
        const labels = Array.from({ length: years + 1 }, (_, i) => `${ageNow + i} years`);
        const yearly = labels.map((_, i) => path[Math.min(i * 12, path.length - 1)]);
        const milestones = labels.map(() => null);
        if (debtMonths) milestones[Math.min(years, Math.round(debtMonths / 12))] = yearly[Math.min(years, Math.round(debtMonths / 12))];
        milestones[years] = yearly[years];
        UI.chart('road-chart', {
            type: 'line',
            data: { labels, datasets: [
                { label: 'Projected net worth', data: yearly, borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.12)', borderWidth: 2, pointRadius: 0, fill: true, cubicInterpolationMode: 'monotone' },
                { label: 'Milestones', data: milestones, borderColor: '#2a78d6', backgroundColor: '#2a78d6', pointStyle: 'rectRot', pointRadius: 7, pointHoverRadius: 9, showLine: false }
            ] },
            options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: false } } }
        });
        const freeDate = plan.totalBalance <= 0 ? 'Now!' : plan.never ? 'Never (with this budget)' : Fmt.monthYear(Engine.addMonths(ctx.today, plan.months));
        UI.html('road-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Net worth today</span><span class="kpi-value">${money0(ctx.netWorth.value)}</span><span class="kpi-note"><a href="#" class="link" data-goto="patrimonio">See details</a></span></div>
            <div class="kpi ${plan.totalBalance <= 0 ? 'tone-emerald' : plan.never ? 'tone-red' : 'tone-blue'}"><span class="kpi-label">🎯 Debt-free</span><span class="kpi-value">${freeDate}</span><span class="kpi-note">${plan.totalBalance > 0 ? `${money0(plan.totalBalance)} left` : 'No consumer debt'}</span></div>
            <div class="kpi tone-emerald"><span class="kpi-label">🏖️ Projected at ${ageEnd}</span><span class="kpi-value">${money0(yearly[years])}</span><span class="kpi-note">Estimate</span></div>`);
        UI.text('road-note', `Estimate in today's dollars (${ri.inflacion}% inflation a year): your net worth today; your investments (${money0(invested)}) and what you save each month in your budget (${money0(ctx.retirementMonthly + efMonthly)}) grow ${ri.tasaRetorno}% a year (your home and other assets stay the same); your debt payments lower what you owe, and once they're paid off that money (${money0(plan.pool)}/month) goes to savings. Change your age, return and inflation in Retirement.`);
        // The next concrete action, by step.
        const st = ctx.steps.current, ef = ctx.ef;
        const paidAll = s.debts.reduce((t, d) => t + Math.max(0, Math.max(Number(d.originalBalance) || 0, Number(d.balance) || 0) - (Number(d.balance) || 0)), 0);
        const next = st === 1 ? `<strong>Step 1:</strong> save ${money0(Math.max(0, 1000 - ef.liquid))} more to reach $1,000 in your starter emergency fund.`
            : st === 2 ? (plan.never || plan.shortfall > 0 ? `<strong>Step 2:</strong> your budget isn't enough to get out of debt. Assign more money to your debts in the budget.`
                : `<strong>Step 2:</strong> sends <strong>${money0(plan.pool)}/mo</strong> to your debts (minimums ${money0(plan.totalMin)}${plan.extra > 0 ? ` + ${money0(plan.extra)} extra` : ''}) and you're free in <strong>${freeDate}</strong>.${paidAll > 0 ? ` You've paid ${money0(paidAll)}. Keep going!` : ''}`)
            : st === 3 ? `<strong>Step 3:</strong> you have ${ef.monthsCovered.toFixed(1)} of 3–6 months of expenses (${money0(ef.monthlyEssential)}/mo). You need ${money0(Math.max(0, ef.monthlyEssential * 3 - ef.liquid))} more for 3 months.`
            : st === 4 ? `<strong>Steps 4–6:</strong> you save ${(ctx.savingsRate * 100).toFixed(0)}% of your salary (goal 15%); then your kids' education and extra mortgage payments.`
            : '<strong>Step 7:</strong> keep investing and give generously.';
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
                    { label: 'Paying its minimum', data: minPart, backgroundColor: pal.seq[0], borderRadius: (c) => (snowPart[c.dataIndex] ? 0 : rightEnd), borderSkipped: false, barThickness: 18, grouped: false },
                    { label: 'With the snowball', data: snowPart, backgroundColor: pal.blue, borderColor: pal.surface, borderWidth: { left: 2, right: 0, top: 0, bottom: 0 }, borderRadius: rightEnd, borderSkipped: false, barThickness: 18, grouped: false }
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
                    endLabels: { labels: rows.map(r => (r.payoffMonth ? when(r.payoffMonth) : 'Never')), dataset: rows.map((r, i) => (snowPart[i] ? 1 : 0)) }
                }
            }
        });
        const first = rows.find(r => r.payoffMonth);
        UI.text('debt-ladder-note', `${({ avalanche: 'Avalanche', fastest: 'Fastest payoff first', 'highest-balance': 'Highest balance first' })[s.debtPlan.strategy] || 'Snowball'}: each bar runs from today to the month that debt is paid off. The light part is while it gets only its minimum; the dark part, once the snowball reaches it.${first ? ` The first to go: ${first.debt.name}, in ${when(first.payoffMonth)}.` : ''}`);

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
                    { label: plan.never ? 'Your plan (never paid off)' : `Your plan (debt-free in ${when(plan.months)})`, data: planLine.slice(0, len), borderColor: pal.blue, backgroundColor: pal.alpha(pal.blue, 0.1), borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: true, tension: 0 },
                    { label: freeMin ? `Minimums only (debt-free in ${when(freeMin)})` : 'Minimums only (never paid off)', data: minLine.slice(0, len), borderColor: pal.muted, borderDash: [6, 4], borderWidth: 2, pointRadius: 0, pointHoverRadius: 4, fill: false, tension: 0 }
                ]
            },
            options: { scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } } }, plugins: { legend: { position: 'top', align: 'start' } } }
        });
        UI.text('debt-owed-note', plan.minimumsNever || minLine.length > CAP
            ? 'Paying only the minimums, your debts aren\'t gone in 30 years: interest eats the payment.'
            : plan.monthsSaved > 0 ? `With your plan you finish ${Fmt.monthsAsYears(plan.monthsSaved)} sooner and pay ${money0(plan.interestSaved)} less interest than with minimums only.` : '');

        // Each debt's balance, stacked, in the payoff order (the first to go at the bottom).
        const MAXS = 7, ordered = rows.slice().sort((a, b) => (a.order || 99) - (b.order || 99));
        const keep = ordered.length > MAXS ? ordered.slice(0, MAXS - 1) : ordered, rest = ordered.slice(keep.length);
        const n = Math.min(CAP, planLine.length);
        const lineOf = (id) => [Number((s.debts.find(d => d.id === id) || {}).balance) || 0].concat(plan.byDebt && plan.byDebt[id] || []).slice(0, n);
        const series = keep.map(r => ({ label: short(r.debt.name), data: lineOf(r.id) }));
        if (rest.length) series.push({ label: 'Other debts', data: Array.from({ length: n }, (_, i) => rest.reduce((t, r) => t + (lineOf(r.id)[i] || 0), 0)), other: true });
        UI.chart('debt-stack-chart', {
            type: 'line',
            data: { labels: labels.slice(0, n), datasets: series.map((x, i) => { const c = x.other ? pal.muted : pal.series[i % pal.series.length]; return { label: x.label, data: x.data.map(v => Math.round(v)), stack: 'debts', fill: i === 0 ? 'origin' : '-1', backgroundColor: pal.alpha(c, 0.75), borderColor: c, borderWidth: 1, pointRadius: 0, pointHoverRadius: 4, tension: 0 }; }) },
            options: { scales: { x: { ticks: { maxTicksLimit: 6, maxRotation: 0 } }, y: { stacked: true } }, plugins: { legend: { position: 'top', align: 'start' } } }
        });

        UI.html('debt-ladder-table', rows.map(r => `<tr><td class="font-semibold" data-i18n-skip>${esc(r.debt.name)}</td><td class="num">${money0(r.debt.balance)}</td>
            <td class="num">${Number(r.debt.rate) || 0}%</td><td class="num">${money0(r.debt.monthly === undefined || r.debt.monthly === null ? r.debt.minPayment : r.debt.monthly)}</td>
            <td>${r.attackMonth ? (r.attackMonth <= 1 ? 'From today' : when(r.attackMonth - 1)) : '—'}</td>
            <td>${r.payoffMonth ? `${when(r.payoffMonth)} (mes ${r.payoffMonth})` : 'Never'}</td></tr>`).join(''));
        const marks = [];
        for (let m = 0; m < len; m += 12) marks.push(m);
        if (marks[marks.length - 1] !== len - 1) marks.push(len - 1);
        const cell = (line, m) => (m < line.length ? money0(line[m]) : money0(0));
        UI.html('debt-owed-table', marks.map(m => `<tr><td>${when(m)}</td><td class="num">${cell(planLine, m)}</td><td class="num">${cell(minLine, m)}</td></tr>`).join(''));
    }

    // "What if I add $X a month?": the plan again with that much more, and how much sooner and
    // cheaper it ends; "Add it to my budget" puts it in the extra debt line.
    function debtWhatIf(ctx) {
        const box = document.getElementById('debt-whatif');
        if (!box) return;
        const s = ctx.state, open = (s.debts || []).some(d => Number(d.balance) > 0);
        UI.show(box, open);
        if (!open) return;
        const x = Math.max(0, Number(Store.ui.debtExtraTry) || 0), slider = document.getElementById('debt-extra');
        if (slider && slider !== document.activeElement) slider.value = x;
        UI.text('debt-extra-val', money0(x));
        UI.show('debt-extra-apply', x > 0);
        const base = ctx.debts;
        if (!(x > 0)) { UI.html('debt-extra-result', base.never ? 'With your plan the debts are never paid off: try some extra.' : `Debt-free in ${esc(Fmt.monthYear(Engine.addMonths(ctx.today, base.months)))}. Slide to see what an extra amount each month does.`); return; }
        const more = Engine.debtPayoff(s.debts, s.debtPlan.strategy, (Number(ctx.debtExtraRubros) || 0) + x);
        const sooner = base.never ? null : base.months - more.months, saved = base.totalInterest - more.totalInterest;
        UI.html('debt-extra-result', more.never ? 'Still not enough to pay them off.'
            : `<strong>Debt-free in ${esc(Fmt.monthYear(Engine.addMonths(ctx.today, more.months)))}</strong>${sooner ? ` · ${Fmt.monthsAsYears(sooner)} sooner` : ''}${saved > 0.5 ? ` · ${money0(saved)} less interest` : ''}.`);
    }

    // A debt's schedule under the plan: month, payment, interest, principal, balance.
    function openSchedule(id) {
        const ctx = App.buildContext(), d = (ctx.state.debts || []).find(x => x.id === id), rows = ((ctx.debts.schedule || {})[id] || []).slice(0, 360);
        if (!d) return;
        let last = rows.findIndex(r => r.balance <= 0.005);
        const shown = last >= 0 ? rows.slice(0, last + 1) : rows;
        const interest = shown.reduce((t, r) => t + r.interest, 0);
        UI.sheet({ title: d.name, icon: 'fa-table-list', wide: true, html: `
            <p class="text-sm mb-2">${last >= 0 ? `Paid off in ${esc(Fmt.monthYear(Engine.addMonths(ctx.today, last + 1)))} (${last + 1} payment${last === 0 ? '' : 's'}), ${money(interest)} of interest.` : 'Not paid off within 30 years with this plan.'}</p>
            <div class="table-wrap"><table class="table"><thead><tr><th>Month</th><th class="num">Payment</th><th class="num hidden sm:table-cell">Interest</th><th class="num hidden sm:table-cell">Principal</th><th class="num">Balance</th></tr></thead><tbody>
            ${shown.map((r, i) => `<tr><td class="whitespace-nowrap">${esc(Fmt.monthYear(Engine.addMonths(ctx.today, i + 1)))}</td><td class="num">${money(r.payment)}<span class="block text-[11px] text-slate-500 sm:hidden">${esc(I18n.t('Interest'))} ${money(r.interest)}</span></td><td class="num text-slate-500 hidden sm:table-cell">${money(r.interest)}</td><td class="num hidden sm:table-cell">${money(Math.max(0, r.payment - r.interest))}</td><td class="num font-semibold">${money(r.balance)}</td></tr>`).join('')}
            </tbody></table></div>` });
    }

    function update(ctx) {
        if (window.Runway) Runway.update(ctx);
        if (window.College) College.update(ctx);
        const s = ctx.state;
        UI.html('metas-steps', Views.stepsHTML(ctx));
        roadmap(ctx);
        debtLadder(ctx);
        debtWhatIf(ctx);
        goalCards(ctx);
        if (window.GoalMap) GoalMap.render(ctx);

        // Emergency fund
        const ef = ctx.ef;
        UI.text('ef-liquid', money0(ef.liquid));
        UI.text('ef-essential', `Essential expenses: ${money0(ef.monthlyEssential)}/mo`);
        UI.text('ef-step1-label', `${money0(Math.min(ef.liquid, 1000))} / $1,000`);
        document.getElementById('ef-step1-bar').style.width = ef.step1Pct.toFixed(0) + '%';
        UI.text('ef-step3-label', `${ef.monthsCovered.toFixed(1)} months`);
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
            row.querySelector('[data-cell="payoff"]').innerHTML = (info && info.payoffMonth ? `Month ${info.payoffMonth} · ${Fmt.monthYear(Engine.addMonths(ctx.today, info.payoffMonth))}` : (Number(d.balance) > 0 ? 'Never' : '—'))
                + (under ? '<span class="block"><span class="badge badge-bad">Below the minimum</span></span>' : '')
                + (orig > 0 ? `<span class="block text-[11px] font-semibold text-slate-500 mt-1">Pagado ${money0(paid)} (${Math.round(paidPct * 100)}%)</span><div class="mini-bar"><span style="width:${(paidPct * 100).toFixed(1)}%;background:#059669"></span></div>` : '');
        });
        UI.text('debt-total', money0(plan.totalBalance));
        UI.text('debt-interest', money0(plan.totalInterest));
        UI.text('debt-saved', plan.minimumsNever ? 'Minimums only: never' : `${money0(plan.interestSaved)} · ${plan.monthsSaved} months`);
        UI.text('debt-free-date', plan.totalBalance <= 0 ? 'Debt-free!'
            : plan.never ? 'Never with this budget'
            : `${Fmt.monthYear(Engine.addMonths(ctx.today, plan.months))} (${plan.months}m)`);

        // Where the money comes from, and whether the budget can actually pay it.
        UI.text('debt-pool', `${money0(plan.pool)}/mo`);
        UI.html('debt-pool-note', `Minimums ${money0(plan.totalMin)}${plan.extra > 0 ? ` · ${money0(plan.extra)} extra to the snowball` : ''}${ctx.debtExtraRubros > 0 ? ` (includes ${money0(ctx.debtExtraRubros)} from other debt lines)` : ''} · <a href="#" class="link" data-goto="presupuesto/plan">see budget</a>`);
        document.getElementById('debt-funding').className = `kpi ${plan.totalBalance <= 0 ? 'tone-slate' : plan.shortfall > 0 ? 'tone-red' : 'tone-emerald'}`;
        const warn = document.getElementById('debt-warning');
        const deficit = -ctx.baseBudget.balanceReal;
        let msg = '';
        if (plan.totalBalance > 0 && plan.shortfall > 0) {
            const names = plan.underfunded.map(u => { const d = s.debts.find(x => x.id === u.id); return `<strong>${esc(d.name)}</strong> (you assign ${money0(d.monthly)}, the minimum is ${money0(d.minPayment)})`; }).join(', ');
            msg = `<strong>Your budget doesn't cover the minimum payment of:</strong> ${names}. Without the minimum you're charged late fees and the debt grows. Raise its amount in "In your budget" and cut other lines so it fits.`;
        } else if (plan.totalBalance > 0 && deficit > 0.005) {
            msg = `<strong>This plan isn't funded yet:</strong> your budget spends ${money0(deficit)} a month more than you earn. Cut lines in your <a href="#" class="link" data-goto="presupuesto/plan">budget</a> until the balance is $0 so these dates are real.`;
        }
        warn.className = `panel mb-4 text-xs ${msg ? 'tone-red text-red-900' : 'hidden'}`;
        warn.innerHTML = msg ? `<i class="fa-solid fa-triangle-exclamation text-red-600"></i> ${msg}` : '';

        // Goals
        const unfunded = s.goals.filter(g => Engine.goalMonths(g).status === 'never');
        UI.show('goal-warning', unfunded.length > 0);
        if (unfunded.length) UI.html('goal-warning', `<i class="fa-solid fa-circle-info"></i> ${unfunded.map(g => `<strong>${esc(g.name)}</strong>`).join(', ')} ${unfunded.length > 1 ? 'have' : 'has'} no money assigned in your budget. ${ctx.steps.current <= 2 ? 'While you\'re on Steps 1–2 that\'s normal: emergency fund and debts come first.' : 'Give it a monthly amount so it moves forward.'}`);
        s.goals.forEach(g => {
            const cell = document.querySelector(`#goal-body tr[data-row="${g.id}"] [data-cell="time"]`);
            if (!cell) return;
            const r = Engine.goalMonths(g);
            const sch = Engine.goalSchedule(g, ctx.today);
            const pct = Number(g.target) > 0 ? Math.min(1, (Number(g.current) || 0) / Number(g.target)) : 0;
            const eta = r.status === 'reached' ? '<span class="badge badge-ok">Goal reached!</span>'
                : r.status === 'never' ? '<span class="badge badge-bad">No contribution in your budget</span>'
                : `<span class="badge badge-purple">Ready in ${Fmt.monthYear(Engine.addMonths(ctx.today, r.months))}</span>`;
            const track = !sch || r.status === 'reached' ? ''
                : sch.onTrack ? '<span class="badge badge-ok">On track</span>'
                : `<span class="badge badge-bad" title="To get there on time">Behind: you need ${Fmt.money0(sch.required)}/mo</span>`;
            cell.innerHTML = `<div class="flex justify-between text-[11px] text-slate-500"><span>${Fmt.money0(g.current)} of ${Fmt.money0(g.target)}</span><strong>${Math.round(pct * 100)}%</strong></div>
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
        'debt.extraTry': (el) => { Store.ui.debtExtraTry = Math.max(0, Fmt.parseNum(el.value, 0)); debtWhatIf(App.buildContext()); },
        'debt.schedule': (el) => openSchedule(Number(el.dataset.id)),
        'debt.extraApply': () => {
            const x = Math.max(0, Number(Store.ui.debtExtraTry) || 0);
            if (!(x > 0)) return;
            const yd = Store.active();
            App.undoable(`${money0(x)} more a month for your debts, in the budget`, () => {
                const line = (yd.budgetBase || []).find(i => i.type === 'Deuda' && !i.link);
                if (line) {
                    if (Math.abs((Number(line.prep) || 0) - (Number(line.real) || 0)) < 0.005) line.prep = (Number(line.prep) || 0) + x;
                    line.real = (Number(line.real) || 0) + x;
                } else yd.budgetBase.push({ id: Store.nextId(yd.budgetBase), name: I18n.t('Debt snowball (extra)'), type: 'Deuda', isDeductible: false, prep: x, real: x, linkedCategory: 'Deudas' });
                Store.ui.debtExtraTry = 0;
            });
        },
        'debt.add': () => {
            const debts = Store.state.debts;
            const id = Store.nextId(debts);
            debts.push({ id, name: 'Nueva deuda', kind: 'personal', balance: 1000, originalBalance: 1000, rate: 15, minPayment: 50, monthly: 50, createdYear: new Date().getFullYear() });
            App.changed({ structural: true });
            UI.toast('Debt added to your budget with its minimum payment ($50). Adjust the amounts.');
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
                title: `Payment to "${d.name}"`,
                message: `Balance: ${money(d.balance)}. The month's interest is paid first and the rest lowers the balance.`,
                fields: [
                    { name: 'amount', label: 'Amount paid', type: 'number', min: 0, step: '0.01', value: Number(el.dataset.amount) || Number(d.monthly) || Number(d.minPayment) || '' },
                    { name: 'interest', label: 'Of that, interest', type: 'number', min: 0, step: '0.01', value: est, help: `Estimate: balance × ${Number(d.rate) || 0}% ÷ 12. If your statement shows a different figure, type it.` },
                    { name: 'date', label: 'Date', type: 'date', value: Engine.isoDate(new Date()) },
                    { name: 'log', label: 'Also log it as a transaction?', options: [{ value: 'yes', label: 'Yes, in Transactions (counts in this debt\'s budget line)' }, { value: 'no', label: 'No, just lower the balance' }] }
                ],
                confirmText: 'Log payment',
                validate: v => !(v.amount > 0) ? 'Type an amount greater than 0.' : v.interest < 0 ? 'Interest can\'t be negative.' : !v.date ? 'Pick a date.' : null
            });
            if (!r) return;
            const amount = Math.round(r.amount * 100) / 100;
            const p = Engine.applyDebtPayment(d.balance, amount, r.interest || 0);
            App.undoable(p.balance <= 0 ? `🎉 You paid off "${d.name}"!` : `Payment logged: ${money(p.principal)} to the balance and ${money(p.interest)} interest. ${money(p.balance)} left.`, () => {
                d.balance = p.balance;
                d.payments = (d.payments || []).concat([{ date: r.date, amount, interest: p.interest, principal: p.principal, balance: p.balance }]).slice(-120);
                if (r.log === 'yes') {
                    const s = Store.state, tax = s.taxonomy.expense;
                    const cat = tax.Deudas ? 'Deudas' : 'Otros';
                    const kind = Engine.DEBT_KINDS.find(k => k.id === d.kind);
                    const sub = (tax[cat] || []).includes(kind && kind.label) ? kind.label : (tax[cat] || [])[0] || '';
                    s.transactions.push({ id: Store.nextId(s.transactions), type: 'Gasto', description: `Payment: ${d.name}`, store: d.lender || '', parentCategory: cat, category: sub, amount, date: r.date, paymentType: 'Transferencia', budgetLine: 'debt-' + d.id, debtId: d.id, createdAt: new Date().toISOString() });
                }
            });
            if (p.overpaid > 0) UI.toast(`You paid ${money(p.overpaid)} more than the balance: check whether you have a credit.`, 'warn');
        },
        'debt.delete': (el) => {
            const d = find(Store.state.debts, el);
            App.undoable(`Debt "${d.name}" deleted (and removed from your budget)`, () => { Store.state.debts = Store.state.debts.filter(x => x !== d); });
        },
        'goal.set': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const f = el.dataset.field;
            g[f] = f === 'name' || f === 'targetDate' ? el.value : Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'goal.typeMonthly': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            App.undoable(`${g.name}: ${money0(Math.max(0, parseNum(el.value, 0)))} a month`, () => { g.monthly = Math.max(0, Math.round(parseNum(el.value, 0) * 100) / 100); });
        },
        'goal.slide': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            g.monthly = Math.max(0, parseNum(el.value, 0));
            const twin = document.querySelector(`#goal-body tr[data-row="${g.id}"] [data-field="monthly"]`);
            if (twin) twin.value = g.monthly;
            App.changed();
        },
        'goal.link': (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            if (el.value) g.accountId = Number(el.value); else delete g.accountId;
            App.changed({ structural: true });
        },
        'goal.add': () => {
            const goals = Store.state.goals;
            const id = Store.nextId(goals);
            goals.push({ id, name: 'Nueva meta', target: 10000, current: 0, monthly: 0, rate: Number(Store.active().tasa) || 0, createdYear: new Date().getFullYear() });
            App.changed({ structural: true });
            UI.toast('Goal added to your budget\'s Savings. Give it a monthly amount.');
            const input = document.querySelector(`#goal-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        // A deposit adds to what's saved; optionally it's also logged as a transfer to savings.
        'goal.deposit': async (el) => {
            const g = find(Store.state.goals, el);
            if (!g) return;
            const r = await UI.form({
                title: `Deposit to "${g.name}"`,
                fields: [
                    { name: 'amount', label: 'Amount', type: 'number', min: 0, step: '0.01', value: Number(el.dataset.amount) || Number(g.monthly) || '' },
                    { name: 'log', label: 'Also log it as a transaction?', options: [{ value: 'yes', label: 'Yes, in Transactions (counts on its budget line)' }, { value: 'no', label: 'No, just add to savings' }] }
                ],
                confirmText: 'Deposit',
                validate: v => Number(v.amount) > 0 ? null : 'Type an amount greater than 0.'
            });
            if (!r) return;
            const amount = Math.round(Number(r.amount) * 100) / 100;
            g.current = Math.round(((Number(g.current) || 0) + amount) * 100) / 100;
            linkedMove(g, amount);
            if (r.log === 'yes') {
                const txns = Store.state.transactions;
                const tax = Store.state.taxonomy.expense;
                const cat = tax['Ahorro e Inversión'] ? 'Ahorro e Inversión' : 'Otros';
                txns.push({ id: Store.nextId(txns), type: 'Gasto', description: `Deposit: ${g.name}`, store: '', parentCategory: cat, category: (tax[cat] || [])[0] || '', amount, date: Engine.isoDate(new Date()), paymentType: 'Transferencia', budgetLine: 'goal-' + g.id });
            }
            App.changed({ structural: true, step: true });
            UI.toast(`${Fmt.money(amount)} deposited to "${g.name}". You have ${Fmt.money0(g.current)} of ${Fmt.money0(g.target)}.`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
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
                title: `Use the money in "${g.name}"`,
                message: `You have ${money(g.current)} saved here. The purchase goes into Transactions, but it doesn't count in this month's budget again: you already set it aside.`,
                fields: [
                    { name: 'amount', label: 'Amount', type: 'number', min: 0, step: '0.01', value: pre.amount || '' },
                    { name: 'desc', label: 'What did you pay for?', value: pre.desc || g.name },
                    { name: 'cat', label: 'Category', options: cats },
                    { name: 'date', label: 'Date', type: 'date', value: Engine.isoDate(new Date()) }
                ],
                confirmText: 'Log',
                validate: v => !(v.amount > 0) ? 'Type an amount greater than 0.' : !v.desc.trim() ? 'Type what you paid for.' : !v.date ? 'Pick a date.' : null
            });
            if (!r) return;
            const amount = Math.round(r.amount * 100) / 100;
            const covered = Math.min(amount, Math.max(0, Number(g.current) || 0));
            const rest = Math.round((amount - covered) * 100) / 100;
            const sub = pre.sub && (tax[r.cat] || []).includes(pre.sub) ? pre.sub : (tax[r.cat] || [])[0] || '';
            App.undoable(rest > 0 ? `${money(covered)} paid from «${g.name}»; the other ${money(rest)} count in this month's budget.` : `${money(amount)} paid from «${g.name}». ${money(Number(g.current) - covered)} left.`, () => {
                g.current = Math.round(((Number(g.current) || 0) - covered) * 100) / 100;
                linkedMove(g, -covered);
                const base = { type: 'Gasto', description: r.desc.trim(), store: '', parentCategory: r.cat, category: sub, date: r.date, paymentType: 'Tarjeta de Débito', createdAt: new Date().toISOString() };
                if (covered > 0) s.transactions.push(Object.assign({ id: Store.nextId(s.transactions), amount: covered, fromGoal: g.id }, base));
                if (rest > 0) s.transactions.push(Object.assign({ id: Store.nextId(s.transactions), amount: rest }, base));
            });
        },
        'goal.delete': (el) => {
            const g = find(Store.state.goals, el);
            App.undoable(`Goal "${g.name}" deleted (and removed from your budget)`, () => { Store.state.goals = Store.state.goals.filter(x => x !== g); });
        }
    });

    App.defineView('futuro/metas', { render, update });
})();
