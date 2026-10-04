/* Resumen: one-glance dashboard — your current Baby Step, key numbers and alerts. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    function hero(ctx) {
        const st = ctx.steps, ef = ctx.ef, debts = ctx.debts;
        const s = ctx.state;
        let title, text, cta, goto, focus;
        switch (st.current) {
            case 1:
                title = 'Step 1: Save your starter emergency fund';
                text = `Save $1,000 for emergencies before attacking your debts. Today you have ${money0(ef.liquid)} available.`;
                cta = 'See my emergency fund'; goto = 'futuro/metas'; focus = 'metas-ef'; break;
            case 2:
                title = 'Step 2: Get out of debt with the Snowball';
                text = debts.shortfall > 0
                    ? `You owe ${money0(debts.totalBalance)}, but your budget only assigns ${money0(debts.pool)}/mo to debt and the minimums add up to ${money0(debts.totalMin)}. Assign more money to your debts.`
                    : debts.never
                    ? `You owe ${money0(debts.totalBalance)} and with what your budget assigns you'd never finish. Assign more money to your debts.`
                    : `You owe ${money0(debts.totalBalance)}. Your budget sends them ${money0(debts.pool)}/mo${debts.extra > 0 ? ` (${money0(debts.extra)} extra to the snowball)` : ''}: you're debt-free in ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}.`;
                cta = 'Go to my debt plan'; goto = 'futuro/metas'; focus = 'metas-debts'; break;
            case 3:
                title = 'Step 3: Finish your emergency fund';
                text = `Save 3 to 6 months of essential expenses (${money0(ef.monthlyEssential)}/mo). You have ${ef.monthsCovered.toFixed(1)} months covered.`;
                cta = 'See my emergency fund'; goto = 'futuro/metas'; focus = 'metas-ef'; break;
            case 4:
                title = 'Steps 4–6: Invest, save for your kids and pay off your home';
                text = `You save ${(ctx.savingsRate * 100).toFixed(0)}% of your salary (goal: 15%). Estimated retirement income: ${money0(ctx.retirement.ingresoTotal)}/mo.`;
                cta = 'See my retirement'; goto = 'futuro/jubilacion'; break;
            default:
                title = 'Step 7: Build wealth and give generously';
                text = `Your net worth in ${s.activeYear} is ${money0(ctx.netWorth.value)}. Keep investing and helping others.`;
                cta = 'See my net worth'; goto = 'patrimonio';
        }
        return `<div class="flex flex-col md:flex-row md:items-center justify-between gap-4">
            <div><div class="hero-kicker">Your next step</div><div class="hero-title">${title}</div><p class="hero-text">${text}</p></div>
            <button type="button" class="btn btn-primary shrink-0" data-goto="${goto}" ${focus ? `data-focus="${focus}"` : ''}>${cta} <i class="fa-solid fa-arrow-right"></i></button>
        </div>`;
    }

    // ---------------------------------------------------------------- next moves
    // Everything Engine.nextMoves needs, as plain numbers from what the app already knows.
    function moveFacts(ctx) {
        const s = ctx.state, t = ctx.today, y = t.getFullYear(), m = String(t.getMonth() + 1);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, s.transactions, y, m);
        const bills = Engine.billsDue({ items, spend, year: y, month: m, today: t }).filter(b => b.status === 'overdue');
        // The plan's order, with today's balances (the plan's own balances are where they end).
        const debt = (ctx.debts.items || []).slice().sort((a, b) => (a.order || 99) - (b.order || 99))
            .map(i => s.debts.find(d => d.id === i.id)).find(d => d && Number(d.balance) > 0);
        const billLines = (Store.effective(y).budgetBase || []).filter(i => Number(i.dueDay) >= 1).map(i => i.id);
        const subs = Engine.findRepeating(s.transactions, { recurring: s.recurring, dismissed: s.settings.dismissedRepeats || [], today: t, billLines });
        const fund = (s.goals || []).find(g => g.annualFund);
        const annual = (s.annualBills || []).length ? Engine.annualBillsPlan(s.annualBills, { start: fund ? Number(fund.current) || 0 : 0, monthly: fund ? Number(fund.monthly) || 0 : 0, today: t }) : null;
        const last = s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt) : null;
        return {
            hasIncome: ctx.baseBudget.income > 0, hasData: s.transactions.length > 0 || (ctx.year.budgetBase || []).length > 0,
            step: ctx.steps.current, liquid: ctx.ef.liquid, monthsCovered: ctx.ef.monthsCovered, essential: ctx.ef.monthlyEssential,
            unassigned: ctx.baseBudget.balanceReal, income: ctx.baseBudget.income, savingsRate: ctx.savingsRate,
            uncategorized: spend.unassigned.length, overdueBills: bills.map(b => b.item.name),
            target: debt ? { name: debt.name, balance: Number(debt.balance) || 0, rate: Number(debt.rate) || 0 } : null,
            monthToClose: window.MonthClose ? MonthClose.pending(t) : null,
            extraPaycheck: extraPaycheck(ctx),
            subsYearly: subs.reduce((a, x) => a + x.yearly, 0),
            annualShort: annual && annual.firstShort ? { label: Fmt.monthYear(new Date(annual.firstShort.year, annual.firstShort.month - 1, 1)), needed: annual.needed, noFund: !fund, yearly: annual.yearly, monthly: Engine.annualSetAside(s.annualBills) } : null,
            maturing: (s.polizas || []).filter(p => { const st = Engine.maturityStatus(p.maturityDate, t); return st && st.kind === 'pronto'; }).map(p => p.number),
            backupDays: last ? Math.floor((t - last) / 86400000) : null,
            needsWill: !!(window.Checklists && !Checklists.progress().will && ((s.college && s.college.kids.length) || (s.members || []).length > 2)),
            reviewDue: !!(window.Checklists && t.getMonth() <= 1 && Checklists.progress().review < 0.5 && s.transactions.length > 0)
        };
    }
    // This month or next brings an extra paycheck (weekly / every-2-weeks pay).
    function extraPaycheck(ctx) {
        const t = ctx.today, plan = Engine.extraPaycheckMonths(Cash.paySchedule(), t.getFullYear());
        if (!plan) return null;
        const m = plan.months.find(x => x.month === t.getMonth() + 1 || x.month === t.getMonth() + 2);
        if (!m) return null;
        const yd = Store.effective(t.getFullYear()), pay = Engine.payroll(yd);
        return { label: Fmt.MONTH_NAMES[m.month - 1], amount: pay.netoM * 12 / plan.perYear * m.extra, onChecks: !!yd.budgetOnPaychecks };
    }
    // ---------------------------------------------------------------- health score
    const GOTO = { spendLess: ['transacciones/reportes'], onTime: ['resumen', 'dash-bills-card'], cushion: ['futuro/metas', 'metas-ef'], longTerm: ['futuro/jubilacion'], dti: ['futuro/metas', 'metas-debts'], costly: ['futuro/metas', 'metas-debts'], budget: ['presupuesto/plan'], retire: ['futuro/jubilacion'] };
    function healthFacts(ctx, overdue) {
        const s = ctx.state, t = ctx.today, inc = ctx.baseBudget.income;
        let i3 = 0, e3 = 0;
        for (let k = 1; k <= 3; k++) { const d = new Date(t.getFullYear(), t.getMonth() - k, 1); const cf = Engine.cashFlow(s.transactions, d.getFullYear(), d.getMonth() + 1); i3 += cf.income; e3 += cf.expense; }
        const consumer = (s.debts || []).filter(d => Number(d.balance) > 0);
        return {
            spendRatio: i3 > 0 ? e3 / i3 : null,
            overdue,
            monthsCovered: ctx.ef.monthlyEssential > 0 ? ctx.ef.monthsCovered : null,
            savingsRate: inc > 0 ? ctx.savingsRate : null,
            debtToIncome: inc > 0 ? consumer.reduce((a, d) => a + (Number(d.minPayment) || 0), 0) / inc : null,
            costlyDebtRatio: inc > 0 ? consumer.filter(d => Number(d.rate) >= 10).reduce((a, d) => a + Number(d.balance), 0) / (inc * 12) : null,
            unassignedRatio: inc > 0 ? ctx.baseBudget.balanceReal / inc : null,
            retirePct: inc > 0 && ctx.retirement.aniosRestantes > 0 ? Views.retireGap(ctx).g.pct : null
        };
    }
    function healthHTML(ctx, overdue) {
        const h = Engine.healthScore(healthFacts(ctx, overdue));
        if (h.score === null) return '';
        const BAND = { sano: ['Healthy', 'tone-emerald', '#10b981'], camino: ['Getting there', 'tone-amber', '#f59e0b'], vulnerable: ['Vulnerable', 'tone-red', '#ef4444'] }[h.band];
        const C = 2 * Math.PI * 34, dash = (h.score / 100) * C;
        const ring = `<svg viewBox="0 0 80 80" class="health-ring" role="img" aria-label="${h.score} out of 100"><circle cx="40" cy="40" r="34" class="health-track"/><circle cx="40" cy="40" r="34" fill="none" stroke="${BAND[2]}" stroke-width="8" stroke-linecap="round" stroke-dasharray="${dash.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 40 40)"/><text x="40" y="45" text-anchor="middle" class="health-num">${h.score}</text></svg>`;
        const pill = (p) => `<div class="health-pillar"><div class="flex justify-between text-xs"><span class="font-bold">${esc(p.label)}</span><span class="font-bold">${p.score === null ? '—' : p.score}</span></div><div class="progress-track mt-1"><div class="progress-fill" style="width:${p.score || 0}%;background:${p.score >= 80 ? '#10b981' : p.score >= 40 ? '#f59e0b' : '#ef4444'}"></div></div></div>`;
        const rows = h.pillars.flatMap(p => p.items).map(i => { const [g, f] = GOTO[i.key]; return `<li class="flex items-center justify-between gap-3"><span class="min-w-0"><span class="font-semibold">${esc(i.label)}</span><span class="block text-[11px] text-slate-500">${esc(i.note)}</span></span><a href="#" class="link whitespace-nowrap font-bold" data-goto="${g}" ${f ? `data-focus="${f}"` : ''}>${i.score}</a></li>`; }).join('');
        return `<div class="flex flex-col sm:flex-row gap-5 items-center">
                <div class="text-center shrink-0">${ring}<span class="badge ${BAND[1]} mt-1">${BAND[0]}</span></div>
                <div class="grid grid-cols-2 gap-3 flex-1 w-full">${h.pillars.map(pill).join('')}</div>
            </div>
            ${h.weakest && h.weakest.score < 80 ? `<p class="text-xs mt-3"><i class="fa-solid fa-arrow-trend-up text-emerald-600"></i> Where you can gain the most: <strong>${esc(h.weakest.label)}</strong> (${h.weakest.score}/100).</p>` : ''}
            <details class="mt-2"><summary class="text-xs font-bold text-slate-600 cursor-pointer">How it's calculated</summary><ul class="space-y-2 text-xs mt-2">${rows}</ul>
            <p class="help mt-2">Eight indicators from 0 to 100 in four pillars (inspired by the FinHealth Score). 80 or more: healthy; 40 to 79: getting there; under 40: vulnerable.</p></details>`;
    }

    function movesHTML(ctx) {
        const facts = moveFacts(ctx);
        const hh = healthHTML(ctx, facts.overdueBills.length);
        UI.html('dash-health', hh);
        UI.show('dash-health-card', !!hh);
        const moves = Engine.nextMoves(facts, { snoozed: ctx.state.settings.movesSnoozed || {}, today: ctx.today, money: money0 });
        if (!moves.length) return '';
        return `<ol class="moves">${moves.map((mv, i) => {
            const go = mv.action ? `data-action="${mv.action}" ${Object.keys(mv.data || {}).map(k => `data-${k}="${esc(String(mv.data[k]))}"`).join(' ')}` : `data-goto="${mv.goto}" ${mv.focus ? `data-focus="${mv.focus}"` : ''}`;
            return `<li class="move">
                <span class="move-num">${i + 1}</span>
                <div class="min-w-0 flex-1"><div class="move-title"><i class="fa-solid ${mv.icon}"></i> ${esc(mv.title)}</div><p class="move-text">${esc(mv.text)}</p></div>
                <div class="flex items-center gap-1 shrink-0"><button type="button" class="btn btn-secondary btn-sm" ${go}>Do it <i class="fa-solid fa-arrow-right"></i></button>
                <button type="button" class="row-del" data-action="moves.snooze" data-key="${mv.key}" title="Not now (back in 2 weeks)" aria-label="Not now"><i class="fa-solid fa-xmark"></i></button></div>
            </li>`;
        }).join('')}</ol>`;
    }

    // ---------------------------------------------------------------- this month
    const bar = (share, color) => `<div class="mini-bar"><span style="width:${Math.max(0, Math.min(100, share * 100)).toFixed(1)}%;background:${color}"></span></div>`;
    const pctChange = (now, before) => before > 0 ? (now - before) / before : null;

    function monthDashboard(ctx) {
        const s = ctx.state, t = ctx.today;
        const y = t.getFullYear(), m = String(t.getMonth() + 1);
        const [py, pm] = m === '1' ? [y - 1, '12'] : [y, String(Number(m) - 1)];
        UI.text('dash-month-name', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
        Cash.renderSafe(t);
        Cash.renderCalendar(t);
        const txns = s.transactions;
        const items = Engine.monthItems(Store.effective(y), m);
        // Everything the plan sends out this month (spending, savings, debt payments) — the same
        // "Planeado" the budget shows, and what the curve adds up (every logged outflow).
        const plannedSpend = items.filter(i => i.type !== 'Ingreso').reduce((a, i) => a + (Number(i.real) || 0), 0);

        // Where every dollar of this month's plan goes (compact; the full one is in the budget).
        const mbNow = Engine.monthBudget(Store.effective(y), m);
        UI.text('dash-dollar-month', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
        UI.html('dash-dollar', Views.dollarHTML(Engine.budgetBuckets(items, { income: mbNow.income, sweep: mbNow.sweep }), { compact: true }));

        // Spending so far vs. last month, day by day.
        const curve = Engine.monthSpendCurve(txns, t);
        UI.text('dash-spent', money0(curve.spent));
        UI.html('dash-curve-note', curve.sameDayLast > 0
            ? (curve.diff <= 0 ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> So far <strong>${money0(-curve.diff)} less</strong> than last month by this date.` : `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> So far <strong>${money0(curve.diff)} more</strong> than last month by this date.`)
            : 'Log your expenses: next month you\'ll see the comparison with this one.');
        const days = curve.current.length;
        const prev = Array.from({ length: days }, (_, i) => i < curve.previous.length ? curve.previous[i] : curve.previous[curve.previous.length - 1]);
        UI.chart('dash-curve-chart', {
            type: 'line',
            data: {
                labels: Array.from({ length: days }, (_, i) => i + 1),
                datasets: [
                    { label: 'This month', data: curve.current, borderColor: '#2a78d6', backgroundColor: 'rgba(42,120,214,.10)', borderWidth: 2, pointRadius: 0, pointHoverRadius: 5, fill: true, cubicInterpolationMode: 'monotone' },
                    { label: 'Last month', data: prev, borderColor: '#94a3b8', borderDash: [6, 4], borderWidth: 2, pointRadius: 0, fill: false, cubicInterpolationMode: 'monotone' },
                    { label: 'Planned', data: Array(days).fill(plannedSpend), borderColor: '#cbd5e1', borderDash: [2, 4], borderWidth: 2, pointRadius: 0, fill: false }
                ]
            },
            options: { interaction: { mode: 'index', intersect: false } }
        });

        // Today: what's left per day for flexible spending, spent today, payday.
        const spend = Engine.lineSpend(items, txns, y, m);
        const flex = items.filter(i => i.type === 'Gasto Variable');
        const flexPlanned = flex.reduce((a, i) => a + (Number(i.real) || 0), 0);
        const flexSpent = flex.reduce((a, i) => a + ((spend.byLine[String(i.id)] || {}).spent || 0), 0);
        const allow = Engine.dailyAllowance({ planned: flexPlanned, spent: flexSpent, today: t });
        const iso = Engine.isoDate(t);
        const spentToday = txns.filter(x => (x.type || 'Gasto') === 'Gasto' && x.date === iso).reduce((a, x) => a + Engine.spendAmount(x), 0);
        const pay = Engine.nextPayday(Cash.paySchedule(), t);
        const streak = Engine.loggingStreak(txns, t);
        const DOW = Fmt.DOW_SHORT;
        // One "spend today" number: the budget's flexible money per day, or — when your cash
        // until payday allows less — what the cash allows (the same figure as "Seguro para gastar").
        const safe = Cash.safeContext(t).res;
        const cashPerDay = safe ? Math.max(0, safe.perDay) : null;
        const today = cashPerDay !== null ? Math.min(allow.perDay, cashPerDay) : allow.perDay;
        const byCash = cashPerDay !== null && cashPerDay < allow.perDay;
        UI.html('dash-today', `
            <div class="kpi ${today > 0 ? (spentToday > today ? 'tone-amber' : 'tone-emerald') : 'tone-red'}">
                <span class="kpi-label">You can spend today</span>
                <span class="kpi-value">${money0(today)}</span>
                <span class="kpi-note">${byCash ? `What your cash allows until payday (your flexible budget would give ${money0(allow.perDay)}). Spent today: ${money0(spentToday)}.`
                    : allow.perDay > 0 ? `${money0(allow.remaining)} of flexible spending left for ${allow.daysLeft} day${allow.daysLeft === 1 ? '' : 's'}. Spent today: ${money0(spentToday)}.` : `You've used this month's flexible spending (${money0(flexSpent)} of ${money0(flexPlanned)}).`}</span>
            </div>
            <div class="kpi tone-slate">
                <span class="kpi-label">Next payday</span>
                <span class="kpi-value">${pay ? (pay.days === 0 ? 'Today!' : `In ${pay.days} day${pay.days === 1 ? '' : 's'}`) : '—'}</span>
                <span class="kpi-note">${pay ? Fmt.dayMonth(pay.date) : '<a href="#" class="link" data-goto="presupuesto/ingresos" data-focus="pay-schedule">Tell us how you get paid</a>'}</span>
            </div>
            <div class="kpi ${streak.days >= 3 ? 'tone-amber' : 'tone-slate'}">
                <span class="kpi-label">${streak.days ? '🔥 Logging streak' : 'Log today'}</span>
                <span class="kpi-value">${streak.days} day${streak.days === 1 ? '' : 's'}</span>
                <div class="streak-week">${streak.week.map((on, i) => `<span class="${on ? 'on' : ''}" title="${on ? 'Registraste' : 'Nothing logged'}">${DOW[i]}</span>`).join('')}</div>
                <span class="kpi-note">${streak.today ? 'You\'ve logged today!' : streak.days ? 'Log something today to keep your streak.' : 'Logging your spending every day is the habit that helps most.'} <button type="button" class="link" data-action="quick.open">+ Log</button></span>
            </div>`);

        // Cash flow: money in vs. out this month, compared with last month.
        const cf = Engine.cashFlow(txns, y, m), cfp = Engine.cashFlow(txns, py, pm);
        const mx = Math.max(cf.income, cf.expense, 1);
        // The last 6 months of money in and out (this month still running: drawn dashed/hollow).
        const six = Engine.periodSeries(txns, { period: 'month', count: 6, end: t });
        const pal = UI.palette();
        const list = (field) => six.map(r => money0(r[field])).join(', ');
        const trend = (field, color, label) => UI.sparkline(six.map(r => r[field]), { width: 64, height: 18, color, partialLast: true, label });
        const chg = (now, before, goodUp) => { const c = pctChange(now, before); if (c === null) return ''; const up = c > 0; return `<span class="text-[11px] font-bold ${up === goodUp ? 'text-emerald-700' : 'text-red-600'}">${up ? '▲' : '▼'} ${Math.abs(Math.round(c * 100))}%</span>`; };
        UI.html('dash-cash', `
            <div class="space-y-3 text-xs">
                <div><div class="flex justify-between items-center gap-2"><span class="font-semibold text-slate-600">Came in</span><span class="flex items-center gap-2 ml-auto">${trend('income', pal.aqua, `Income over the last 6 months: ${list('income')}`)}<span><strong class="text-slate-900">${money0(cf.income)}</strong> ${chg(cf.income, cfp.income, true)}</span></span></div>${bar(cf.income / mx, '#1baf7a')}</div>
                <div><div class="flex justify-between items-center gap-2"><span class="font-semibold text-slate-600">Went out</span><span class="flex items-center gap-2 ml-auto">${trend('expense', pal.blue, `Spending over the last 6 months: ${list('expense')}`)}<span><strong class="text-slate-900">${money0(cf.expense)}</strong> ${chg(cf.expense, cfp.expense, false)}</span></span></div>${bar(cf.expense / mx, '#2a78d6')}</div>
                <div class="flex justify-between border-t border-slate-100 pt-2"><span class="font-semibold text-slate-600">Balance</span><strong class="${cf.net < 0 ? 'text-red-600' : 'text-emerald-700'}">${cf.net < 0 ? '−' : '+'}${money0(Math.abs(cf.net))}</strong></div>
                <p class="help">Based on your logged transactions. ▲▼ compared with ${Fmt.monthLower(pm - 1)}. The lines: last 6 months (the current one, dotted, isn't over yet).</p>
            </div>`);

        // Where the money went.
        const pad = (n) => String(n).padStart(2, '0');
        const br = Engine.categoryBreakdown(txns, { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-31` });
        const top = br.items.slice(0, 5);
        const rest = br.items.slice(5).reduce((a, r) => a + r.amount, 0);
        UI.html('dash-top', br.total ? `<div class="space-y-2.5 text-xs">${top.map(r => `<div><div class="flex justify-between gap-2"><span class="font-semibold text-slate-700 truncate">${esc(r.category)}</span><span class="whitespace-nowrap"><strong>${money0(r.amount)}</strong> <span class="text-slate-400">${Math.round(r.share * 100)}%</span></span></div>${bar(r.amount / top[0].amount, '#2a78d6')}</div>`).join('')}
            ${rest ? `<div class="flex justify-between text-slate-500"><span>Other categories</span><span>${money0(rest)}</span></div>` : ''}
            <p class="help">Total: ${money0(br.total)} in ${Fmt.monthLower(m - 1)}.</p></div>` : Views.emptyState('fa-receipt', 'No spending logged this month yet.', '<button type="button" class="btn btn-primary btn-sm" data-action="quick.open"><i class="fa-solid fa-plus"></i> Log an expense</button>'));

        // Insights
        const ins = Engine.monthInsights(txns, t);
        const out = [];
        const tip = (icon, color, title, text) => out.push(`<div class="flex gap-2.5"><span class="insight-ico" style="background:${color}"><i class="fa-solid ${icon}"></i></span><div class="text-xs"><div class="font-bold text-slate-800">${title}</div><div class="text-slate-600">${text}</div></div></div>`);
        if (ins.spent > 0) {
            const over = plannedSpend > 0 && ins.projected > plannedSpend;
            tip(over ? 'fa-arrow-trend-up' : 'fa-arrow-trend-down', over ? '#dc2626' : '#059669', over ? 'You\'ll go over' : 'You\'re doing well', `At this pace you'll end the month with <strong>${money0(ins.projected)}</strong> in expenses${plannedSpend ? ` (you planned ${money0(plannedSpend)})` : ''}.`);
        }
        if (ins.top) tip('fa-arrow-up', '#7c3aed', 'Where you spend most', `<strong>${esc(ins.top.category)}</strong>: ${money0(ins.top.amount)}, ${Math.round(ins.top.share * 100)}% of what you spent this month.`);
        if (ins.jump) tip('fa-circle-exclamation', '#ea580c', 'Biggest increase', `<strong>${esc(ins.jump.category)}</strong>: +${money0(ins.jump.change)} versus the same days last month.`);
        if (ins.drop) tip('fa-circle-minus', '#0891b2', 'Biggest drop', `<strong>${esc(ins.drop.category)}</strong>: ${money0(-ins.drop.change)} less than last month by this date.`);
        if (!ins.hasHistory && ins.spent > 0) out.push('<p class="help">With one more month of data you\'ll see what went up and what went down.</p>');
        UI.html('dash-insights', out.join('') || '<p class="help">Log some expenses and you\'ll see projections and comparisons here.</p>');

        // Accounts
        const accts = s.accounts || [];
        UI.show('dash-accounts-card', accts.length > 0);
        if (accts.length) {
            const KIND = { corriente: 'fa-building-columns', ahorros: 'fa-piggy-bank', efectivo: 'fa-money-bill-wave', retiro: 'fa-umbrella-beach' };
            // Retirement accounts (401(k)/IRA) aren't money you can use today.
            const locked = Engine.accountTotal(accts, 'retiro');
            const total = accts.reduce((a, x) => a + (Number(x.balance) || 0), 0) - locked;
            UI.html('dash-accounts', `<div class="space-y-2 text-xs">${accts.map(a => `<div class="flex items-center justify-between gap-2"><span class="flex items-center gap-2 min-w-0"><i class="fa-solid ${KIND[a.kind] || KIND.corriente} text-blue-600 w-4 text-center"></i><span class="truncate font-semibold text-slate-800">${esc(a.name)}</span></span><span class="text-right"><strong>${money(a.balance)}</strong><span class="block text-[11px] text-slate-400">${esc(a.updatedAt || '')}</span></span></div>`).join('')}
                <div class="flex justify-between border-t border-slate-100 pt-2"><span class="font-semibold text-slate-600">Available</span><strong class="${total < 0 ? 'text-red-600' : 'text-emerald-700'}">${money(total)}</strong></div>${locked ? `<div class="flex justify-between text-slate-500"><span>In retirement accounts (not available)</span><span>${money(locked)}</span></div>` : ''}</div>`);
        }

        // Household contributions
        const members = s.members || [];
        UI.show('dash-members-card', members.length > 0);
        if (members.length) {
            UI.text('dash-members-month', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
            const mt = Engine.memberTotals(txns, members, y, m);
            UI.html('dash-members', `<div class="grid grid-cols-1 md:grid-cols-3 gap-4 text-xs">
                <div class="kpi tone-slate"><span class="kpi-label">Household income</span><span class="kpi-value">${money0(mt.income)}</span><span class="kpi-note">Expenses: ${money0(mt.expense)}</span></div>
                <div class="md:col-span-2 space-y-3">${mt.rows.map(r => `<div class="grid grid-cols-[auto_1fr_1fr] gap-3 items-center">
                    <span class="flex items-center gap-2 font-bold text-slate-800 min-w-[6rem]"><span class="member-dot" style="background:${r.color || '#94a3b8'}">${esc((r.name || '?').charAt(0).toUpperCase())}</span>${esc(r.name)}</span>
                    <div><div class="flex justify-between"><span class="text-emerald-700 font-bold">+${money0(r.income)}</span><span class="text-slate-400">${Math.round(r.incomeShare * 100)}%</span></div>${bar(r.incomeShare, '#1baf7a')}</div>
                    <div><div class="flex justify-between"><span class="font-bold">−${money0(r.expense)}</span><span class="text-slate-400">${Math.round(r.expenseShare * 100)}%</span></div>${bar(r.expenseShare, '#2a78d6')}</div>
                </div>`).join('')}
                <p class="help">By who you recorded on each transaction. Bars: share of household income (green) and expenses (blue).</p></div></div>`);
        }
    }

    // This month's bills with a due date: overdue first, then upcoming, then paid.
    function billsHTML(ctx) {
        const s = ctx.state;
        const y = ctx.today.getFullYear(), m = String(ctx.today.getMonth() + 1);
        UI.text('dash-bills-month', `${Fmt.MONTH_NAMES[m - 1]} ${y}`);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, s.transactions, y, m);
        const bills = Engine.billsDue({ items, spend, year: y, month: m, today: ctx.today });
        if (!bills.length) return Views.emptyState('fa-calendar-plus', 'You don\'t have due dates yet. In your budget, tap the <i class="fa-regular fa-calendar"></i> next to a line —rent, power, internet, card— to say what day it\'s due.', '<a href="#" class="btn btn-secondary btn-sm" data-goto="presupuesto/plan">Go to the budget</a>');
        const order = { overdue: 0, soon: 1, later: 2, paid: 3 };
        const label = (b) => b.status === 'paid' ? '<span class="badge badge-ok">Paid</span>'
            : b.status === 'overdue' ? `<span class="badge badge-bad">Overdue by ${-b.daysLeft} day${b.daysLeft === -1 ? '' : 's'}</span>`
            : b.daysLeft === 0 ? '<span class="badge badge-warn">Due today</span>'
            : `<span class="badge ${b.status === 'soon' ? 'badge-warn' : 'badge-muted'}">In ${b.daysLeft} day${b.daysLeft === 1 ? '' : 's'}</span>`;
        return bills.slice().sort((a, b) => order[a.status] - order[b.status] || a.day - b.day).map(b => `
            <div class="bill-item ${b.status}">
                <div class="bill-day"><span>${Fmt.MONTH_SHORT[m - 1]}</span><b>${b.day}</b></div>
                <div class="min-w-0"><div class="font-bold text-sm text-slate-800 break-words">${esc(b.item.name)}</div><div class="text-[11px] text-slate-500">${b.spent > 0 && !b.paid ? `Paid ${money(b.spent)} of ${money(b.planned)}` : money(b.planned)}</div></div>
                <div class="flex flex-col items-end gap-1">${label(b)}${b.paid ? '' : `<button type="button" class="mini-btn" data-action="bill.pay" data-line="${esc(String(b.item.id))}" data-amount="${b.remaining}">Log payment</button>`}</div>
            </div>`).join('');
    }

    function alerts(ctx) {
        const s = ctx.state, out = [];
        const add = (tone, icon, html, goto, focus) => out.push(`<button type="button" class="alert-item w-full text-left ${tone}" data-goto="${goto}"${focus ? ` data-focus="${focus}"` : ''}><i class="fa-solid ${icon} mt-0.5"></i><span>${html}</span></button>`);

        ctx.cosede.filter(c => c.exceeded).forEach(c => add('tone-red', 'fa-shield-halved text-red-600', `<strong>${esc(c.name)}</strong> exceeds deposit insurance coverage (${money0(c.total)} of ${money0(c.limit)}).`, 'futuro/polizas'));
        s.polizas.forEach(p => {
            const m = Engine.maturityStatus(p.maturityDate, ctx.today);
            if (m && m.kind === 'vencida') add('tone-amber', 'fa-calendar-xmark text-amber-600', `CD <strong>${esc(p.number)}</strong> matured: renew it or record where that money is.`, 'futuro/polizas');
            else if (m && m.kind === 'pronto') add('tone-amber', 'fa-calendar-day text-amber-600', `CD <strong>${esc(p.number)}</strong> matures in ${m.days} days.`, 'futuro/polizas');
        });
        const bal = ctx.baseBudget.balanceReal;
        if (bal < -0.005) add('tone-red', 'fa-scale-unbalanced text-red-600', `Your base budget exceeds your net income by <strong>${money(-bal)}</strong>.`, 'presupuesto/plan');
        else if (bal > 0.005) add('tone-amber', 'fa-coins text-amber-600', `You have <strong>${money(bal)}</strong> a month unassigned in your base budget.`, 'presupuesto/plan');

        // Over-budget categories this calendar month (only meaningful for the current year).
        if (s.activeYear === ctx.today.getFullYear()) {
            const m = String(ctx.today.getMonth() + 1);
            const items = Engine.monthItems(ctx.budgetYear, m);
            const spend = Engine.lineSpend(items, s.transactions, s.activeYear, m);
            const over = items.filter(it => {
                const sp = spend.byLine[String(it.id)];
                return sp && sp.txns.length && Engine.spendStatus(sp.spent, Number(it.real) || 0).kind === 'over';
            });
            const bills = Engine.billsDue({ items, spend, year: s.activeYear, month: m, today: ctx.today });
            const late = bills.filter(b => b.status === 'overdue');
            if (late.length) add('tone-red', 'fa-calendar-xmark text-red-600', `Overdue bills: ${late.map(b => `<strong>${esc(b.item.name)}</strong> (día ${b.day})`).join(', ')}.`, 'resumen', 'dash-bills-card');
            if (over.length) add('tone-red', 'fa-cart-shopping text-red-600', `This month you went over in: <strong>${over.map(i => esc(i.name)).join(', ')}</strong>.`, 'presupuesto/plan');
        }
        // (Closing last month is one of the next moves, not an alert.)
        const last = s.settings.lastBackupAt ? new Date(s.settings.lastBackupAt) : null;
        const days = last ? Math.floor((ctx.today - last) / 86400000) : null;
        if (days === null || days > 30) add('tone-amber', 'fa-download text-amber-600', days === null ? 'You don\'t have a <strong>backup</strong>. If the browser data is cleared you\'d lose your plan.' : `Your latest backup is <strong>${days} days</strong>. Download a new one.`, 'config');
        if (ctx.debts.totalBalance > 0 && ctx.debts.shortfall > 0) add('tone-red', 'fa-snowplow text-red-600', `Your budget doesn't cover your debts' minimum payments: missing <strong>${money0(ctx.debts.shortfall)}</strong> a month.`, 'futuro/metas');
        else if (ctx.debts.never && ctx.debts.totalBalance > 0) add('tone-red', 'fa-snowplow text-red-600', 'With what your budget assigns, a debt never gets paid off.', 'futuro/metas');
        if (ctx.steps.current >= 3) {
            const unfunded = s.goals.filter(g => Engine.goalMonths(g).status === 'never');
            if (unfunded.length) add('tone-amber', 'fa-bullseye text-purple-600', `${unfunded.map(g => `<strong>${esc(g.name)}</strong>`).join(', ')} with no money assigned in your budget.`, 'futuro/metas');
        }
        const p = ctx.pay;
        if (p.sriCap > 0 && p.deductibles.real < p.sriCap * 0.8 && p.rebajaRoom >= 1) add('tone-blue', 'fa-file-invoice-dollar text-blue-600', `With <strong>${money0(p.sriCap - p.deductibles.real)}</strong> more in personal expenses, your tax would drop up to <strong>${money0(p.rebajaRoom)}</strong>.`, 'presupuesto/ingresos');

        return out.join('');
    }

    function update(ctx) {
        const s = ctx.state;
        UI.html('dash-bills', billsHTML(ctx));
        monthDashboard(ctx);
        const welcome = document.getElementById('dash-welcome');
        UI.show(welcome, !s.settings.welcomeDismissed);
        if (!s.settings.welcomeDismissed) {
            // First visit: start your own plan, or look around a complete example household first.
            welcome.innerHTML = `<div class="card-head">
                    <div><div class="card-title"><i class="fa-solid fa-hand text-emerald-600"></i> Welcome to your Financial Plan</div><div class="card-sub">How do you want to start? You can change your mind anytime.</div></div>
                </div>
                <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <button type="button" class="start-choice" data-action="app.dismissWelcome" data-then="presupuesto/ingresos">
                        <i class="fa-solid fa-pen-to-square text-emerald-600"></i><strong>Start with my own data</strong>
                        <span>An empty plan: your salary first, then your budget, your debts and your goals.</span></button>
                    <button type="button" class="start-choice" data-action="app.loadExample">
                        <i class="fa-solid fa-people-roof text-blue-600"></i><strong>Explore the example</strong>
                        <span>A family of 4 with a year of transactions, debts, savings and investments, to see everything the app does.</span></button>
                </div>
                <details class="mt-4"><summary class="link text-xs">How the app works and how to keep your data safe</summary><div class="mt-3">${Views.guideHTML()}</div></details>`;
        }
        UI.html('dash-hero', hero(ctx));
        const mv = movesHTML(ctx);
        UI.html('dash-moves', mv);
        UI.show('dash-moves-card', !!mv);
        UI.html('dash-steps', Views.stepsHTML(ctx, { compact: true }));

        const bb = ctx.baseBudget, debts = ctx.debts, ef = ctx.ef, r = ctx.retirement;
        // Sparklines where there's a trend: the debt plan ahead (dashed: a projection, from
        // Engine.debtPayoff history) and net worth by year (Engine.netWorthYears, real years only).
        const pal = UI.palette();
        // With payments logged ("Pagar"), the real last 6 months instead.
        const paid = (s.debts || []).some(d => (d.payments || []).length);
        const past = paid ? Engine.debtBalanceHistory(s.debts, ctx.today, 6) : null;
        const debtSpark = past
            ? UI.sparkline(past.map(p => p.total), { width: 84, height: 26, zero: false, color: pal.orange, label: `What you owe, last 6 months: from ${money0(past[0].total)} to ${money0(past[past.length - 1].total)}` })
            : debts.totalBalance > 0 && !debts.never && debts.history.length
            ? UI.sparkline([debts.totalBalance].concat(debts.history), { width: 84, height: 26, dashed: true, color: pal.orange, label: `Your plan: from ${money0(debts.totalBalance)} to $0 by ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}` }) : '';
        const nwYears = Engine.netWorthYears(s.years, s.assets, ctx.today.getFullYear());
        const nwSpark = nwYears.length >= 2
            ? UI.sparkline(nwYears.map(y => Engine.netWorth(s.years, s.assets, y).value), { width: 84, height: 26, zero: false, color: pal.blue, label: `Net worth ${nwYears[0]}–${nwYears[nwYears.length - 1]}` }) : '';
        const balNote = Math.abs(bb.balanceReal) < 0.005 ? '✓ Zero-based: every dollar assigned' : bb.balanceReal > 0 ? `${money(bb.balanceReal)} unassigned` : `${money(-bb.balanceReal)} over`;
        UI.html('dash-kpis', [
            Views.kpiCard({ tone: 'text-emerald-600', icon: 'fa-wallet', label: 'Monthly net income', value: money(bb.income), note: `Assigned: ${money(bb.expReal + bb.sweep)} · ${balNote}`, goto: 'presupuesto/plan' }),
            Views.kpiCard({ tone: 'text-red-600', icon: 'fa-snowplow', label: 'Consumer debt', value: money0(debts.totalBalance), note: debts.totalBalance <= 0 ? 'Debt-free!' : debts.shortfall > 0 ? `Budget doesn't cover minimums (${money0(debts.shortfall)} short)` : debts.never ? 'You never finish with this budget' : `${money0(debts.pool)}/mo · free in ${Fmt.monthYear(Engine.addMonths(ctx.today, debts.months))}`, goto: 'futuro/metas', focus: 'metas-debts', spark: debtSpark }),
            Views.kpiCard({ tone: 'text-emerald-600', icon: 'fa-shield-heart', label: 'Emergency fund', value: money0(ef.liquid), note: `${ef.monthsCovered.toFixed(1)} months of essential expenses covered`, goto: 'futuro/metas', focus: 'metas-ef' }),
            Views.kpiCard({ tone: 'text-amber-500', icon: 'fa-piggy-bank', label: 'Savings & CDs', value: money0(ctx.polizasCapital), note: `Projection to ${s.configEndYear}: ${money0(ctx.projection.finalBalance)}`, goto: 'futuro/proyeccion' }),
            Views.kpiCard({ tone: 'text-teal-600', icon: 'fa-scale-balanced', label: `Net worth ${s.activeYear}`, value: money0(ctx.netWorth.value), note: `Assets ${money0(ctx.netWorth.assets)} · Liabilities ${money0(ctx.netWorth.liabilities)}`, goto: 'patrimonio', spark: nwSpark }),
            Views.kpiCard({ tone: 'text-indigo-600', icon: 'fa-person-cane', label: 'Estimated retirement', value: `${money0(r.ingresoTotal)}/mo`, note: `At age ${r.edadJubilacion} · savings ${money0(r.ingresoAhorro)} + Social Security ${money0(r.pension)}`, goto: 'futuro/jubilacion' })
        ].join(''));

        // Alerts sit at the top, and only when there's something to do.
        const al = alerts(ctx);
        UI.html('dash-alerts', al);
        UI.show('dash-alerts-card', !!al);

        const years = Engine.netWorthYears(s.years, s.assets, ctx.today.getFullYear());
        UI.chart('dash-nw-chart', {
            type: 'line',
            data: { labels: years, datasets: [{ label: 'Net worth', data: years.map(y => Engine.netWorth(s.years, s.assets, y).value), borderColor: pal.blue, backgroundColor: pal.alpha(pal.blue, 0.1), borderWidth: 2, fill: true, tension: 0, pointRadius: years.map(y => y === s.activeYear ? 5 : 3), pointBackgroundColor: pal.blue, pointBorderColor: pal.surface, pointBorderWidth: 2 }] },
            options: { scales: { y: { beginAtZero: false } }, plugins: { legend: { display: false } } }
        });
    }

    UI.register({
        // Logs this month's payment of a bill as an expense on its budget line.
        'bill.pay': (el) => {
            const today = new Date();
            const y = today.getFullYear(), m = String(today.getMonth() + 1);
            const item = Engine.monthItems(Store.effective(y), m).find(i => String(i.id) === el.dataset.line);
            if (!item) return;
            const tax = Store.state.taxonomy.expense;
            const cat = tax[item.linkedCategory] ? item.linkedCategory : (tax.Otros ? 'Otros' : Object.keys(tax)[0]);
            const txns = Store.state.transactions;
            const amount = Math.round(Number(el.dataset.amount) * 100) / 100;
            txns.push({ id: Store.nextId(txns), type: 'Gasto', description: item.name, store: '', parentCategory: cat, category: (tax[cat] || [])[0] || '', amount, date: Engine.isoDate(today), paymentType: 'Transferencia', budgetLine: String(item.id) });
            App.changed({ structural: true, step: true });
            UI.toast(`Payment for "${item.name}" logged (${Fmt.money(amount)}).`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
        },
        'app.loadExample': async () => {
            const s = Store.state;
            const hasData = !s.settings.sample && (s.transactions.length || s.debts.length || s.goals.length || s.polizas.length);
            if (hasData && !(await UI.confirm({ title: 'See the example family', message: 'Your data is replaced by the example\'s. Download a backup first if you want to go back to it (you can also undo).', confirmText: 'See the example', danger: true }))) return;
            App.commitHistory();
            Store.reset('example');
            Store.state.settings.welcomeDismissed = true;
            Store.ui.month = 'base';
            App.changed({ structural: true, step: true });
            App.go('resumen');
            UI.toast('You\'re looking at an example family. Whenever you\'re ready, start with your own data from the notice at the top.');
        },
        'app.dismissWelcome': (el) => {
            Store.state.settings.welcomeDismissed = true;
            Store.scheduleSave();
            App.commitHistory();  // a preference, not something to undo
            if (el.dataset.then) App.go(el.dataset.then); else App.render();
        }
    });

    // On a phone the long-term section starts folded: today's money comes first.
    let folded = false;
    function view(ctx) {
        if (!folded) {
            folded = true;
            const lt = document.getElementById('dash-longterm');
            if (lt && window.matchMedia && matchMedia('(max-width: 639px)').matches) lt.open = false;
        }
        update(ctx);
    }

    App.defineView('resumen', { update: view });
})();
