/*
 * Engine — pure financial calculations. No DOM, no global state, no side effects:
 * every function takes plain data and returns plain data, so it can be unit-tested
 * in Node (tests/engine.test.js) and reused by any tab without hidden coupling.
 */
(function (root) {
    'use strict';

    const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const sum = (arr, fn) => arr.reduce((s, x) => s + fn(x), 0);
    const MONTHS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '10', '11', '12'];

    // ---------------------------------------------------------------- budget

    // A month either has its own override list or falls back to the annual base budget.
    function monthItems(yd, month) {
        if (month === 'base' || !yd.monthOverrides || !yd.monthOverrides[month]) return yd.budgetBase || [];
        return yd.monthOverrides[month];
    }

    const isSavingsItem = (item) => (item.type || '').includes('Ahorro');
    const isEssentialItem = (item) => item.type === 'Gasto Fijo' || item.type === 'Gasto Variable';

    // SRI personal-expense deductions for the year, per the year's calculation mode:
    // 'base12' = base budget × 12, 'sum12' = each month's own list summed.
    function annualDeductibles(yd) {
        const pick = (items, field) => sum(items.filter(i => i.isDeductible), i => num(i[field]));
        if (yd.annualMode === 'sum12') {
            return {
                prep: sum(MONTHS, m => pick(monthItems(yd, m), 'prep')),
                real: sum(MONTHS, m => pick(monthItems(yd, m), 'real'))
            };
        }
        const base = yd.budgetBase || [];
        return { prep: pick(base, 'prep') * 12, real: pick(base, 'real') * 12 };
    }

    // ------------------------------------------------------------- payroll/tax

    function incomeTax(baseImponible, brackets) {
        let tax = 0;
        for (const b of brackets || []) {
            if (baseImponible > num(b.min)) {
                tax = num(b.baseTax) + (Math.min(baseImponible, num(b.max)) - num(b.min)) * num(b.rate);
            }
        }
        return Math.max(0, tax);
    }

    function sriCap(yd) {
        const mult = Number.isFinite(Number(yd.sriCapMultiplier)) && yd.sriCapMultiplier !== '' && yd.sriCapMultiplier !== null
            ? Math.max(0, Number(yd.sriCapMultiplier)) : 7;
        return num(yd.canasta) * mult;
    }

    // Monthly payroll for a year: IESS personal contribution, SRI income tax withheld and
    // the resulting net salary (without décimos — those depend on the month, see below).
    function payroll(yd) {
        const sueldo = Math.max(0, num(yd.sueldo));
        const iessM = sueldo * num(yd.iessRate) / 100;
        const cap = sriCap(yd);
        const deductibles = annualDeductibles(yd);
        const dedApplied = Math.min(deductibles.real, cap);
        const baseImponible = Math.max(0, sueldo * 12 - iessM * 12 - dedApplied);
        const isrAnual = incomeTax(baseImponible, yd.sriBrackets);
        return {
            sueldo,
            sueldoAnual: sueldo * 12,
            iessM,
            iessAnual: iessM * 12,
            sriCap: cap,
            deductibles,
            dedApplied,
            baseImponible,
            isrAnual,
            isrM: isrAnual / 12,
            netoM: Math.max(0, sueldo - iessM - isrAnual / 12)
        };
    }

    const d4Month = (yd) => (yd.d4Region === 'sierra' ? '8' : '3');

    // Décimo Tercero (December, one full salary) and Décimo Cuarto (March on the Coast,
    // August in the Sierra, one SBU) — paid on top of the regular net salary.
    function bonusForMonth(yd, month) {
        if (month === 'base') return 0;
        let bonus = 0;
        if (month === '12' && yd.d3) bonus += Math.max(0, num(yd.sueldo));
        if (month === d4Month(yd) && yd.d4) bonus += num(yd.sbu);
        return bonus;
    }

    // ------------------------------------------------------------ other income
    // Besides the salary, a person can have other income: a side business, freelance work,
    // remittances... Two sources feed the budget:
    //  - yd.otherIncomes: recurring monthly income the person plans on (every month);
    //  - income transactions logged in a month (yd.receivedIncome, derived from the
    //    transactions by Store.effective), which count in that month.
    // A transaction is the receipt of a planned income only when the person links it to that
    // line (t.incomeId): the month then counts whichever is larger, planned or received,
    // never both. Categories never link anything by themselves, so changing a line's
    // category can't swallow unrelated income. Unlinked income is extra income of its month.
    // Transactions labelled as the salary itself (Sueldo/Salario, décimos) aren't added: the
    // salary already comes from "Tu Sueldo". The person can mark one as extra (t.countAsExtra).
    const PAYROLL_SUBCATEGORIES = ['Sueldo/Salario', 'Décimo Tercero', 'Décimo Cuarto'];
    const isPayrollTxn = (t) => PAYROLL_SUBCATEGORIES.includes(t.category) && !t.countAsExtra;

    // Income transactions of one year, by month: { '9': { txns: [txn], payroll: [txn] } }.
    function receivedIncome(transactions, year) {
        const out = {};
        (transactions || []).forEach(t => {
            if ((t.type || 'Gasto') !== 'Ingreso' || !t.date || Number(t.date.slice(0, 4)) !== Number(year)) return;
            const m = String(Number(t.date.slice(5, 7)));
            const bucket = out[m] || (out[m] = { txns: [], payroll: [] });
            (isPayrollTxn(t) ? bucket.payroll : bucket.txns).push(t);
        });
        return out;
    }

    function otherIncome(yd, month) {
        const rec = month === 'base' ? null : (yd.receivedIncome || {})[month];
        const txns = rec ? rec.txns : [];
        const amountOf = (list) => sum(list, t => Math.max(0, num(t.amount)));
        const sources = (yd.otherIncomes || []).map(src => {
            const planned = Math.max(0, num(src.amount));
            const linked = txns.filter(t => t.incomeId === src.id);
            const received = amountOf(linked);
            return { id: src.id, name: src.name, category: src.category && src.category !== 'none' ? src.category : null, planned, received, amount: Math.max(planned, received), txns: linked };
        });
        // Everything not linked to an existing line (including lines since deleted), by category.
        const ids = new Set(sources.map(x => x.id));
        const byCat = {};
        txns.filter(t => !ids.has(t.incomeId)).forEach(t => { (byCat[t.parentCategory] = byCat[t.parentCategory] || []).push(t); });
        const unplanned = Object.keys(byCat).map(c => ({ category: c, amount: amountOf(byCat[c]), txns: byCat[c] })).filter(u => u.amount > 0);
        const planned = sum(sources, x => x.planned);
        const total = sum(sources, x => x.amount) + sum(unplanned, x => x.amount);
        return { sources, unplanned, planned, total, extraReceived: total - planned, payroll: rec ? rec.payroll : [] };
    }

    // Everything the zero-based budget needs for one month (or the 'base' month).
    // Auto-sweep is derived here — it never rewrites what the user typed — so it works
    // in both directions and applies to every month of the annual projection too.
    function monthBudget(yd, month, pay) {
        pay = pay || payroll(yd);
        const items = monthItems(yd, month);
        const salary = pay.netoM + bonusForMonth(yd, month);
        const other = otherIncome(yd, month);
        const income = salary + other.total;
        const expPrep = sum(items, i => num(i.prep));
        const expReal = sum(items, i => num(i.real));
        const rawBalanceReal = income - expReal;
        const sweep = yd.sweepSavings && rawBalanceReal > 0 ? rawBalanceReal : 0;
        return {
            income,
            salary,
            otherIncome: other.total,
            incomePrep: salary + other.planned,
            expPrep,
            expReal,
            balancePrep: salary + other.planned - expPrep,
            balanceReal: rawBalanceReal - sweep,
            sweep,
            savingsReal: sum(items.filter(isSavingsItem), i => num(i.real)) + sweep,
            consumptionReal: sum(items.filter(i => !isSavingsItem(i)), i => num(i.real))
        };
    }

    function annualBudget(yd) {
        const pay = payroll(yd);
        const totals = { income: 0, expPrep: 0, expReal: 0, savingsReal: 0, consumptionReal: 0, sweep: 0 };
        MONTHS.forEach(m => {
            const mb = monthBudget(yd, m, pay);
            Object.keys(totals).forEach(k => { totals[k] += mb[k]; });
        });
        return totals;
    }

    // ------------------------------------------------------------ DPF / pólizas

    const MODALITIES = ['Al Vencimiento (Simple)', 'Mensual (Compuesto)', 'Trimestral (Compuesto)', 'Semestral (Compuesto)', 'Anual (Compuesto)'];

    function polizaInterest(p) {
        const amount = num(p.amount);
        const rate = num(p.rate) / 100;
        const years = (num(p.days) || 360) / 360;
        const mod = p.modality || MODALITIES[0];
        if (mod.includes('Simple') || mod.includes('Vencimiento')) return amount * rate * years;
        let n = 12;
        if (mod.includes('Trimestral')) n = 4;
        else if (mod.includes('Semestral')) n = 2;
        else if (mod.includes('Anual')) n = 1;
        return amount * (Math.pow(1 + rate / n, n * years) - 1);
    }

    const polizasCapital = (polizas) => sum(polizas || [], p => num(p.amount));

    function maturityStatus(dateStr, today) {
        if (!dateStr) return null;
        const t = new Date(today || Date.now());
        t.setHours(0, 0, 0, 0);
        const m = new Date(dateStr + 'T00:00:00');
        if (isNaN(m.getTime())) return null;
        const days = Math.round((m - t) / 86400000);
        if (days < 0) return { kind: 'vencida', days };
        if (days <= 30) return { kind: 'pronto', days };
        return { kind: 'ok', days };
    }

    // COSEDE insures deposits per person per institution; flag any cooperativa whose
    // pólizas add up to more than its coverage limit.
    function cosedeCheck(polizas, cooperativas, defaultLimit) {
        const byCoop = {};
        (polizas || []).forEach(p => { byCoop[p.coopName] = (byCoop[p.coopName] || 0) + num(p.amount); });
        return Object.keys(byCoop).map(name => {
            const coop = (cooperativas || []).find(c => c.name === name);
            const limit = coop ? num(coop.cosedeMax) : num(defaultLimit);
            return { name, total: byCoop[name], limit, exceeded: byCoop[name] > limit };
        });
    }

    // Forward DPF projection. Starts from what you actually hold today (registered pólizas)
    // and adds each year's budgeted savings (plus auto-sweep) at that year's DPF rate.
    // New money is assumed to arrive evenly through the year, so it earns half a year.
    function projectDPF({ polizas, startYear, endYear, getYear }) {
        const opening = polizasCapital(polizas);
        const rows = [];
        let balance = opening, totalContrib = 0, totalInterest = 0;
        for (let y = startYear; y <= endYear; y++) {
            const yd = getYear(y);
            const contribution = annualBudget(yd).savingsReal;
            const rate = num(yd.tasa) / 100;
            const interest = balance * rate + contribution * rate * 0.5;
            balance += contribution + interest;
            totalContrib += contribution;
            totalInterest += interest;
            rows.push({ year: y, contribution, totalContrib, interest, totalInterest, balance, rate: num(yd.tasa) });
        }
        return { opening, rows, finalBalance: balance, totalContrib, totalInterest };
    }

    function balanceAtYear(projection, year) {
        const row = projection.rows.find(r => r.year === year);
        return row ? row.balance : projection.opening;
    }

    // Net annual income (after IESS + income tax, including décimos) vs. cost of living
    // (everything budgeted except savings) for each year of the timeline.
    function incomeExpenseSeries({ startYear, endYear, getYear }) {
        const rows = [];
        for (let y = startYear; y <= endYear; y++) {
            const ab = annualBudget(getYear(y));
            rows.push({ year: y, income: ab.income, consumption: ab.consumptionReal, savings: ab.savingsReal });
        }
        return rows;
    }

    // ------------------------------------------------------------- transactions

    const txnType = (t) => t.type || 'Gasto';
    const txnDate = (t) => new Date(t.date + 'T00:00:00');

    // How many months of a year's budget should have been "used" by today: all 12 for a
    // past year, the elapsed months (current one included) this year, none for a future one.
    function monthsElapsed(year, today) {
        const t = new Date(today || Date.now());
        if (year < t.getFullYear()) return 12;
        if (year > t.getFullYear()) return 0;
        return t.getMonth() + 1;
    }

    function categorySpend(transactions, category, year, month) {
        if (!category || category === 'none') return null;
        return sum((transactions || []).filter(t => {
            if (txnType(t) !== 'Gasto' || t.parentCategory !== category) return false;
            const d = txnDate(t);
            if (d.getFullYear() !== year) return false;
            return month === 'base' || (d.getMonth() + 1) === Number(month);
        }), t => num(t.amount));
    }

    // Budget target to compare real spending against. A single month compares against that
    // month's budget; the annual view compares against the budget for the months elapsed so
    // far — comparing a full year's budget with spending to date always looked "underspent".
    function categoryTarget(item, year, month, today) {
        const prep = num(item.prep);
        return month === 'base' ? prep * monthsElapsed(year, today) : prep;
    }

    function spendStatus(spent, target) {
        if (spent === null) return { kind: 'unlinked' };
        if (target <= 0) return spent > 0 ? { kind: 'unbudgeted', spent } : { kind: 'empty', spent: 0 };
        if (spent === 0) return { kind: 'untouched', spent, target };
        const ratio = spent / target;
        if (ratio >= 1) return { kind: 'over', spent, target, ratio, over: spent - target };
        if (ratio >= 0.8) return { kind: 'warning', spent, target, ratio };
        return { kind: 'ok', spent, target, ratio };
    }

    // Which budget line each expense of a period belongs to. A transaction the person
    // assigned to a line (t.budgetLine) counts there; otherwise it counts for the FIRST line
    // linked to its category, so two lines sharing a category never count the same money
    // twice. Anything that matches no line is "unassigned" (shown so it can be assigned).
    function lineSpend(items, transactions, year, month) {
        const byLine = {};
        const firstByCat = {};
        items.forEach(i => {
            byLine[String(i.id)] = { spent: 0, txns: [] };
            const c = i.linkedCategory;
            if (c && c !== 'none' && !(c in firstByCat)) firstByCat[c] = String(i.id);
        });
        const unassigned = [];
        (transactions || []).forEach(t => {
            if (txnType(t) !== 'Gasto') return;
            const d = txnDate(t);
            if (d.getFullYear() !== Number(year)) return;
            if (month !== 'base' && (d.getMonth() + 1) !== Number(month)) return;
            const explicit = t.budgetLine !== undefined && t.budgetLine !== null && t.budgetLine !== '' && byLine[String(t.budgetLine)] ? String(t.budgetLine) : null;
            const key = explicit || firstByCat[t.parentCategory] || null;
            if (!key) { unassigned.push(t); return; }
            byLine[key].spent += num(t.amount);
            byLine[key].txns.push(t);
        });
        return { byLine, unassigned, unassignedTotal: sum(unassigned, t => num(t.amount)) };
    }

    // Planned spending vs. everything actually spent (all expense transactions), per month.
    function budgetVsActualByMonth(yd, transactions, year) {
        return MONTHS.map(m => {
            const actual = sum((transactions || []).filter(t => {
                if (txnType(t) !== 'Gasto') return false;
                const d = txnDate(t);
                return d.getFullYear() === Number(year) && (d.getMonth() + 1) === Number(m);
            }), t => num(t.amount));
            return { month: Number(m), budgeted: sum(monthItems(yd, m), i => num(i.real)), actual };
        });
    }

    // ------------------------------------------------------------ trends
    const pad2 = (n) => String(n).padStart(2, '0');
    const isoDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;

    // Start of the week (Monday), month or year that contains a date.
    function periodStart(d, period) {
        if (period === 'year') return new Date(d.getFullYear(), 0, 1);
        if (period === 'month') return new Date(d.getFullYear(), d.getMonth(), 1);
        const s = new Date(d.getFullYear(), d.getMonth(), d.getDate());
        s.setDate(s.getDate() - ((s.getDay() + 6) % 7));
        return s;
    }

    function shiftPeriod(d, period, n) {
        if (period === 'year') return new Date(d.getFullYear() + n, 0, 1);
        if (period === 'month') return new Date(d.getFullYear(), d.getMonth() + n, 1);
        const s = new Date(d); s.setDate(s.getDate() + 7 * n); return s;
    }

    // Income and expenses for the last `count` weeks/months/years up to `end` (included),
    // optionally for one category. Every period is present, even with no transactions.
    function periodSeries(transactions, { period = 'month', count = 12, end = new Date(), category = 'all' } = {}) {
        const last = periodStart(new Date(end), period);
        const rows = [];
        for (let i = count - 1; i >= 0; i--) {
            const start = shiftPeriod(last, period, -i);
            rows.push({ key: isoDate(start), start: isoDate(start), income: 0, expense: 0, count: 0 });
        }
        const index = new Map(rows.map((r, i) => [r.key, i]));
        (transactions || []).forEach(t => {
            if (category !== 'all' && t.parentCategory !== category) return;
            const k = isoDate(periodStart(txnDate(t), period));
            if (!index.has(k)) return;
            const r = rows[index.get(k)];
            if (txnType(t) === 'Ingreso') r.income += num(t.amount); else r.expense += num(t.amount);
            r.count++;
        });
        return rows;
    }

    // ------------------------------------------------------------ this month: insights
    const inMonth = (t, y, m) => { const d = txnDate(t); return d.getFullYear() === Number(y) && d.getMonth() + 1 === Number(m); };
    const prevMonth = (y, m) => (Number(m) === 1 ? [Number(y) - 1, 12] : [Number(y), Number(m) - 1]);
    const daysIn = (y, m) => new Date(Number(y), Number(m), 0).getDate();

    // Cumulative spending by day of month, this month (up to `today`) and last month (whole).
    function monthSpendCurve(transactions, today) {
        const t = new Date(today);
        const y = t.getFullYear(), m = t.getMonth() + 1;
        const [py, pm] = prevMonth(y, m);
        const build = (yy, mm, upto) => {
            const days = daysIn(yy, mm);
            const daily = new Array(days).fill(0);
            (transactions || []).forEach(x => { if (txnType(x) === 'Gasto' && inMonth(x, yy, mm)) daily[txnDate(x).getDate() - 1] += num(x.amount); });
            let acc = 0;
            return daily.map((v, i) => { acc += v; return i < upto ? Math.round(acc * 100) / 100 : null; });
        };
        const current = build(y, m, t.getDate());
        const previous = build(py, pm, daysIn(py, pm));
        const today_ = current[t.getDate() - 1] || 0;
        const sameDayLast = previous[Math.min(t.getDate(), previous.length) - 1] || 0;
        return { current, previous, spent: today_, sameDayLast, diff: today_ - sameDayLast, lastTotal: previous[previous.length - 1] || 0 };
    }

    // Spending (or income) by category between two dates (inclusive), largest first.
    function categoryBreakdown(transactions, { from, to, type = 'Gasto' }) {
        const by = {};
        let total = 0;
        (transactions || []).forEach(x => {
            if (txnType(x) !== type || x.date < from || x.date > to) return;
            const k = x.parentCategory || 'Otros';
            by[k] = by[k] || { category: k, amount: 0, count: 0 };
            by[k].amount += num(x.amount); by[k].count++;
            total += num(x.amount);
        });
        return { total, items: Object.values(by).sort((a, b) => b.amount - a.amount).map(r => Object.assign(r, { share: total ? r.amount / total : 0 })) };
    }

    function cashFlow(transactions, y, m) {
        let income = 0, expense = 0;
        (transactions || []).forEach(x => { if (!inMonth(x, y, m)) return; if (txnType(x) === 'Ingreso') income += num(x.amount); else expense += num(x.amount); });
        return { income, expense, net: income - expense };
    }

    // Next payday from days of the month (e.g. [15, 30] for quincenal); 31 means "last day".
    function nextPayday(paydays, today) {
        const t = new Date(today);
        const base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        const days = (paydays || []).map(Number).filter(d => d >= 1 && d <= 31);
        if (!days.length) return null;
        let best = null;
        for (let add = 0; add <= 1; add++) {
            const y = t.getFullYear(), m = t.getMonth() + add;
            days.forEach(d => {
                const last = new Date(y, m + 1, 0).getDate();
                const date = new Date(y, m, Math.min(d, last));
                if (date >= base && (!best || date < best)) best = date;
            });
        }
        return { date: best, days: Math.round((best - base) / 86400000) };
    }

    // What can still be spent per day on flexible spending this month.
    function dailyAllowance({ planned, spent, today }) {
        const t = new Date(today);
        const daysLeft = daysIn(t.getFullYear(), t.getMonth() + 1) - t.getDate() + 1;   // today included
        const remaining = num(planned) - num(spent);
        return { remaining, daysLeft, perDay: remaining > 0 ? remaining / daysLeft : 0 };
    }

    // Month-to-date insights: projected month-end spending, where most money goes, and the
    // category that grew the most vs. the same days of last month.
    function monthInsights(transactions, today) {
        const t = new Date(today);
        const y = t.getFullYear(), m = t.getMonth() + 1, day = t.getDate();
        const [py, pm] = prevMonth(y, m);
        const pad = (n) => String(n).padStart(2, '0');
        const cur = categoryBreakdown(transactions, { from: `${y}-${pad(m)}-01`, to: `${y}-${pad(m)}-${pad(day)}` });
        const lastUpto = Math.min(day, daysIn(py, pm));
        const prev = categoryBreakdown(transactions, { from: `${py}-${pad(pm)}-01`, to: `${py}-${pad(pm)}-${pad(lastUpto)}` });
        const projected = day > 0 ? cur.total / day * daysIn(y, m) : 0;
        const prevBy = Object.fromEntries(prev.items.map(r => [r.category, r.amount]));
        const jumps = cur.items.map(r => ({ category: r.category, now: r.amount, before: prevBy[r.category] || 0, change: r.amount - (prevBy[r.category] || 0) }))
            .filter(r => r.before > 0 && r.change > 0).sort((a, b) => b.change - a.change);
        const drops = prev.items.map(r => ({ category: r.category, before: r.amount, now: (cur.items.find(c => c.category === r.category) || { amount: 0 }).amount }))
            .map(r => Object.assign(r, { change: r.now - r.before })).filter(r => r.change < 0).sort((a, b) => a.change - b.change);
        return { spent: cur.total, projected, top: cur.items[0] || null, jump: jumps[0] || null, drop: drops[0] || null, hasHistory: prev.total > 0 };
    }

    // Income and expenses per household member for a month; transactions with no member go
    // to "Sin asignar".
    function memberTotals(transactions, members, y, m) {
        const rows = (members || []).map(p => ({ id: p.id, name: p.name, color: p.color, income: 0, expense: 0 }));
        const none = { id: null, name: 'Sin asignar', income: 0, expense: 0 };
        (transactions || []).forEach(x => {
            if (!inMonth(x, y, m)) return;
            const r = rows.find(p => p.id === x.memberId) || none;
            if (txnType(x) === 'Ingreso') r.income += num(x.amount); else r.expense += num(x.amount);
        });
        const all = rows.concat(none.income || none.expense ? [none] : []);
        const ti = sum(all, r => r.income), te = sum(all, r => r.expense);
        return { income: ti, expense: te, rows: all.map(r => Object.assign(r, { incomeShare: ti ? r.income / ti : 0, expenseShare: te ? r.expense / te : 0 })) };
    }

    // ------------------------------------------------------------ recurring
    // A repeating transaction: { frequency: 'weekly'|'biweekly'|'monthly'|'yearly',
    // startDate, endDate?, lastPosted? }. Monthly/yearly keep the start's day of month
    // (clamped to short months: the 31st becomes the 30th/28th).
    const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
    function occurrences(rec, fromISO, toISO) {
        if (!rec || !rec.startDate) return [];
        const start = parseISO(rec.startDate), from = parseISO(fromISO), to = parseISO(toISO);
        const end = rec.endDate ? parseISO(rec.endDate) : null;
        const out = [];
        const day = start.getDate();
        for (let i = 0; i < 1000; i++) {
            let d;
            if (rec.frequency === 'weekly') { d = new Date(start); d.setDate(start.getDate() + 7 * i); }
            else if (rec.frequency === 'biweekly') { d = new Date(start); d.setDate(start.getDate() + 14 * i); }
            else if (rec.frequency === 'yearly') { const y = start.getFullYear() + i; d = new Date(y, start.getMonth(), Math.min(day, new Date(y, start.getMonth() + 1, 0).getDate())); }
            else { const mm = start.getMonth() + i; d = new Date(start.getFullYear(), mm, Math.min(day, new Date(start.getFullYear(), mm + 1, 0).getDate())); }
            if (d > to || (end && d > end)) break;
            if (d >= from) out.push(isoDate(d));
        }
        return out;
    }

    // Dates that should have been posted by `today` and weren't yet.
    function dueOccurrences(rec, today) {
        const t = isoDate(new Date(today));
        const after = rec.lastPosted ? isoDate(new Date(parseISO(rec.lastPosted).getTime() + 86400000)) : rec.startDate;
        return after > t ? [] : occurrences(rec, after, t);
    }

    function nextOccurrence(rec, today) {
        const t = new Date(today);
        const from = rec.lastPosted && rec.lastPosted >= isoDate(t) ? isoDate(new Date(parseISO(rec.lastPosted).getTime() + 86400000)) : isoDate(t);
        const horizon = new Date(t.getFullYear() + 2, t.getMonth(), t.getDate());
        return occurrences(rec, from, isoDate(horizon))[0] || null;
    }

    // Cost per month of a repeating amount (weekly ≈ 52/12 per month).
    const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, yearly: 1 / 12 };
    const monthlyCost = (rec) => num(rec.amount) * (PER_MONTH[rec.frequency] || 1);

    // ------------------------------------------------------------ investments
    // Market value of stock / ETF / fund holdings: shares × last known price.
    const holdingValue = (h) => Math.max(0, num(h.shares)) * Math.max(0, num(h.price));
    const holdingsValue = (holdings) => sum(holdings || [], holdingValue);

    // ------------------------------------------------------------ bills
    // Lines with a due day in a given month: paid once what was spent on the line covers
    // what's planned; otherwise overdue (day passed), due soon (within `soonDays`) or later.
    function billsDue({ items, spend, year, month, today = new Date(), soonDays = 7 }) {
        const t = new Date(today);
        const y = Number(year), m = Number(month);
        const isThisMonth = t.getFullYear() === y && t.getMonth() + 1 === m;
        const isPast = !isThisMonth && new Date(y, m - 1, 1) < new Date(t.getFullYear(), t.getMonth(), 1);
        const lastDay = new Date(y, m, 0).getDate();
        return items.filter(i => Number(i.dueDay) >= 1 && num(i.real) > 0).map(i => {
            const day = Math.min(Number(i.dueDay), lastDay);
            const planned = num(i.real);
            const spent = (spend.byLine[String(i.id)] || { spent: 0 }).spent;
            const paid = spent + 0.005 >= planned;
            const daysLeft = isThisMonth ? day - t.getDate() : isPast ? -1 : 99;
            const status = paid ? 'paid' : daysLeft < 0 ? 'overdue' : daysLeft <= soonDays ? 'soon' : 'later';
            return { item: i, day, planned, spent, remaining: Math.max(0, planned - spent), paid, daysLeft, status };
        }).sort((a, b) => a.day - b.day);
    }

    // How likely this month's plan is to be overspent, from what's spent so far vs. how much
    // of the month has passed: 'low' | 'medium' | 'high' (or 'none' before anything is logged).
    function overspendRisk({ planned, spent, year, month, today = new Date() }) {
        const t = new Date(today);
        const y = Number(year), m = Number(month);
        const days = new Date(y, m, 0).getDate();
        const elapsed = t.getFullYear() === y && t.getMonth() + 1 === m ? t.getDate() / days
            : new Date(y, m - 1, 1) < t ? 1 : 0;
        if (planned <= 0) return { level: spent > 0 ? 'high' : 'none', ratio: 0, pace: 0 };
        const ratio = spent / planned;
        const pace = elapsed > 0 ? ratio / elapsed : ratio > 0 ? Infinity : 0;
        const level = ratio > 1 || (elapsed < 1 && pace > 1.25) ? 'high' : pace > 1 ? 'medium' : spent > 0 ? 'low' : 'none';
        return { level, ratio, pace, elapsed };
    }

    function filterTransactions(transactions, { year = 'all', month = 'all', type = 'all', category = 'all' } = {}) {
        return (transactions || []).filter(t => {
            const d = txnDate(t);
            if (year !== 'all' && d.getFullYear() !== Number(year)) return false;
            if (month !== 'all' && (d.getMonth() + 1) !== Number(month)) return false;
            if (type !== 'all' && txnType(t) !== type) return false;
            if (category !== 'all' && t.parentCategory !== category) return false;
            return true;
        });
    }

    // Income/expense per month, or per year once the data spans more than 24 months.
    function transactionTrend(transactions) {
        const key = (d, yearly) => yearly ? String(d.getFullYear()) : `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        const monthKeys = new Set(transactions.map(t => key(txnDate(t), false)));
        const yearly = monthKeys.size > 24;
        const income = {}, expense = {};
        transactions.forEach(t => {
            const k = key(txnDate(t), yearly);
            const bucket = txnType(t) === 'Ingreso' ? income : expense;
            bucket[k] = (bucket[k] || 0) + num(t.amount);
        });
        const keys = [...new Set([...Object.keys(income), ...Object.keys(expense)])].sort();
        return { yearly, keys, income: keys.map(k => income[k] || 0), expense: keys.map(k => expense[k] || 0) };
    }

    // -------------------------------------------------------------------- debts

    const DEBT_KINDS = [
        { id: 'tarjeta', label: 'Tarjeta de Crédito', netWorthField: 'creditCards' },
        { id: 'vehicular', label: 'Préstamo Vehicular', netWorthField: 'autoLoans' },
        { id: 'personal', label: 'Préstamo Personal', netWorthField: 'personalLoans' },
        { id: 'estudiantil', label: 'Préstamo Estudiantil', netWorthField: 'studentLoans' },
        { id: 'otra', label: 'Otra Deuda', netWorthField: 'otherDebts' }
    ];

    function guessDebtKind(name) {
        const n = (name || '').toLowerCase();
        if (n.includes('tarjeta') || n.includes('crédito') || n.includes('credito')) return 'tarjeta';
        if (n.includes('vehic') || n.includes('auto') || n.includes('carro')) return 'vehicular';
        if (n.includes('estudi') || n.includes('universi') || n.includes('iece')) return 'estudiantil';
        if (n.includes('personal') || n.includes('préstamo') || n.includes('prestamo')) return 'personal';
        return 'otra';
    }

    // Month-by-month payoff funded only by the budget. Each debt receives its own budget line
    // (`monthly`), which pays its minimum first — a minimum is only paid if that debt's line
    // covers it. Whatever a line has above its minimum, plus `extraPool` (other "Pago deuda"
    // rubros), plus the whole line of any debt already paid off, rolls to the debt the strategy
    // targets (snowball: smallest balance; avalanche: highest rate). No money is assumed that
    // the budget doesn't assign. A minimums-only run gives the time/interest the plan saves.
    function debtPayoff(debts, strategy, extraPool) {
        const MAX = 600;
        const line = (d) => Math.max(0, num(d.monthly === undefined || d.monthly === null ? d.minPayment : d.monthly));
        const extra0 = Math.max(0, num(extraPool));
        const open = (debts || []).filter(d => num(d.balance) > 0.01);
        const totalMin = sum(open, d => Math.max(0, num(d.minPayment)));
        const underfunded = open.filter(d => line(d) + 0.005 < Math.max(0, num(d.minPayment))).map(d => ({ id: d.id, missing: Math.max(0, num(d.minPayment)) - line(d) }));
        function run(mode) {
            const items = (debts || []).map(d => ({
                id: d.id,
                balance: Math.max(0, num(d.balance)),
                rate: Math.max(0, num(d.rate)),
                minPayment: Math.max(0, num(d.minPayment)),
                line: mode === 'minimums' ? Math.max(0, num(d.minPayment)) : line(d),
                payoffMonth: null
            }));
            if (strategy === 'avalanche') items.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
            else items.sort((a, b) => a.balance - b.balance);

            let month = 0, totalInterest = 0;
            while (items.some(d => d.balance > 0.01) && month < MAX) {
                month++;
                items.forEach(d => {
                    if (d.balance <= 0) return;
                    const interest = d.balance * d.rate / 1200;
                    d.balance += interest;
                    totalInterest += interest;
                });
                let pool = mode === 'minimums' ? 0 : extra0;
                items.forEach(d => {
                    if (d.balance <= 0) { if (mode !== 'minimums') pool += d.line; return; }
                    const own = Math.min(d.line, d.minPayment);
                    const pay = Math.min(own, d.balance);
                    d.balance -= pay;
                    if (mode !== 'minimums') pool += (d.line - own) + (own - pay);
                });
                for (const d of items) {
                    if (pool <= 0) break;
                    const pay = Math.min(pool, d.balance);
                    d.balance -= pay;
                    pool -= pay;
                }
                items.forEach(d => {
                    if (d.balance <= 0.01) {
                        d.balance = 0;
                        if (d.payoffMonth === null) d.payoffMonth = month;
                    }
                });
            }
            items.forEach((d, idx) => { d.order = idx + 1; });
            return { items, months: month, totalInterest, never: month >= MAX && items.some(d => d.balance > 0.01) };
        }
        const plan = run('plan');
        const minimums = run('minimums');
        const pool = extra0 + sum(open, line);
        return {
            items: plan.items,
            months: plan.months,
            never: plan.never,
            totalInterest: plan.totalInterest,
            totalBalance: sum(debts || [], d => Math.max(0, num(d.balance))),
            pool,
            totalMin,
            underfunded,
            shortfall: sum(underfunded, u => u.missing),
            extra: Math.max(0, pool - (totalMin - sum(underfunded, u => u.missing))),
            minimumsNever: minimums.never,
            monthsSaved: minimums.never ? 0 : Math.max(0, minimums.months - plan.months),
            interestSaved: minimums.never ? 0 : Math.max(0, minimums.totalInterest - plan.totalInterest)
        };
    }

    function addMonths(date, months) {
        const d = new Date(date || Date.now());
        return new Date(d.getFullYear(), d.getMonth() + months, 1);
    }

    // -------------------------------------------------------------------- goals

    // Months to reach a savings goal with monthly contributions earning DPF interest (NPER).
    function goalMonths(goal) {
        const target = num(goal.target), current = num(goal.current), monthly = num(goal.monthly);
        if (current >= target) return { status: 'reached', months: 0 };
        const r = num(goal.rate) / 1200;
        if (r === 0) {
            return monthly > 0 ? { status: 'ok', months: Math.ceil((target - current) / monthly) } : { status: 'never', months: null };
        }
        if (monthly + current * r <= 0) return { status: 'never', months: null };
        const months = Math.log((target * r + monthly) / (current * r + monthly)) / Math.log(1 + r);
        return Number.isFinite(months) ? { status: 'ok', months: Math.ceil(months) } : { status: 'never', months: null };
    }

    // Monthly amount needed to reach a goal by its target date (with the DPF rate), and
    // whether what's budgeted keeps it on track: { months, required, onTrack, gap }.
    function goalSchedule(goal, today) {
        const target = num(goal.target), current = num(goal.current), monthly = num(goal.monthly);
        if (!goal.targetDate) return null;
        const t = new Date(today);
        const [y, m] = String(goal.targetDate).split('-').map(Number);
        const months = Math.max(0, (y - t.getFullYear()) * 12 + (m - 1 - t.getMonth()));
        const remaining = Math.max(0, target - current);
        if (remaining <= 0) return { months, required: 0, onTrack: true, gap: 0 };
        if (months === 0) return { months, required: remaining, onTrack: false, gap: remaining };
        const r = num(goal.rate) / 1200;
        const grown = current * Math.pow(1 + r, months);
        const need = Math.max(0, target - grown);
        const required = r === 0 ? need / months : need * r / (Math.pow(1 + r, months) - 1);
        return { months, required, onTrack: monthly + 0.005 >= required, gap: Math.max(0, required - monthly) };
    }

    // ----------------------------------------------------------------- mortgage

    function frenchPayment(principal, annualRatePct, months) {
        const i = annualRatePct / 1200;
        return i === 0 ? principal / months : principal * i / (1 - Math.pow(1 + i, -months));
    }

    // One routine for both systems, with or without a monthly extra toward principal
    // (which ends the loan early instead of running the full contracted term).
    function amortization(system, principal, annualRatePct, months, extraMonthly) {
        principal = Math.max(0, num(principal));
        months = Math.max(1, Math.round(num(months)));
        const extra = Math.max(0, num(extraMonthly));
        const i = Math.max(0, num(annualRatePct)) / 1200;
        const fixedPayment = frenchPayment(principal, num(annualRatePct), months);
        const fixedPrincipal = principal / months;
        const schedule = [];
        let balance = principal, totalInterest = 0, period = 0;
        while (balance > 0.005 && period < months) {
            period++;
            const interest = balance * i;
            let principalPortion = (system === 'aleman' ? fixedPrincipal : fixedPayment - interest) + extra;
            if (principalPortion > balance || period === months) principalPortion = balance;
            balance -= principalPortion;
            totalInterest += interest;
            schedule.push({ period, payment: principalPortion + interest, interest, principal: principalPortion, balance: Math.max(0, balance) });
        }
        return {
            schedule,
            months: period,
            totalInterest,
            totalPaid: principal + totalInterest,
            firstPayment: schedule.length ? schedule[0].payment : 0,
            lastPayment: schedule.length ? schedule[schedule.length - 1].payment : 0
        };
    }

    // Long schedules read better by year: sample whole-year marks, plus a final partial year.
    function yearMarks(totalMonths) {
        const marks = [];
        for (let m = 12; m <= totalMonths; m += 12) marks.push(m);
        if (totalMonths % 12 !== 0) marks.push(totalMonths);
        return marks;
    }

    function chartAxis(scheduleLength) {
        if (scheduleLength > 24) {
            const marks = yearMarks(scheduleLength);
            return { yearly: true, marks, labels: marks.map(m => m % 12 === 0 ? `Año ${m / 12}` : `Año ${Math.floor(m / 12)}+${m % 12}m`), title: 'Años del Préstamo' };
        }
        const marks = Array.from({ length: scheduleLength }, (_, k) => k + 1);
        return { yearly: false, marks, labels: marks.map(m => `Mes ${m}`), title: 'Meses del Préstamo' };
    }

    // Value of `field` at each axis mark; undefined past the end of a shorter schedule.
    function sampleSchedule(schedule, axis, field, cumulative) {
        let running = 0;
        const series = schedule.map(s => (cumulative ? (running += s[field]) : s[field]));
        return axis.marks.map(m => (m > series.length ? undefined : series[m - 1]));
    }

    // --------------------------------------------------------------- retirement

    function futureValue(present, monthly, annualRatePct, months) {
        const r = num(annualRatePct) / 1200;
        if (r === 0) return num(present) + num(monthly) * months;
        const g = Math.pow(1 + r, months);
        return num(present) * g + num(monthly) * (g - 1) / r;
    }

    // Simplified IESS pension: salary × replacement rate, scaled down proportionally when
    // the total career (years already + years until retirement) is under 30 years.
    function pension({ sueldoPromedio, tasaReemplazo, aniosAportados, aniosRestantes }) {
        const career = num(aniosAportados) + num(aniosRestantes);
        const factor = Math.min(1, career / 30);
        return num(sueldoPromedio) * Math.min(100, Math.max(0, num(tasaReemplazo))) / 100 * factor;
    }

    function retirement(inp) {
        const edadActual = Math.max(0, Math.round(num(inp.edadActual)));
        const edadJubilacion = Math.max(edadActual, Math.round(num(inp.edadJubilacion)) || 65);
        const anios = edadJubilacion - edadActual;
        const months = anios * 12;
        const rate = Math.max(0, num(inp.tasaRetorno));
        const schedule = (monthly) => {
            const out = [];
            for (let m = 0; m <= months; m += 12) out.push(futureValue(inp.ahorroActual, monthly, rate, m));
            return out;
        };
        const aporte = Math.max(0, num(inp.aporteMensual));
        const extra = Math.max(0, num(inp.whatIfExtra));
        const withdraw = Math.max(0, num(inp.tasaRetiroSegura)) / 100;
        const pensionM = pension({ ...inp, aniosRestantes: anios });

        const base = schedule(aporte);
        const valorFuturo = base[base.length - 1];
        const ingresoAhorro = valorFuturo * withdraw / 12;
        const result = {
            edadActual, edadJubilacion, aniosRestantes: anios,
            valorFuturo, ingresoAhorro, pension: pensionM, ingresoTotal: ingresoAhorro + pensionM,
            schedule: base, whatIf: null
        };
        if (extra > 0) {
            const alt = schedule(aporte + extra);
            const altFinal = alt[alt.length - 1];
            const altIngreso = altFinal * withdraw / 12 + pensionM;
            result.whatIf = { extra, schedule: alt, valorFuturo: altFinal, gain: altFinal - valorFuturo, ingresoTotal: altIngreso, deltaIngreso: altIngreso - result.ingresoTotal };
        }
        return result;
    }

    // ---------------------------------------------------------------- net worth

    const NET_WORTH_FIELDS = ['checking', 'savings', 'investments', 'mortgage', 'autoLoans', 'creditCards', 'personalLoans', 'studentLoans', 'otherDebts'];
    const NW_ASSET_FIELDS = ['checking', 'savings', 'investments'];
    const NW_LIABILITY_FIELDS = ['mortgage', 'autoLoans', 'creditCards', 'personalLoans', 'studentLoans', 'otherDebts'];
    const ASSET_CATEGORIES = ['Bienes Raíces', 'Vehículo', 'Otro'];

    // A balance holds its value year after year until explicitly edited for a later year:
    // read the closest touched year at or before `year`.
    // The year a carried-forward balance was last explicitly set (null = never set).
    function netWorthSource(years, year, field) {
        let best = null;
        Object.keys(years || {}).forEach(k => {
            const y = Number(k), yd = years[k];
            if (y <= year && yd && yd.netWorth && yd.netWorthTouched && yd.netWorthTouched[field] && (best === null || y > best)) best = y;
        });
        return best;
    }

    function netWorthField(years, year, field) {
        const src = netWorthSource(years, year, field);
        return src === null ? 0 : num(years[src].netWorth[field]);
    }

    function netWorthSnapshot(years, year) {
        const nw = {};
        NET_WORTH_FIELDS.forEach(f => { nw[f] = netWorthField(years, year, f); });
        return nw;
    }

    function assetValue(asset, year) {
        const ys = Object.keys(asset.valuesByYear || {}).map(Number).filter(y => y <= year);
        return ys.length ? num(asset.valuesByYear[Math.max(...ys)]) : num(asset.purchaseValue);
    }

    function assetOwned(asset, year) {
        if (year < num(asset.purchaseYear)) return false;
        if (asset.status !== 'Vendido') return true;
        return asset.saleYear === null || asset.saleYear === undefined || year < asset.saleYear;
    }

    function assetsByCategory(assets, year) {
        const out = {};
        ASSET_CATEGORIES.forEach(c => { out[c] = 0; });
        (assets || []).forEach(a => {
            if (assetOwned(a, year)) out[a.category] = (out[a.category] || 0) + assetValue(a, year);
        });
        return out;
    }

    function netWorth(years, assets, year) {
        const nw = netWorthSnapshot(years, year);
        const registry = assetsByCategory(assets, year);
        const assetsTotal = sum(NW_ASSET_FIELDS, f => nw[f]) + sum(Object.keys(registry), c => registry[c]);
        const liabilities = sum(NW_LIABILITY_FIELDS, f => nw[f]);
        return { fields: nw, registry, assets: assetsTotal, liabilities, value: assetsTotal - liabilities };
    }

    // ---------------------------------------------------- emergency fund & steps

    function emergencyFund({ liquid, budgetBase }) {
        const monthlyEssential = sum((budgetBase || []).filter(isEssentialItem), i => num(i.real));
        const monthsCovered = monthlyEssential > 0 ? liquid / monthlyEssential : 0;
        return {
            liquid,
            monthlyEssential,
            monthsCovered,
            step1Pct: Math.min(100, liquid / 1000 * 100),
            step3Pct: Math.min(100, monthsCovered / 6 * 100)
        };
    }

    // Dave Ramsey's Baby Steps, evaluated against the user's own data. Steps 4-6 are worked
    // on at the same time once the emergency fund is full, as Ramsey prescribes.
    function babySteps({ liquid, consumerDebt, monthsCovered, savingsRate, mortgageBalance }) {
        const steps = [
            { n: 1, title: 'Fondo de Emergencia Inicial', done: liquid >= 1000, detail: `${Math.min(100, liquid / 10).toFixed(0)}% de $1,000` },
            { n: 2, title: 'Pagar Deudas de Consumo', done: consumerDebt <= 0.01, detail: consumerDebt > 0.01 ? `Quedan $${consumerDebt.toFixed(0)}` : 'Sin deudas' },
            { n: 3, title: 'Fondo de Emergencia Pleno', done: monthsCovered >= 3, detail: `${monthsCovered.toFixed(1)} de 3-6 meses` },
            { n: 4, title: 'Invertir 15% para el Retiro', done: savingsRate >= 0.15, detail: `Ahorras ${(savingsRate * 100).toFixed(0)}% de tu sueldo` },
            { n: 5, title: 'Educación de los Hijos', done: null, detail: 'Opcional — usa una Meta de ahorro' },
            { n: 6, title: 'Pagar la Hipoteca', done: mortgageBalance <= 0.01, detail: mortgageBalance > 0.01 ? `Saldo $${mortgageBalance.toFixed(0)}` : 'Sin hipoteca' },
            { n: 7, title: 'Construir Riqueza y Dar', done: null, detail: 'Libertad financiera' }
        ];
        let current;
        if (!steps[0].done) current = 1;
        else if (!steps[1].done) current = 2;
        else if (!steps[2].done) current = 3;
        else if (!steps[3].done || !steps[5].done) current = 4;
        else current = 7;
        steps.forEach(s => {
            s.state = s.done === true ? 'done' : (s.n === current || (current === 4 && s.n >= 4 && s.n <= 6) ? 'current' : 'pending');
        });
        return { steps, current };
    }

    const Engine = {
        MONTHS, MODALITIES, DEBT_KINDS, NET_WORTH_FIELDS, NW_ASSET_FIELDS, NW_LIABILITY_FIELDS, ASSET_CATEGORIES,
        num, monthItems, isSavingsItem, isEssentialItem, annualDeductibles,
        occurrences, dueOccurrences, nextOccurrence, monthlyCost,
        goalSchedule, monthSpendCurve, categoryBreakdown, cashFlow, nextPayday, dailyAllowance, monthInsights, memberTotals,
        holdingValue, holdingsValue, lineSpend, periodStart, periodSeries, billsDue, overspendRisk, isoDate,
        incomeTax, sriCap, payroll, d4Month, bonusForMonth, PAYROLL_SUBCATEGORIES, isPayrollTxn, receivedIncome, otherIncome, monthBudget, annualBudget,
        polizaInterest, polizasCapital, maturityStatus, cosedeCheck, projectDPF, balanceAtYear, incomeExpenseSeries,
        monthsElapsed, categorySpend, categoryTarget, spendStatus, budgetVsActualByMonth, filterTransactions, transactionTrend,
        guessDebtKind, debtPayoff, addMonths, goalMonths,
        frenchPayment, amortization, yearMarks, chartAxis, sampleSchedule,
        futureValue, pension, retirement,
        netWorthSource, netWorthField, netWorthSnapshot, assetValue, assetOwned, assetsByCategory, netWorth,
        emergencyFund, babySteps
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    else root.Engine = Engine;
})(this);
