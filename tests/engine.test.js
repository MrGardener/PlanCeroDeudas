// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const D = require('../js/defaults.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const year = (overrides = {}) => Object.assign(D.newYear(), overrides);

test('income tax follows the 2026 SRI table (9 brackets up to 37%)', () => {
    const b = D.sriBrackets();
    assert.equal(b.length, 10);
    assert.equal(E.incomeTax(12000, b), 0);
    close(E.incomeTax(15549, b), (15549 - 12208) * 0.05);
    close(E.incomeTax(32598, b), 1412 + (32598 - 26700) * 0.15);
    close(E.incomeTax(120000, b), 24572 + (120000 - 109956) * 0.37);
    // Each bracket's base tax is the tax at its start.
    for (let i = 1; i < b.length; i++) close(b[i].baseTax, b[i - 1].baseTax + (b[i].min - b[i - 1].min) * b[i - 1].rate, 1);
});

test('payroll (Ecuador, since 2023): personal expenses give an 18% rebate, capped by cargas', () => {
    // $3,000/month, all deductible expenses well above the cap, no dependents.
    const yd = year({ sueldo: 3000 });
    yd.budgetBase = [{ id: 1, name: 'Vivienda', type: 'Gasto Fijo', isDeductible: true, prep: 900, real: 900 }];
    const p = E.payroll(yd);
    close(p.iessM, 283.5);
    close(p.baseImponible, (3000 - 283.5) * 12);           // expenses no longer lower the base
    close(p.isrBruto, 1412 + (32598 - 26700) * 0.15);       // 2,296.70
    close(p.sriCap, 821.80 * 7);                            // 5,752.60
    close(p.rebaja, 821.80 * 7 * 0.18);                     // 1,035.47
    close(p.isrAnual, 2296.70 - 1035.468);
    close(p.netoM, 3000 - 283.5 - p.isrAnual / 12);
    // More dependents raise the cap: 3 cargas = 14 canastas.
    close(E.payroll(Object.assign({}, yd, { cargas: 3 })).sriCap, 821.80 * 14);
    close(E.payroll(Object.assign({}, yd, { cargas: 'cat' })).sriCap, 821.80 * 20);
});

test('the rebate never makes the tax negative, and says how much room is left', () => {
    const low = year({ sueldo: 1500 });
    low.budgetBase = [{ id: 1, name: 'Salud', type: 'Gasto Fijo', isDeductible: true, prep: 600, real: 600 }];
    const p = E.payroll(low);
    assert.equal(p.isrAnual, 0);
    assert.equal(p.rebajaRoom, 0);
    const hi = year({ sueldo: 10000 });
    hi.budgetBase = [{ id: 1, name: 'Salud', type: 'Gasto Fijo', isDeductible: true, prep: 100, real: 100 }];
    const q = E.payroll(hi);
    close(q.rebaja, 1200 * 0.18);
    close(q.rebajaRoom, 821.80 * 7 * 0.18 - 1200 * 0.18);
});

test('saved years before "cargas" keep their old cap multiplier', () => {
    const p = E.payroll(year({ sueldo: 3000, cargas: null, sriCapMultiplier: 0 }));
    assert.equal(p.sriCap, 0);
    assert.equal(p.dedApplied, 0);
});

test('décimos are paid only in their month and region', () => {
    const coast = year({ sueldo: 1000, d3: true, d4: true, d4Region: 'costa', sbu: 470 });
    assert.equal(E.bonusForMonth(coast, '12'), 1000);
    assert.equal(E.bonusForMonth(coast, '3'), 470);
    assert.equal(E.bonusForMonth(coast, '8'), 0);
    assert.equal(E.bonusForMonth(coast, 'base'), 0);
    const sierra = year({ d4: true, d4Region: 'sierra', sbu: 470 });
    assert.equal(E.bonusForMonth(sierra, '8'), 470);
    assert.equal(E.bonusForMonth(sierra, '3'), 0);
});

test('month overrides replace the base budget only for that month', () => {
    const yd = year();
    yd.monthOverrides['5'] = [{ id: 1, name: 'x', type: 'Gasto Fijo', prep: 10, real: 20 }];
    assert.equal(E.monthItems(yd, '5').length, 1);
    assert.equal(E.monthItems(yd, '6'), yd.budgetBase);
    assert.equal(E.monthItems(yd, 'base'), yd.budgetBase);
});

test('auto-sweep is derived: surplus goes to savings without touching typed values', () => {
    const yd = year({ sueldo: 3000, sweepSavings: true });
    const before = JSON.stringify(yd.budgetBase);
    const mb = E.monthBudget(yd, 'base');
    assert.ok(mb.sweep > 0);
    close(mb.balanceReal, 0);
    assert.equal(JSON.stringify(yd.budgetBase), before);
    // No sweep when spending exceeds income — the deficit stays visible.
    const tight = year({ sueldo: 500, sweepSavings: true });
    const t = E.monthBudget(tight, 'base');
    assert.equal(t.sweep, 0);
    assert.ok(t.balanceReal < 0);
});

test('annual budget includes décimo months', () => {
    const plain = E.annualBudget(year({ sueldo: 1500 }));
    const withD3 = E.annualBudget(year({ sueldo: 1500, d3: true }));
    close(withD3.income - plain.income, 1500);
});

test('deductibles respect base×12 vs month-by-month mode', () => {
    const yd = year();
    yd.monthOverrides['1'] = yd.budgetBase.map(i => ({ ...i, real: i.isDeductible ? 0 : i.real }));
    const base12 = E.annualDeductibles(yd);
    const sum12 = E.annualDeductibles({ ...yd, annualMode: 'sum12' });
    assert.ok(sum12.real < base12.real);
});

test('póliza interest: simple vs compound', () => {
    close(E.polizaInterest({ amount: 1000, rate: 10, days: 360, modality: 'Al Vencimiento (Simple)' }), 100);
    close(E.polizaInterest({ amount: 1000, rate: 12, days: 360, modality: 'Mensual (Compuesto)' }), 1000 * (Math.pow(1.01, 12) - 1));
});

test('COSEDE flags a cooperativa over its limit', () => {
    const coops = [{ name: 'A', cosedeMax: 32000 }];
    const res = E.cosedeCheck([{ coopName: 'A', amount: 20000 }, { coopName: 'A', amount: 15000 }, { coopName: 'B', amount: 100 }], coops, 32000);
    assert.equal(res.find(r => r.name === 'A').exceeded, true);
    assert.equal(res.find(r => r.name === 'B').exceeded, false);
});

test('DPF projection starts from registered pólizas, not invented past savings', () => {
    const getYear = () => year({ tasa: 10 });
    const proj = E.projectDPF({ polizas: [{ amount: 5000 }], startYear: 2026, endYear: 2027, getYear });
    assert.equal(proj.opening, 5000);
    const c = E.annualBudget(getYear()).savingsReal;
    close(proj.rows[0].balance, 5000 + c + 5000 * 0.1 + c * 0.1 * 0.5);
    assert.equal(proj.rows.length, 2);
});

test('months elapsed for budget-to-date comparisons', () => {
    const today = new Date(2026, 8, 26);
    assert.equal(E.monthsElapsed(2025, today), 12);
    assert.equal(E.monthsElapsed(2026, today), 9);
    assert.equal(E.monthsElapsed(2027, today), 0);
    assert.equal(E.categoryTarget({ prep: 100 }, 2026, 'base', today), 900);
    assert.equal(E.categoryTarget({ prep: 100 }, 2026, '3', today), 100);
});

test('spend status classification', () => {
    assert.equal(E.spendStatus(null, 100).kind, 'unlinked');
    assert.equal(E.spendStatus(0, 100).kind, 'untouched');
    assert.equal(E.spendStatus(50, 100).kind, 'ok');
    assert.equal(E.spendStatus(85, 100).kind, 'warning');
    assert.equal(E.spendStatus(120, 100).kind, 'over');
    assert.equal(E.spendStatus(5, 0).kind, 'unbudgeted');
});

test('transaction trend switches to yearly buckets past 24 months', () => {
    const txns = [];
    for (let i = 0; i < 30; i++) txns.push({ type: 'Gasto', amount: 10, date: `${2020 + Math.floor(i / 12)}-${String(i % 12 + 1).padStart(2, '0')}-10` });
    const t = E.transactionTrend(txns);
    assert.equal(t.yearly, true);
    assert.deepEqual(t.keys, ['2020', '2021', '2022']);
    const monthly = E.transactionTrend(txns.slice(0, 3));
    assert.equal(monthly.yearly, false);
    assert.equal(monthly.keys.length, 3);
});

test('debt plan: each debt gets its own budget line; only money above minimums rolls', () => {
    const debts = [{ id: 1, balance: 5000, rate: 10, minPayment: 100, monthly: 100 }, { id: 2, balance: 500, rate: 30, minPayment: 50, monthly: 250 }];
    const snow = E.debtPayoff(debts, 'snowball', 0);
    assert.equal(snow.items[0].id, 2);
    assert.equal(snow.pool, 350);
    assert.equal(snow.totalMin, 150);
    assert.equal(snow.extra, 200);
    assert.equal(snow.shortfall, 0);
    assert.ok(snow.monthsSaved > 0 && snow.interestSaved > 0);
    // Other "Pago deuda" rubros add to the snowball.
    assert.ok(E.debtPayoff(debts, 'snowball', 100).months < snow.months);
    // A line below its own minimum is flagged even if another line has surplus.
    const short = E.debtPayoff([{ ...debts[0], monthly: 60 }, { ...debts[1], monthly: 400 }], 'snowball', 0);
    assert.equal(short.shortfall, 40);
    assert.deepEqual(short.underfunded.map(u => u.id), [1]);
    // Nothing budgeted: never paid.
    assert.equal(E.debtPayoff([{ id: 1, balance: 1000, rate: 20, minPayment: 50, monthly: 0 }], 'snowball', 0).never, true);
    // Missing `monthly` (old data) falls back to the minimum.
    assert.equal(E.debtPayoff([{ id: 1, balance: 1000, rate: 20, minPayment: 50 }], 'snowball', 0).pool, 50);
});

test('debt kinds map names to net worth liabilities', () => {
    assert.equal(E.guessDebtKind('Tarjeta de Crédito'), 'tarjeta');
    assert.equal(E.guessDebtKind('Préstamo Vehicular'), 'vehicular');
    assert.equal(E.guessDebtKind('Préstamo a mi primo'), 'personal');
    assert.equal(E.guessDebtKind('Otra cosa'), 'otra');
});

test('goal NPER handles reached goals, 0% rate and impossible goals', () => {
    assert.equal(E.goalMonths({ target: 1000, current: 1500, monthly: 50, rate: 8 }).status, 'reached');
    assert.deepEqual(E.goalMonths({ target: 1000, current: 0, monthly: 100, rate: 0 }), { status: 'ok', months: 10 });
    assert.equal(E.goalMonths({ target: 1000, current: 0, monthly: 0, rate: 8 }).status, 'never');
    assert.equal(E.goalMonths({ target: 20000, current: 2000, monthly: 0, rate: 8.5 }).status, 'never');   // interest alone isn't a plan
    const g = E.goalMonths({ target: 5000, current: 1000, monthly: 300, rate: 8.5 });
    assert.equal(g.status, 'ok');
    assert.ok(g.months > 0 && g.months < (4000 / 300) + 1);
});

test('amortization: French and German both repay the principal; German pays less interest', () => {
    const fr = E.amortization('frances', 80000, 10.5, 240, 0);
    const al = E.amortization('aleman', 80000, 10.5, 240, 0);
    assert.equal(fr.schedule.length, 240);
    close(fr.schedule.reduce((s, r) => s + r.principal, 0), 80000);
    close(al.schedule.reduce((s, r) => s + r.principal, 0), 80000);
    close(fr.schedule[fr.schedule.length - 1].balance, 0);
    assert.ok(al.totalInterest < fr.totalInterest);
    close(fr.firstPayment, E.frenchPayment(80000, 10.5, 240));
    const extra = E.amortization('frances', 80000, 10.5, 240, 300);
    assert.ok(extra.months < 240 && extra.totalInterest < fr.totalInterest);
});

test('chart axis resamples long schedules by year', () => {
    const axis = E.chartAxis(30);
    assert.deepEqual(axis.marks, [12, 24, 30]);
    assert.deepEqual(axis.labels, ['Year 1', 'Year 2', 'Year 2+6m']);
    const s = [{ v: 1 }, { v: 2 }, { v: 3 }];
    assert.deepEqual(E.sampleSchedule(s, { marks: [1, 3, 5] }, 'v', true), [1, 6, undefined]);
});

test('retirement: future value, pension scaling, what-if', () => {
    close(E.futureValue(1000, 0, 12, 12), 1000 * Math.pow(1.01, 12));
    close(E.futureValue(0, 100, 0, 12), 1200);
    close(E.pension({ sueldoPromedio: 1000, tasaReemplazo: 60, aniosAportados: 5, aniosRestantes: 10 }), 1000 * 0.6 * 0.5);
    const r = E.retirement({ edadActual: 30, edadJubilacion: 65, ahorroActual: 1000, aporteMensual: 100, tasaRetorno: 8, tasaRetiroSegura: 4, sueldoPromedio: 1500, tasaReemplazo: 60, aniosAportados: 5, whatIfExtra: 50 });
    assert.equal(r.aniosRestantes, 35);
    assert.equal(r.schedule.length, 36);
    assert.ok(r.whatIf.gain > 0 && r.whatIf.deltaIngreso > 0);
    close(r.ingresoTotal, r.ingresoAhorro + r.pension);
});

test('net worth carries balances forward until edited', () => {
    const years = {
        2024: { netWorth: { checking: 1000 }, netWorthTouched: { checking: true } },
        2025: { netWorth: { checking: 0 }, netWorthTouched: {} },
        2027: { netWorth: { checking: 5000 }, netWorthTouched: { checking: true } }
    };
    assert.equal(E.netWorthField(years, 2023, 'checking'), 0);
    assert.equal(E.netWorthField(years, 2026, 'checking'), 1000);
    assert.equal(E.netWorthField(years, 2030, 'checking'), 5000);
});

test('assets count only between purchase and sale', () => {
    const house = { category: 'Bienes Raíces', purchaseYear: 2025, purchaseValue: 100000, status: 'Vendido', saleYear: 2028, valuesByYear: { 2027: 110000 } };
    assert.equal(E.assetOwned(house, 2024), false);
    assert.equal(E.assetOwned(house, 2025), true);
    assert.equal(E.assetOwned(house, 2028), false);
    assert.equal(E.assetValue(house, 2026), 100000);
    assert.equal(E.assetValue(house, 2027), 110000);
    const nw = E.netWorth({}, [house], 2027);
    assert.equal(nw.value, 110000);
});

test('baby steps pick the first unfinished step', () => {
    const base = { liquid: 500, consumerDebt: 7500, monthsCovered: 0.5, savingsRate: 0.05, mortgageBalance: 0 };
    assert.equal(E.babySteps(base).current, 1);
    assert.equal(E.babySteps({ ...base, liquid: 1200 }).current, 2);
    assert.equal(E.babySteps({ ...base, liquid: 1200, consumerDebt: 0 }).current, 3);
    assert.equal(E.babySteps({ ...base, liquid: 9000, consumerDebt: 0, monthsCovered: 4 }).current, 4);
    assert.equal(E.babySteps({ ...base, liquid: 9000, consumerDebt: 0, monthsCovered: 4, savingsRate: 0.2 }).current, 7);
});

test('other income: recurring sources, logged income and the salary are each counted once', () => {
    const txns = [
        { type: 'Ingreso', parentCategory: 'Ingresos Independientes', category: 'Ventas de Negocio Propio', amount: 120, date: '2026-09-05' },
        { type: 'Ingreso', parentCategory: 'Remesas del Exterior', category: 'Remesa Familiar (EE.UU.)', amount: 200, date: '2026-09-10', incomeId: 1 },
        { type: 'Ingreso', parentCategory: 'Ingresos Laborales', category: 'Sueldo/Salario', amount: 814.95, date: '2026-09-30' },
        { type: 'Gasto', parentCategory: 'Alimentación', category: 'Mercado', amount: 50, date: '2026-09-02' },
        { type: 'Ingreso', parentCategory: 'Ingresos Independientes', category: 'Freelance/Consultoría', amount: 999, date: '2025-09-05' }
    ];
    const received = E.receivedIncome(txns, 2026);
    assert.equal(received['9'].txns.length, 2);
    assert.equal(received['9'].payroll.length, 1);  // the salary itself isn't added again

    const yd = year({ sueldo: 900, otherIncomes: [{ id: 1, name: 'Remesa', amount: 150, category: 'Remesas del Exterior' }], receivedIncome: received });
    const neto = E.payroll(yd).netoM;
    // Base budget: salary + planned recurring income.
    close(E.monthBudget(yd, 'base').income, neto + 150);
    // September: remesa linked to its line, received 200 (> 150 planned, counted once) + unplanned 120.
    const sep = E.monthBudget(yd, '9');
    close(sep.income, neto + 200 + 120);
    close(sep.incomePrep, neto + 150);
    const other = E.otherIncome(yd, '9');
    assert.deepEqual(other.unplanned.map(u => [u.category, u.amount, u.txns.length]), [['Ingresos Independientes', 120, 1]]);
    assert.equal(other.sources[0].received, 200);
    close(other.extraReceived, 170);
    // A line never takes income just because it shares the category (the reported bug):
    // a line on "Ingresos Independientes" leaves the helados sale as its own extra income.
    const cat = Object.assign({}, yd, { otherIncomes: yd.otherIncomes.concat([{ id: 2, name: 'Horas Extras', amount: 50, category: 'Ingresos Independientes' }]) });
    const o2 = E.otherIncome(cat, '9');
    assert.equal(o2.sources[1].received, 0);
    assert.equal(o2.unplanned.length, 1);
    close(o2.total, other.total + 50);
    // Income linked to a line that was deleted is still counted, as extra income.
    const orphan = Object.assign({}, yd, { otherIncomes: [] });
    close(E.otherIncome(orphan, '9').total, 320);
    // A month with nothing logged still counts the planned income.
    close(E.monthBudget(yd, '10').income, neto + 150);
    // Logged extra income is swept to savings when the sweep is on.
    const swept = E.monthBudget(Object.assign({}, yd, { sweepSavings: true }), '9');
    assert.ok(swept.sweep > 0);
    close(swept.balanceReal, 0);
    // Marking a salary-labelled income as extra adds it.
    txns[2].countAsExtra = true;
    assert.equal(E.receivedIncome(txns, 2026)['9'].payroll.length, 0);
});

test('line spend: explicit assignment first, then the first line of the category, never twice', () => {
    const items = [
        { id: 1, name: 'Arriendo', linkedCategory: 'Vivienda', real: 350 },
        { id: 2, name: 'Alícuotas', linkedCategory: 'Vivienda', real: 50 },
        { id: 'debt-1', name: 'Tarjeta', linkedCategory: 'Deudas', real: 80 }
    ];
    const txns = [
        { id: 1, type: 'Gasto', parentCategory: 'Vivienda', amount: 350, date: '2026-09-05' },
        { id: 2, type: 'Gasto', parentCategory: 'Vivienda', amount: 50, date: '2026-09-06', budgetLine: '2' },
        { id: 3, type: 'Gasto', parentCategory: 'Otros', amount: 20, date: '2026-09-07' },
        { id: 4, type: 'Gasto', parentCategory: 'Otros', amount: 80, date: '2026-09-08', budgetLine: 'debt-1' },
        { id: 5, type: 'Gasto', parentCategory: 'Vivienda', amount: 99, date: '2026-08-05' },
        { id: 6, type: 'Ingreso', parentCategory: 'Vivienda', amount: 999, date: '2026-09-05' },
        { id: 7, type: 'Gasto', parentCategory: 'Vivienda', amount: 5, date: '2026-09-09', budgetLine: 'gone' }
    ];
    const s = E.lineSpend(items, txns, 2026, '9');
    assert.equal(s.byLine['1'].spent, 355);        // by category + an assignment to a line that no longer exists
    assert.equal(s.byLine['2'].spent, 50);         // only what was assigned to it: no double count
    assert.equal(s.byLine['debt-1'].spent, 80);
    assert.deepEqual(s.unassigned.map(t => t.id), [3]);
    assert.equal(E.lineSpend(items, txns, 2026, 'base').byLine['1'].spent, 355 + 99);  // year to date
});

test('trend series: every week/month/year in the window, income and expenses apart', () => {
    const txns = [
        { type: 'Gasto', amount: 10, date: '2026-09-29', parentCategory: 'A' },   // Tuesday
        { type: 'Gasto', amount: 5, date: '2026-09-28', parentCategory: 'B' },    // Monday, same week
        { type: 'Ingreso', amount: 100, date: '2026-09-15', parentCategory: 'A' },
        { type: 'Gasto', amount: 7, date: '2025-02-01', parentCategory: 'A' }
    ];
    const end = new Date(2026, 8, 30);
    const weeks = E.periodSeries(txns, { period: 'week', count: 4, end });
    assert.equal(weeks.length, 4);
    assert.equal(weeks[3].start, '2026-09-28');
    assert.equal(weeks[3].expense, 15);
    assert.equal(weeks[1].income, 100);
    const months = E.periodSeries(txns, { period: 'month', count: 12, end, category: 'A' });
    assert.equal(months[11].expense, 10);
    assert.equal(months[0].start, '2025-10-01');
    const years = E.periodSeries(txns, { period: 'year', count: 3, end });
    assert.deepEqual(years.map(r => r.expense), [0, 7, 15]);
});

test('bills: paid when the line is covered, otherwise overdue / due soon / later', () => {
    const items = [
        { id: 1, name: 'Arriendo', real: 350, dueDay: 5 },
        { id: 2, name: 'Internet', real: 35, dueDay: 12 },
        { id: 3, name: 'Luz', real: 30, dueDay: 25 },
        { id: 4, name: 'Sin fecha', real: 10 },
        { id: 5, name: 'Febrero 31', real: 10, dueDay: 31 }
    ];
    const spend = { byLine: { 1: { spent: 350 }, 2: { spent: 10 } } };
    const b = E.billsDue({ items, spend, year: 2026, month: '9', today: new Date(2026, 8, 14) });
    const by = Object.fromEntries(b.map(x => [x.item.name, x]));
    assert.equal(by.Arriendo.status, 'paid');
    assert.equal(by.Internet.status, 'overdue');
    assert.equal(by.Internet.remaining, 25);
    assert.equal(by.Luz.status, 'later');
    assert.equal(by['Febrero 31'].day, 30);          // clamped to the month's last day
    assert.ok(!by['Sin fecha']);
    const soon = E.billsDue({ items, spend, year: 2026, month: '9', today: new Date(2026, 8, 20) });
    assert.equal(soon.find(x => x.item.name === 'Luz').status, 'soon');
});

test('overspending risk compares spending pace with the month elapsed', () => {
    const at = (day) => new Date(2026, 8, day);
    assert.equal(E.overspendRisk({ planned: 300, spent: 0, year: 2026, month: '9', today: at(10) }).level, 'none');
    assert.equal(E.overspendRisk({ planned: 300, spent: 90, year: 2026, month: '9', today: at(15) }).level, 'low');
    assert.equal(E.overspendRisk({ planned: 300, spent: 165, year: 2026, month: '9', today: at(15) }).level, 'medium');
    assert.equal(E.overspendRisk({ planned: 300, spent: 250, year: 2026, month: '9', today: at(15) }).level, 'high');
    assert.equal(E.overspendRisk({ planned: 300, spent: 310, year: 2026, month: '9', today: at(30) }).level, 'high');
});

test('currency is display-only and formats per currency', () => {
    const F = require('../js/format.js');
    assert.equal(F.money(1433.25), '$1,433.25');
    assert.equal(F.money(-5), '\u2212$5.00');
    assert.equal(F.money(-0.001), '$0.00');
    F.setCurrency('EUR');
    assert.ok(F.money(1234.5).includes('€'));
    F.setCurrency('COP');
    assert.ok(!F.money(1234.5).includes(',50'));   // COP shows no cents
    F.setCurrency('XXX');                           // unknown → back to USD
    assert.equal(F.money(1), '$1.00');
});

test('this month: spend curve vs last month, breakdown, cash flow', () => {
    const txns = [
        { type: 'Gasto', amount: 10, date: '2026-09-01', parentCategory: 'Alimentación' },
        { type: 'Gasto', amount: 30, date: '2026-09-05', parentCategory: 'Transporte' },
        { type: 'Gasto', amount: 99, date: '2026-09-20', parentCategory: 'Transporte' },   // after "today"
        { type: 'Gasto', amount: 50, date: '2026-08-03', parentCategory: 'Alimentación' },
        { type: 'Gasto', amount: 20, date: '2026-08-25', parentCategory: 'Transporte' },
        { type: 'Ingreso', amount: 900, date: '2026-09-02', parentCategory: 'Ingresos Laborales' }
    ];
    const c = E.monthSpendCurve(txns, new Date(2026, 8, 10));
    assert.equal(c.current.length, 30);
    assert.equal(c.current[9], 40);
    assert.equal(c.current[10], null);            // no line into the future
    assert.equal(c.sameDayLast, 50);
    assert.equal(c.diff, -10);
    assert.equal(c.lastTotal, 70);
    const b = E.categoryBreakdown(txns, { from: '2026-09-01', to: '2026-09-30' });
    assert.equal(b.total, 139);
    assert.equal(b.items[0].category, 'Transporte');
    assert.ok(Math.abs(b.items[0].share - 129 / 139) < 1e-9);
    assert.deepEqual(E.cashFlow(txns, 2026, 9), { income: 900, expense: 139, net: 761 });
});

test('payday, daily allowance and month insights', () => {
    const p = E.nextPayday([15, 31], new Date(2026, 8, 20));
    assert.equal(p.days, 10);                     // 31 → last day (30 Sep)
    assert.equal(E.nextPayday([15], new Date(2026, 8, 20)).date.getMonth(), 9);   // next month
    assert.equal(E.nextPayday([15], new Date(2026, 8, 15)).days, 0);
    assert.equal(E.nextPayday([], new Date()), null);
    const a = E.dailyAllowance({ planned: 300, spent: 100, today: new Date(2026, 8, 21) });
    assert.equal(a.daysLeft, 10);
    assert.equal(a.perDay, 20);
    assert.equal(E.dailyAllowance({ planned: 100, spent: 150, today: new Date(2026, 8, 21) }).perDay, 0);
    const txns = [
        { type: 'Gasto', amount: 100, date: '2026-09-05', parentCategory: 'Ocio' },
        { type: 'Gasto', amount: 20, date: '2026-09-06', parentCategory: 'Comida' },
        { type: 'Gasto', amount: 30, date: '2026-08-05', parentCategory: 'Ocio' },
        { type: 'Gasto', amount: 80, date: '2026-08-06', parentCategory: 'Comida' },
        { type: 'Gasto', amount: 500, date: '2026-08-28', parentCategory: 'Ocio' }   // after the same day
    ];
    const i = E.monthInsights(txns, new Date(2026, 8, 10));
    assert.equal(i.spent, 120);
    assert.equal(i.projected, 360);
    assert.equal(i.top.category, 'Ocio');
    assert.deepEqual([i.jump.category, i.jump.change], ['Ocio', 70]);
    assert.deepEqual([i.drop.category, i.drop.change], ['Comida', -60]);
});

test('household members: income and expense share per person', () => {
    const members = [{ id: 1, name: 'Allen' }, { id: 2, name: 'Emma' }];
    const txns = [
        { type: 'Ingreso', amount: 4750, date: '2026-10-01', memberId: 1 },
        { type: 'Ingreso', amount: 3200, date: '2026-10-01', memberId: 2 },
        { type: 'Gasto', amount: 2420, date: '2026-10-02', memberId: 1 },
        { type: 'Gasto', amount: 730, date: '2026-10-03', memberId: 2 },
        { type: 'Gasto', amount: 50, date: '2026-10-03' },
        { type: 'Gasto', amount: 999, date: '2026-09-03', memberId: 1 }
    ];
    const r = E.memberTotals(txns, members, 2026, 10);
    assert.equal(r.income, 7950);
    assert.equal(r.expense, 3200);
    assert.ok(Math.abs(r.rows[0].incomeShare - 0.5975) < 0.001);
    assert.equal(r.rows[2].name, 'Sin asignar');
    assert.equal(r.rows[2].expense, 50);
});

test('recurring: monthly keeps the day (clamped), weekly/biweekly/yearly, due since last posted', () => {
    const m = { frequency: 'monthly', startDate: '2026-01-31' };
    assert.deepEqual(E.occurrences(m, '2026-01-01', '2026-04-30'), ['2026-01-31', '2026-02-28', '2026-03-31', '2026-04-30']);
    assert.deepEqual(E.occurrences({ frequency: 'weekly', startDate: '2026-09-01' }, '2026-09-01', '2026-09-22'), ['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-22']);
    assert.deepEqual(E.occurrences({ frequency: 'biweekly', startDate: '2026-09-01' }, '2026-09-10', '2026-10-01'), ['2026-09-15', '2026-09-29']);
    assert.deepEqual(E.occurrences({ frequency: 'yearly', startDate: '2024-02-29' }, '2024-01-01', '2026-12-31'), ['2024-02-29', '2025-02-28', '2026-02-28']);
    assert.deepEqual(E.occurrences({ frequency: 'monthly', startDate: '2026-01-10', endDate: '2026-03-01' }, '2026-01-01', '2026-12-31'), ['2026-01-10', '2026-02-10']);
    const rec = { frequency: 'monthly', startDate: '2026-06-05', lastPosted: '2026-07-05' };
    assert.deepEqual(E.dueOccurrences(rec, new Date(2026, 8, 10)), ['2026-08-05', '2026-09-05']);
    assert.deepEqual(E.dueOccurrences({ frequency: 'monthly', startDate: '2026-10-01' }, new Date(2026, 8, 10)), []);
    assert.equal(E.nextOccurrence(rec, new Date(2026, 8, 10)), '2026-10-05');
    assert.ok(Math.abs(E.monthlyCost({ frequency: 'yearly', amount: 120 }) - 10) < 1e-9);
    assert.ok(Math.abs(E.monthlyCost({ frequency: 'weekly', amount: 12 }) - 52) < 1e-9);
});

test('goal schedule: monthly needed for a target date, on track or behind', () => {
    const today = new Date(2026, 8, 15);
    const g = { target: 1200, current: 0, monthly: 100, rate: 0, targetDate: '2027-09-01' };
    const s = E.goalSchedule(g, today);
    assert.equal(s.months, 12);
    assert.equal(s.required, 100);
    assert.equal(s.onTrack, true);
    const behind = E.goalSchedule({ ...g, monthly: 60 }, today);
    assert.equal(behind.onTrack, false);
    assert.equal(behind.gap, 40);
    const withRate = E.goalSchedule({ ...g, rate: 8.5 }, today);
    assert.ok(withRate.required < 100 && withRate.required > 90);     // interest helps
    assert.equal(E.goalSchedule({ ...g, targetDate: '' }, today), null);
    assert.equal(E.goalSchedule({ ...g, current: 1500 }, today).onTrack, true);
});

test('net worth path: debt paid down, then that money is saved', () => {
    const p = E.netWorthPath({ start: -1000, monthlySavings: 100, rate: 0, debtBalance: 1000, debtMonths: 5, debtPayment: 250, months: 7 });
    assert.equal(p.length, 8);
    assert.equal(p[5], -1000 + 5 * 100 + 1000);   // 5 months of saving + debt gone
    assert.equal(p[7], p[5] + 2 * (100 + 250));   // after: savings + the freed debt payment
    const grow = E.netWorthPath({ start: 1000, invested: 1000, monthlySavings: 0, rate: 12, months: 12 });
    assert.ok(grow[12] > 1120 && grow[12] < 1130);
    // A house doesn't earn the DPF rate: only invested money grows.
    const house = E.netWorthPath({ start: 120000, invested: 0, monthlySavings: 0, rate: 12, months: 12 });
    assert.equal(house[12], 120000);
});

test('split transactions count on several lines; the rest follows the usual rule', () => {
    const items = [{ id: 1, name: 'Comida', linkedCategory: 'Alimentación', real: 200 }, { id: 2, name: 'Limpieza', linkedCategory: 'Hogar', real: 50 }, { id: 3, name: 'Mascotas', linkedCategory: 'Mascotas', real: 40 }];
    const txns = [{ id: 1, type: 'Gasto', parentCategory: 'Alimentación', amount: 100, date: '2026-09-05', splits: [{ line: '2', amount: 30 }, { line: '3', amount: 20 }] },
        { id: 2, type: 'Gasto', parentCategory: 'Otros', amount: 60, date: '2026-09-06', splits: [{ line: '2', amount: 10 }] }];
    const s = E.lineSpend(items, txns, 2026, '9');
    assert.equal(s.byLine['1'].spent, 50);    // remainder by category
    assert.equal(s.byLine['2'].spent, 40);
    assert.equal(s.byLine['3'].spent, 20);
    assert.equal(s.unassigned.length, 1);     // 50 of the second one has no line
    assert.equal(s.unassigned[0].amount, 50);
    assert.equal(s.unassignedTotal, 50);
});

test('logging streak counts consecutive days, alive until today ends', () => {
    const tx = (d, created) => ({ type: 'Gasto', amount: 1, date: d, createdAt: created });
    const txns = [tx('2026-09-20', '2026-09-28T10:00:00'), tx('2026-09-29'), tx('2026-09-27'), tx('2026-09-25')];
    const s = E.loggingStreak(txns, new Date(2026, 8, 29));   // Tue 29
    assert.equal(s.days, 3);          // 27, 28 (created), 29
    assert.equal(s.today, true);
    assert.deepEqual(s.week, [true, true, false, false, false, false, false]);   // Mon 28, Tue 29
    const y = E.loggingStreak(txns, new Date(2026, 8, 30));   // nothing yet today
    assert.equal(y.days, 3);
    assert.equal(y.today, false);
    assert.equal(E.loggingStreak(txns, new Date(2026, 9, 5)).days, 0);
});

test('cash on hand: checking + cash, moved by what was logged after the balance date', () => {
    const accounts = [
        { kind: 'corriente', balance: 1000, updatedAt: '2026-09-10' },
        { kind: 'efectivo', balance: 50, updatedAt: '2026-09-08' },
        { kind: 'ahorros', balance: 5000, updatedAt: '2026-09-10' }
    ];
    const txns = [
        { type: 'Gasto', amount: 30, date: '2026-09-10' },                                   // same day: already in the balance
        { type: 'Gasto', amount: 40, date: '2026-09-12' },
        { type: 'Gasto', amount: 99, date: '2026-09-12', paymentType: 'Tarjeta de Crédito' },
        { type: 'Ingreso', amount: 200, date: '2026-09-13' },
        { type: 'Gasto', amount: 10, date: '2026-09-20' }                                    // future
    ];
    const c = E.cashNow(accounts, txns, new Date(2026, 8, 15));
    assert.deepEqual([c.base, c.adjust, c.total, c.asOf], [1050, 160, 1210, '2026-09-10']);
    assert.equal(E.cashNow([{ kind: 'ahorros', balance: 1 }], [], new Date()), null);
});

test('cash events, safe to spend and the day-by-day forecast', () => {
    const items = [
        { id: 1, name: 'Arriendo', real: 400, dueDay: 5, linkedCategory: 'Vivienda' },
        { id: 2, name: 'Internet', real: 35, dueDay: 20, linkedCategory: 'Servicios' },
        { id: 3, name: 'Luz', real: 30, dueDay: 12, linkedCategory: 'Luz' },
        { id: 4, name: 'Comida', real: 300 }
    ];
    const spendSep = { byLine: { 1: { spent: 400 }, 2: { spent: 0 }, 3: { spent: 0 }, 4: { spent: 100 } } };
    const spendOct = { byLine: {} };
    const recurring = [
        { description: 'Netflix', type: 'Gasto', amount: 10, frequency: 'monthly', startDate: '2026-01-18', lastPosted: '2026-08-18', parentCategory: 'Entretenimiento' },
        { description: 'Internet', type: 'Gasto', amount: 35, frequency: 'monthly', startDate: '2026-01-20', budgetLine: '2' },   // same as the bill
        { description: 'Sueldo', type: 'Ingreso', category: 'Sueldo/Salario', amount: 1000, frequency: 'monthly', startDate: '2026-01-15' }  // the payday covers it
    ];
    const ev = E.cashEvents({ from: '2026-09-15', to: '2026-10-15', months: [{ year: 2026, month: 9, items, spend: spendSep }, { year: 2026, month: 10, items, spend: spendOct }], recurring, paydays: [15, 30], payPerMonth: 1000 });
    const names = ev.map(e => `${e.date} ${e.name} ${e.amount}`);
    assert.ok(names.includes('2026-09-12 Luz -30'), 'overdue unpaid bill kept');
    const rent = ev.find(e => e.date === '2026-09-05');
    assert.ok(rent.paid && rent.amount === 0, 'paid bill has nothing left to pay');
    assert.ok(names.includes('2026-09-18 Netflix -10') && names.includes('2026-09-20 Internet -35'));
    assert.equal(ev.filter(e => e.name === 'Internet' && e.date === '2026-09-20').length, 1, 'bill and its repeat are not counted twice');
    assert.ok(names.includes('2026-09-15 Día de pago 500') && names.includes('2026-09-30 Día de pago 500') && names.includes('2026-10-15 Día de pago 500'));
    assert.ok(!ev.some(e => e.name === 'Sueldo'));
    assert.ok(names.includes('2026-10-05 Arriendo -400'));

    const safe = E.safeToSpend({ cash: 800, today: new Date(2026, 8, 15), until: '2026-09-30', events: ev, setAside: 100, buffer: 50 });
    assert.deepEqual([safe.bills, safe.scheduled, safe.safe, safe.daysLeft], [65, 10, 575, 15]);
    assert.ok(Math.abs(safe.perDay - 575 / 15) < 1e-9);

    const f = E.cashForecast({ from: '2026-09-15', to: '2026-09-21', start: 300, events: ev, dailyByMonth: { '2026-09': 10 }, buffer: 100 });
    assert.equal(f[0].balance, 300 + 500 - 10 - 30);                                         // payday, everyday, overdue Luz
    assert.equal(f.find(d => d.date === '2026-09-20').balance, 760 - 10 * 5 - 10 - 35);
    const low = E.cashForecast({ from: '2026-09-16', to: '2026-09-20', start: 120, events: ev, dailyByMonth: { '2026-09': 10 }, buffer: 100 });
    assert.deepEqual(low.map(d => d.status), ['low', 'low', 'low', 'low', 'short']);          // the overdue bill leaves on day one
});

test('what if: a purchase takes from free money, its line, variable lines, then savings — never fixed bills', () => {
    const items = [
        { id: 1, name: 'Arriendo', type: 'Gasto Fijo', real: 400 },
        { id: 2, name: 'Comida', type: 'Gasto Variable', real: 300 },
        { id: 3, name: 'Salidas', type: 'Gasto Variable', real: 100 },
        { id: 4, name: 'Ropa', type: 'Gasto Variable', real: 50 },
        { id: 5, name: 'Ahorro', type: 'Ahorro', real: 200 },
        { id: 'goal-1', name: 'Viaje', type: 'Ahorro', real: 80, link: 'goal' }
    ];
    const spend = { byLine: { 2: { spent: 250 }, 3: { spent: 20 }, 4: { spent: 0 } } };
    const r = E.starveLines({ items, spend, amount: 500, lineId: 4, free: 30, sweep: 0 });
    assert.deepEqual(r.takes.map(t => [t.name, t.take]), [['Unassigned money', 30], ['Ropa', 50], ['Salidas', 80], ['Comida', 50], ['Ahorro', 200], ['Viaje', 80]]);
    assert.equal(r.short, 10);
    assert.ok(!r.takes.some(t => t.name === 'Arriendo'));
    assert.deepEqual(E.starveLines({ items, spend, amount: 20, lineId: 4 }).takes.map(t => t.name), ['Ropa']);
});

test('pay schedules: days of the month, weekly, every 2 weeks, 2nd/4th Friday, daily, quarterly', () => {
    const d = (sch, a, b) => E.payDates(sch, a, b);
    // Old style: days of the month; 31 = last day.
    assert.deepEqual(d([15, 31], '2026-02-01', '2026-02-28'), ['2026-02-15', '2026-02-28']);
    // Weekend rule: 15 Aug 2026 is a Saturday.
    assert.deepEqual(d({ freq: 'monthly', days: [15], weekend: 'before' }, '2026-08-01', '2026-08-31'), ['2026-08-14']);
    assert.deepEqual(d({ freq: 'monthly', days: [15], weekend: 'after' }, '2026-08-01', '2026-08-31'), ['2026-08-17']);
    // Every Friday (5) of October 2026.
    assert.deepEqual(d({ freq: 'weekly', weekday: 5 }, '2026-10-01', '2026-10-31'), ['2026-10-02', '2026-10-09', '2026-10-16', '2026-10-23', '2026-10-30']);
    // Every 2 weeks on Thursday, counted from 8 Oct.
    assert.deepEqual(d({ freq: 'weekly', weekday: 4, interval: 2, anchor: '2026-10-08' }, '2026-10-01', '2026-11-10'), ['2026-10-08', '2026-10-22', '2026-11-05']);
    // 2nd and 4th Friday; last Friday.
    assert.deepEqual(d({ freq: 'nth', weekday: 5, nths: [2, 4] }, '2026-10-01', '2026-11-30'), ['2026-10-09', '2026-10-23', '2026-11-13', '2026-11-27']);
    assert.deepEqual(d({ freq: 'nth', weekday: 5, nths: [-1] }, '2026-10-01', '2026-10-31'), ['2026-10-30']);
    // Daily, Monday to Friday.
    assert.equal(d({ freq: 'daily', businessDays: true }, '2026-10-01', '2026-10-31').length, 22);
    assert.equal(d({ freq: 'daily' }, '2026-10-01', '2026-10-31').length, 31);
    // Quarterly on the 10th, from January.
    assert.deepEqual(d({ freq: 'monthly', days: [10], interval: 3, anchor: '2026-01-10' }, '2026-01-01', '2026-12-31'), ['2026-01-10', '2026-04-10', '2026-07-10', '2026-10-10']);
    assert.equal(E.paymentsPerYear({ freq: 'weekly', weekday: 5 }, 2026), 52);
    assert.equal(E.nextPayday({ freq: 'weekly', weekday: 5 }, new Date(2026, 9, 3)).days, 6);
    assert.equal(E.normalizeSchedule({ freq: 'nth', weekday: 5, nths: [] }), null);
});

test('weekly pay spreads the yearly net pay over the paychecks; décimos come on top', () => {
    const ev = E.cashEvents({ from: '2026-12-01', to: '2026-12-31', months: [], recurring: [], schedule: { freq: 'weekly', weekday: 5 }, payPerMonth: { '2026-12': 2300 }, payBase: 1300 });
    const pays = ev.filter(e => e.name === 'Día de pago');
    assert.equal(pays.length, 4);                                       // 4, 11, 18, 25 Dec
    assert.ok(Math.abs(pays[0].amount - 1300 * 12 / 52) < 1e-9);
    const bonus = ev.find(e => e.name === 'Décimo / bono');
    assert.equal(bonus.date, '2026-12-04'); assert.equal(bonus.amount, 1000);
    const fixed = E.cashEvents({ from: '2026-12-01', to: '2026-12-31', months: [], recurring: [], schedule: { freq: 'daily', businessDays: true, amount: 40 }, payPerMonth: 1300 });
    assert.ok(fixed.filter(e => e.name === 'Día de pago').every(e => e.amount === 40));
});

test('repeating transactions every 3 and 6 months', () => {
    assert.deepEqual(E.occurrences({ startDate: '2026-01-31', frequency: 'quarterly' }, '2026-01-01', '2026-12-31'), ['2026-01-31', '2026-04-30', '2026-07-31', '2026-10-31']);
    assert.deepEqual(E.occurrences({ startDate: '2026-03-05', frequency: 'semiannual' }, '2026-01-01', '2027-12-31'), ['2026-03-05', '2026-09-05', '2027-03-05', '2027-09-05']);
    assert.equal(E.monthlyCost({ amount: 300, frequency: 'quarterly' }), 100);
});

test('every 2 weeks works even when the date given is not the payday weekday', () => {
    // 6 Oct 2026 is a Tuesday → counted from Thursday 8 Oct.
    assert.deepEqual(E.payDates({ freq: 'weekly', weekday: 4, interval: 2, anchor: '2026-10-06' }, '2026-10-01', '2026-11-10'), ['2026-10-08', '2026-10-22', '2026-11-05']);
});

test('forecast: dated paydays and evenly spread plan, grouped by period', () => {
    const monthly = { '2026-11': { income: 300, expense: 900, savings: 150, debt: 300 }, '2026-12': { income: 0, expense: 930, savings: 0, debt: 0 } };
    const events = [{ date: '2026-11-13', amount: 600 }, { date: '2026-11-27', amount: 600 }, { date: '2026-12-11', amount: 600 }, { date: '2027-01-08', amount: 600 }];
    const m = E.projectFlows({ from: '2026-11-01', to: '2026-12-31', period: 'month', events, monthly });
    assert.equal(m.length, 2);
    assert.ok(Math.abs(m[0].income - 1500) < 1e-6 && Math.abs(m[0].expense - 900) < 1e-6 && Math.abs(m[0].savings - 150) < 1e-6);
    assert.ok(Math.abs(m[1].income - 600) < 1e-6 && Math.abs(m[1].expense - 930) < 1e-6);
    const w = E.projectFlows({ from: '2026-12-07', to: '2026-12-20', period: 'week', events, monthly });
    assert.deepEqual(w.map(r => r.start), ['2026-12-07', '2026-12-14']);
    assert.ok(Math.abs(w[0].expense - 210) < 1e-6 && w[0].income === 600 && w[1].income === 0);
});

test('projected balances: debts follow the plan, then their payments roll into savings', () => {
    const months = [1, 2, 3].map(i => ({ key: `2026-1${i - 1}`, income: 2000, expense: 1500, savings: 100, debt: 400 }));
    const b = E.projectBalances({ start: { cash: 500, savings: 1000, debts: 700 }, months, rate: 12, debtHistory: [350, 0] });
    assert.deepEqual(b.map(x => Math.round(x.debts)), [350, 0, 0]);
    assert.deepEqual(b.map(x => Math.round(x.cash)), [500, 500, 500]);
    // Month 2 pays off the last $350: the other $50 of that month's $400 goes to savings.
    assert.equal(Math.round(b[1].savings), Math.round((1000 * 1.01 + 100) * 1.01 + 100 + 50));
    assert.equal(Math.round(b[2].savings), Math.round(((1000 * 1.01 + 100) * 1.01 + 100 + 50) * 1.01 + 100 + 400));
    const plan = E.debtPayoff([{ id: 1, balance: 700, rate: 0, minPayment: 100, monthly: 400 }], 'snowball', 0);
    assert.deepEqual(plan.history, [300, 0]);
});

test('a 27-paycheck year pays 27 regular checks (salary ÷ 26 each)', () => {
    const sch = { freq: 'weekly', weekday: 5, interval: 2, anchor: '2027-01-01' };
    assert.equal(E.paymentsPerYear(sch, 2027), 27);
    assert.equal(E.nominalPaymentsPerYear(sch), 26);
    const ev = E.cashEvents({ from: '2027-01-01', to: '2027-12-31', months: [], recurring: [], schedule: sch, payPerMonth: 2600 });
    assert.equal(ev.length, 27);
    assert.ok(ev.every(e => Math.abs(e.amount - 1200) < 1e-9));
});

// ---- United States (ZeroDebtPlan)
const US = require('../js/defaults-us.js');
const usYear = (over) => Object.assign(US.newYear(), { payDeductions: [] }, over);
const near = (a, b, msg) => assert.ok(Math.abs(a - b) < 0.01, `${msg}: ${a} vs ${b}`);

test('US paycheck: single in Michigan, $5,000 a month', () => {
    const p = E.payroll(usYear({}));
    near(p.fedM * 12, 5020, 'federal');                       // (60,000 − 16,100) through the 2026 brackets
    near(p.ssM * 12, 3720, 'social security');
    near(p.medM * 12, 870, 'medicare');
    near(p.stateM * 12, 2299.25, 'Michigan 4.25% after the 2026 $5,900 exemption');
    near(p.netoM, 4007.56, 'net per month');
});

test('US paycheck: pre-tax 401(k) lowers income tax only; health lowers FICA too; city tax', () => {
    const p = E.payroll(usYear({ localRate: 2.4, payDeductions: [
        { id: 1, name: '401(k)', group: 'retirement', kind: 'retirement', pretax: true, monthly: 300 },
        { id: 2, name: 'Medical', group: 'insurance', kind: 'health', pretax: true, monthly: 150 },
        { id: 3, name: 'Federal', group: 'mandatory', kind: 'federal', monthly: 400 }   // from a stub: computed, not subtracted again
    ] }));
    near(p.fedM * 12, 4372, 'federal on 54,600');
    near((p.ssM + p.medM) * 12, 4452.3, 'FICA on 58,200');
    near(p.stateM * 12, 2069.75, 'Michigan');
    near(p.localM * 12, 1396.8, 'a typed 2.4% city rate on Medicare wages (401(k) included)');
    near(p.otrosDescuentosM, 450, 'only the 401(k) and medical come off as deductions');
});

test('US pay: a plain salary (or old saved data with no pay type) gives the same numbers as before', () => {
    const old = usYear({}); delete old.payType; delete old.hourly; delete old.bonuses;
    near(E.payroll(old).netoM, 4007.56, 'no payType = salary');
    const g = E.usGrossPay(usYear({}));
    assert.deepEqual([g.payType, g.baseM, g.overtimeM, g.budgetM, g.annual], ['salary', 5000, 0, 5000, 60000]);
    near(E.payroll(usYear({})).budgetShare, 1, 'the budget carries all the taxes');
});

test('US pay: hourly with overtime — taxes on the year, the budget on base pay unless overtime is counted', () => {
    const hourly = (otInBudget) => usYear({ payType: 'hourly', hourly: { rate: 25, hours: 40, otHours: 5, otRate: 1.5, otInBudget } });
    const g = E.usGrossPay(hourly(false));
    near(g.baseM, 25 * 40 * 52 / 12, 'base: 40 h a week, 52 weeks');
    near(g.overtimeM, 25 * 1.5 * 5 * 52 / 12, 'overtime at 1.5×');
    near(g.annual, 61750, 'the year: base + overtime');
    near(g.budgetM, g.baseM, 'overtime not in the budget');
    // Overtime counted: same as a salary of the same monthly gross.
    near(E.payroll(hourly(true)).netoM, E.payroll(usYear({ sueldo: 61750 / 12 })).netoM, 'overtime in the budget = salary');
    // Not counted: the budget gets its share of the year's take-home pay.
    near(E.payroll(hourly(false)).netoM, E.payroll(hourly(true)).netoM * 52000 / 61750, 'base share of the take-home');
    near(E.usGrossPay(usYear({ payType: 'hourly', hourly: { rate: 20, hours: 30, otHours: 4 } })).overtimeM, 20 * 1.5 * 4 * 52 / 12, 'overtime rate defaults to 1.5×');
});

test('US pay: bonuses are taxed with the year; a planned one counts in its month, after taxes', () => {
    const yd = usYear({ bonuses: [{ id: 1, name: 'Year-end bonus', amount: 6000, month: '12', inBudget: true }] });
    const p = E.payroll(yd);
    near(p.sueldoAnual, 66000, 'salary + bonus');
    const bonus = E.bonusForMonth(yd, '12', p);
    near(bonus, 6000 * (1 - p.avgTaxRate), 'net at the average rate');
    assert.equal(E.bonusForMonth(yd, '11', p), 0);
    assert.equal(E.bonusForMonth(yd, 'base', p), 0);
    near(p.netoM * 12 + bonus, 66000 * (1 - p.avgTaxRate), 'twelve paychecks + the bonus = the year after taxes');
    near(E.monthBudget(yd, '12', p).salary - E.monthBudget(yd, '11', p).salary, bonus, "December's budget has the bonus");
    // Not planned: still taxed (the paycheck's share is lower), but no month counts it.
    const unplanned = usYear({ bonuses: [{ id: 1, name: 'Bonus', amount: 6000, month: '12', inBudget: false }] });
    assert.equal(E.bonusForMonth(unplanned, '12'), 0);
    // The bonus raises the year's average tax rate, so each paycheck's share of the tax goes up.
    assert.ok(E.payroll(unplanned).avgTaxRate > E.payroll(usYear({})).avgTaxRate);
    assert.ok(E.payroll(unplanned).netoM < E.payroll(usYear({})).netoM);
});

test('refund estimate: bonuses still to come are withheld at 22% federal', () => {
    const yd = usYear({});
    const base = E.usRefundEstimate({ yd, wagesIncome: 66000, withheldYtd: 3000, perCheck: 200, checksLeft: 8 });
    const withBonus = E.usRefundEstimate({ yd, wagesIncome: 66000, withheldYtd: 3000, perCheck: 200, checksLeft: 8, bonusesLeft: 6000 });
    near(withBonus.withheld - base.withheld, 1320, '22% of $6,000');
    near(withBonus.bonusWithheld, 1320, 'shown apart');
    near(withBonus.diff - base.diff, 1320, 'the refund grows by it');
});

test('extra paychecks: every 2 weeks gives two months with a 3rd; weekly, four with a 5th', () => {
    const bi = { freq: 'weekly', weekday: 5, interval: 2, anchor: '2026-01-02' };
    const p = E.extraPaycheckMonths(bi, 2026);
    assert.deepEqual([p.usual, p.perYear, p.months.map(m => m.month)], [2, 26, [1, 7]]);
    assert.deepEqual(p.months[1].dates, ['2026-07-03', '2026-07-17', '2026-07-31']);
    assert.deepEqual(E.extraPaycheckMonths({ freq: 'weekly', weekday: 5 }, 2026).months.map(m => [m.month, m.count]), [[1, 5], [5, 5], [7, 5], [10, 5]]);
    assert.equal(E.extraPaycheckMonths({ freq: 'monthly', days: [15, 30] }, 2026), null);   // twice a month: never an extra one
});

test('budgeting on paychecks: two a month, the 3rd is extra income in its month; the year adds up', () => {
    const yd = usYear({ budgetOnPaychecks: true, paySchedule: { freq: 'weekly', weekday: 5, interval: 2, anchor: '2026-01-02' }, calYear: 2026 });
    const pay = E.payroll(yd), each = pay.netoM * 12 / 26;
    near(E.paycheckSalary(yd, 'base', pay), each * 2, 'the plan: 2 paychecks');
    near(E.paycheckSalary(yd, '3', pay), each * 2, 'March: 2');
    near(E.paycheckSalary(yd, '7', pay), each * 3, 'July: 3');
    let year = 0; for (let m = 1; m <= 12; m++) year += E.monthBudget(yd, String(m), pay).salary;
    near(year, pay.netoM * 12, 'twelve months = the year');
    near(E.paycheckSalary(Object.assign({}, yd, { budgetOnPaychecks: false }), '7', pay), pay.netoM, 'off: the year spread evenly');
    const mv = E.nextMoves({ hasIncome: true, step: 2, extraPaycheck: { label: 'July', amount: 1850, onChecks: true } }, { limit: 5 });
    assert.ok(mv.some(m => m.key === 'extraPay' && /July brings an extra paycheck/.test(m.title) && /snowball/.test(m.text)));
});

test('US paycheck: married with two kids; Social Security stops at the wage base', () => {
    near(E.payroll(usYear({ sueldo: 10000, filingStatus: 'mfj', dependents: 2 })).fedM * 12, 5640, 'MFJ with child credits');
    const high = E.payroll(usYear({ sueldo: 20000 }));
    near(high.ssM * 12, 11439, 'SS capped at $184,500');
    near(high.medM * 12, 3840, 'Medicare + 0.9% over $200k');
    near(E.payroll(usYear({ state: 'TX' })).stateM, 0, 'Texas has no wage tax');
    near(E.payroll(usYear({ state: 'CA', stateRate: 5 })).stateM * 12, 3000, 'a state you enter a rate for');
});

test('US: child credits phase out above $400k (MFJ) / $200k', () => {
    near(E.payroll(usYear({ sueldo: 37500, filingStatus: 'mfj', dependents: 2 })).credits, 1900, '$450k MFJ: 4,400 − 50 × 50');
    near(E.payroll(usYear({ sueldo: 30000, filingStatus: 'mfj', dependents: 2 })).credits, 4400, '$360k MFJ: full credit');
    near(E.payroll(usYear({ sueldo: 25000, dependents: 1 })).credits, 0, '$300k single: 2,200 − 100 × 50 → 0');
});

test('US: Michigan city tax — resident vs non-resident rate and the $600 exemption', () => {
    const live = E.payroll(usYear({ localName: 'Detroit' }));
    near(live.localM * 12, (60000 - 600) * 0.024, 'Detroit resident 2.4%');
    const work = E.payroll(usYear({ localName: 'Detroit', localResident: false }));
    near(work.localM * 12, (60000 - 600) * 0.012, 'works in Detroit, lives elsewhere: 1.2%');
    near(E.payroll(usYear({ localName: 'Grand Rapids', localResident: false })).localM * 12, (60000 - 600) * 0.0075, 'Grand Rapids non-resident 0.75%');
});

test('US: Pennsylvania taxes 401(k) deferrals; extra Medicare is withheld from $200k for everyone', () => {
    const k = [{ id: 1, name: '401(k)', group: 'retirement', kind: 'retirement', pretax: true, monthly: 500 }];
    near(E.payroll(usYear({ state: 'PA', payDeductions: k })).stateM * 12, 60000 * 0.0307, 'PA on full wages');
    const mfj = E.payroll(usYear({ sueldo: 20000, filingStatus: 'mfj' }));
    near(mfj.medM * 12, 240000 * 0.0145 + 40000 * 0.009, 'withholding starts at $200k even for MFJ');
});

test('Social Security estimate: PIA formula and claiming age', () => {
    const t = US.usTax2026();
    const at = (age) => E.socialSecurity({ sueldoPromedio: 5000, aniosAportados: 10, aniosRestantes: 25, edadJubilacion: age, usTax: t });
    near(at(67), 2345.88, 'full retirement age');
    near(at(62), 2345.88 * 0.7, 'at 62: 30% less');
    near(at(70), 2345.88 * 1.24, 'at 70: 24% more');
    near(E.socialSecurity({ sueldoPromedio: 5000, aniosAportados: 5, aniosRestantes: 12.5, edadJubilacion: 67, usTax: t }), 0.9 * 1286 + 0.32 * (2500 - 1286), 'half a career');
});

test('projected balances: the month a debt is paid off, the leftover payment is not lost', () => {
    const rows = E.projectBalances({ start: { cash: 600, savings: 0, debts: 450 }, months: [{ key: 'm1', income: 0, expense: 0, savings: 0, debt: 600 }], debtHistory: [0] });
    near(rows[0].net, 150, 'net worth keeps the $150 not needed');
    near(rows[0].savings, 150, 'it rolls into savings');
});

test('US CDs: APY on a 365-day year; Ecuador DPF: nominal rate on 360 days', () => {
    near(E.polizaInterest({ amount: 5000, rate: 4, days: 365, modality: 'Al Vencimiento (Simple)' }, 'US'), 200, '4% APY for a year');
    near(E.polizaInterest({ amount: 10000, rate: 4, days: 365, modality: 'Mensual (Compuesto)' }, 'US'), 400, 'APY already includes compounding');
    near(E.polizaInterest({ amount: 5000, rate: 9, days: 360, modality: 'Al Vencimiento (Simple)' }), 450, 'DPF simple, 360 days');
});

test('retirement in today\'s dollars, pension only once eligible', () => {
    const r = E.retirement({ edadActual: 30, edadJubilacion: 65, ahorroActual: 10000, aporteMensual: 500, tasaRetorno: 7, inflacion: 3, tasaRetiroSegura: 4, sueldoPromedio: 1000, tasaReemplazo: 60, aniosAportados: 5 });
    const nominal = E.futureValue(10000, 500, 7, 420);
    near(r.valorFuturo, nominal, 'nominal future value');
    near(r.valorFuturoHoy, nominal / Math.pow(1.03, 35), 'deflated 35 years at 3%');
    near(r.ingresoAhorro, r.valorFuturoHoy * 0.04 / 12, '4% rule on today\'s dollars');
    assert.equal(r.pensionDesde, 65);                       // 40 years paid in
    const early = E.retirement({ edadActual: 40, edadJubilacion: 55, ahorroActual: 0, aporteMensual: 0, tasaRetorno: 5, inflacion: 2.5, tasaRetiroSegura: 4, sueldoPromedio: 1000, tasaReemplazo: 60, aniosAportados: 10 });
    assert.equal(early.pensionDesde, 65);                  // 25 years: waits until 65
    assert.equal(early.aniosPuente, 10);
    assert.equal(E.retirement({ edadActual: 50, edadJubilacion: 55, ahorroActual: 0, aporteMensual: 0, tasaRetorno: 5, inflacion: 2.5, tasaRetiroSegura: 4, sueldoPromedio: 1000, tasaReemplazo: 60, aniosAportados: 2 }).pension, 0);
    const us = E.retirement({ country: 'US', usTax: US.usTax2026(), edadActual: 40, edadJubilacion: 55, ahorroActual: 0, aporteMensual: 0, tasaRetorno: 10, inflacion: 3, tasaRetiroSegura: 4, sueldoPromedio: 5000, aniosAportados: 15 });
    assert.equal(us.pensionDesde, 62);                     // Social Security can't start before 62
});

test('savings pools: each dollar counted once — emergency fund first, the rest invested', () => {
    const p = E.savingsPools({ polizas: [{ amount: 8000, coopName: 'JEP' }, { amount: 3000, name: 'Jubilación', purpose: 'jubilacion' }], savingsBalance: 2000, goals: [{ name: 'Emergency Fund', current: 1000 }], retirementAccounts: 5000, holdings: 1000, monthlyEssential: 1000 });
    near(p.emergency, 6000, 'six months of essentials (goal 1,000 + 5,000 from the pool)');
    near(p.invested, (10000 - 5000) + 3000 + 5000 + 1000, 'the excess + retirement CDs + 401(k) + holdings');
    assert.equal(E.savingsPurpose({ name: 'Emergency Fund' }), 'emergencia');
    assert.equal(E.savingsPurpose({ name: '401(k)' }), 'jubilacion');
    assert.equal(E.savingsPurpose({ name: 'Ahorro', purpose: 'jubilacion' }), 'jubilacion');
});

test('Baby Steps: later steps wait; renters are not "done" with the mortgage', () => {
    const st = E.babySteps({ liquid: 8000, consumerDebt: 7500, monthsCovered: 4, savingsRate: 0.2, mortgageBalance: 0 });
    assert.equal(st.current, 2);
    assert.equal(st.steps[2].state, 'pending');            // not "done" while debt is open
    assert.match(st.steps[1].detail, /7,500/);              // thousands separator
    const renter = E.babySteps({ liquid: 20000, consumerDebt: 0, monthsCovered: 6, savingsRate: 0.15, mortgageBalance: 0, ownsHome: false });
    assert.notEqual(renter.steps[5].state, 'done');
});

test('PMI: none at 80% loan-to-value; otherwise until the balance reaches 78% of the value', () => {
    const sch = E.amortization('frances', 285000, 6.5, 360, 0).schedule;
    const p = E.pitiMonthly({ payment: 1801, amount: 285000, pmiRate: 0.5, homeValue: 300000, schedule: sch });
    near(p.pmi, 285000 * 0.005 / 12, 'monthly PMI');
    const i = sch.findIndex(r => r.balance <= 234000);
    assert.equal(p.pmiMonths, i + 1);
    assert.equal(E.pitiMonthly({ payment: 1500, amount: 240000, pmiRate: 0.5, homeValue: 300000, schedule: sch }).pmi, 0);
});

test('spending exactly the plan is complete, not over', () => {
    assert.equal(E.spendStatus(2144.75, 2144.75).kind, 'complete');
    assert.equal(E.spendStatus(2144.76, 2144.75).kind, 'over');
    assert.equal(E.spendStatus(1800, 2000).kind, 'warning');
});

test('debt ladder: payoff and snowball month per debt, and the minimums-only path', () => {
    const debts = [{ id: 1, balance: 300, rate: 0, minPayment: 50, monthly: 150 }, { id: 2, balance: 1000, rate: 0, minPayment: 100, monthly: 100 }];
    const p = E.debtPayoff(debts, 'snowball', 0);
    const a = p.items.find(i => i.id === 1), b = p.items.find(i => i.id === 2);
    assert.deepEqual([a.attackMonth, a.payoffMonth], [1, 2]);
    // The second debt gets the rolled-over money once the first is gone.
    assert.deepEqual([b.attackMonth, b.payoffMonth], [3, 6]);
    assert.deepEqual(p.history, [1050, 800, 550, 300, 50, 0]);
    // Minimums only: 300/50 = 6 months and 1000/100 = 10 months.
    assert.equal(p.minimumsMonths, 10);
    assert.equal(p.minimumsHistory.length, 10);
    assert.equal(p.minimumsHistory[0], 1150);
    assert.equal(p.minimumsHistory[9], 0);
    // A debt that only ever gets its own minimum has no snowball month.
    const solo = E.debtPayoff([{ id: 1, balance: 200, rate: 0, minPayment: 100, monthly: 100 }], 'snowball', 0);
    assert.equal(solo.items[0].attackMonth, null);
    assert.equal(solo.items[0].payoffMonth, 2);
});

test('mortgage principal and interest by loan year', () => {
    const am = E.amortization('frances', 100000, 6, 360, 0);
    const years = E.amortizationByYear(am.schedule);
    assert.equal(years.length, 30);
    assert.equal(years[0].months, 12);
    close(years.reduce((t, y) => t + y.principal, 0), 100000, 0.5);
    close(years.reduce((t, y) => t + y.interest, 0), am.totalInterest, 0.5);
    // Early years are mostly interest; late years mostly principal.
    assert.ok(years[0].interest > years[0].principal && years[29].principal > years[29].interest);
    close(years[0].balance, am.schedule[11].balance);
    // An extra payment ends early, with a partial last year.
    const extra = E.amortizationByYear(E.amortization('frances', 100000, 6, 360, 500).schedule);
    assert.ok(extra.length < 30);
    assert.ok(extra[extra.length - 1].months <= 12);
    assert.deepEqual(E.amortizationByYear([]), []);
});

test('where every dollar goes: plan lines summed into fixed groups', () => {
    const items = [
        { name: 'Giving', type: 'Gasto Variable', real: 100, linkedCategory: 'Regalos, Celebraciones y Donaciones' },
        { name: 'Diezmo', type: 'Gasto Variable', real: 50, linkedCategory: 'Otros' },
        { name: 'Arriendo', type: 'Gasto Fijo', real: 800, linkedCategory: 'Vivienda' },
        { name: 'Luz', type: 'Gasto Fijo', real: 40, linkedCategory: 'Servicios Básicos y Comunicación' },
        { name: 'Comida', type: 'Gasto Variable', real: 300, linkedCategory: 'Alimentación' },
        { name: 'Gasolina', type: 'Gasto Variable', real: 60, linkedCategory: 'Transporte' },
        { name: 'Ropa', type: 'Gasto Variable', real: 30, linkedCategory: 'Vestimenta' },
        { name: 'Tarjeta', type: 'Deuda', real: 200, linkedCategory: 'Deudas' },
        { name: 'Fondo', type: 'Ahorro', real: 150, linkedCategory: 'Ahorro e Inversión' },
        { name: 'Meta', type: 'Ahorro (meta)', real: 70 }
    ];
    const r = E.budgetBuckets(items, { income: 2000, sweep: 0 });
    const by = Object.fromEntries(r.buckets.map(b => [b.key, b.amount]));
    assert.deepEqual(r.buckets.map(b => b.key), ['dar', 'ahorro', 'vivienda', 'comida', 'transporte', 'otros', 'deudas']);
    assert.deepEqual(by, { dar: 150, ahorro: 220, vivienda: 840, comida: 300, transporte: 60, otros: 30, deudas: 200 });
    assert.equal(r.assigned, 1800);
    assert.equal(r.left, 200);
    // The auto-sweep is savings; assigning more than the income leaves a negative balance.
    assert.equal(E.budgetBuckets(items, { income: 2000, sweep: 200 }).left, 0);
    assert.equal(E.budgetBuckets(items, { income: 1500 }).left, -300);
});

test('daily spending for a calendar heatmap: whole weeks, Monday first, future days marked', () => {
    const txns = [
        { type: 'Gasto', date: '2026-10-01', amount: 20 },
        { type: 'Gasto', date: '2026-10-01', amount: 5.5 },
        { type: 'Ingreso', date: '2026-10-01', amount: 999 },
        { date: '2026-09-21', amount: 40 },              // no type = expense
        { type: 'Gasto', date: '2026-06-01', amount: 70 } // before the window
    ];
    const r = E.dailySpend(txns, { end: new Date(2026, 9, 2), weeks: 2 }); // Friday Oct 2, 2026
    assert.equal(r.weeks.length, 2);
    assert.equal(r.weeks[0].start, '2026-09-21');
    assert.equal(r.weeks[1].start, '2026-09-28');
    assert.equal(r.weeks[0].days[0].total, 40);
    const thu = r.weeks[1].days[3];
    assert.deepEqual([thu.date, thu.total, thu.future], ['2026-10-01', 25.5, false]);
    assert.equal(r.weeks[1].days[5].future, true);   // Saturday after "today"
    assert.equal(r.max, 40);
    assert.equal(r.total, 65.5);
});

test('monthly totals per group for sparklines', () => {
    const txns = [
        { date: '2026-10-01', amount: 10, parentCategory: 'A' },
        { date: '2026-09-15', amount: 5, parentCategory: 'A' },
        { date: '2026-09-15', amount: 7, parentCategory: 'B' },
        { date: '2025-01-15', amount: 7, parentCategory: 'B' }
    ];
    const r = E.monthlyByKey(txns, t => t.parentCategory, { end: new Date(2026, 9, 2), count: 3 });
    assert.deepEqual(r.months, ['2026-08', '2026-09', '2026-10']);
    assert.deepEqual(r.series.A, [0, 5, 10]);
    assert.deepEqual(r.series.B, [0, 7, 0]);
    // Months cross the year boundary.
    assert.deepEqual(E.monthlyByKey([], () => 'x', { end: new Date(2026, 0, 10), count: 2 }).months, ['2025-12', '2026-01']);
});

test('transfers are neither income nor spending; refunds lower spending', () => {
    const items = [{ id: 1, name: 'Ropa', linkedCategory: 'Ropa', real: 200 }];
    const txns = [
        { id: 1, type: 'Gasto', parentCategory: 'Ropa', amount: 120, date: '2026-09-05' },
        { id: 2, type: 'Gasto', parentCategory: 'Ropa', amount: 40, date: '2026-09-09', refund: true },
        { id: 3, type: 'Transferencia', parentCategory: 'Transferencia', amount: 500, date: '2026-09-10', from: 'acc-1', to: 'acc-2' },
        { id: 4, type: 'Ingreso', parentCategory: 'Sueldo', amount: 900, date: '2026-09-01' }
    ];
    assert.equal(E.lineSpend(items, txns, 2026, '9').byLine['1'].spent, 80);
    assert.equal(E.categorySpend(txns, 'Ropa', 2026, '9'), 80);
    assert.deepEqual(E.cashFlow(txns, 2026, 9), { income: 900, expense: 80, net: 820 });
    assert.equal(E.categoryBreakdown(txns, { from: '2026-09-01', to: '2026-09-30' }).total, 80);
    assert.equal(E.isTransfer(txns[2]), true);
    assert.equal(E.spendAmount(txns[1]), -40);
    // Cash: checking 1 and cash 3; savings 2. Moving money to savings or paying a card lowers
    // cash, bringing it back from savings raises it, a refund to the debit card adds.
    const accounts = [{ id: 1, kind: 'corriente', balance: 1000, updatedAt: '2026-09-01' }, { id: 2, kind: 'ahorros', balance: 0 }, { id: 3, kind: 'efectivo', balance: 0, updatedAt: '2026-09-01' }];
    const moves = [
        { type: 'Transferencia', amount: 300, date: '2026-09-02', from: 'acc-1', to: 'acc-2' },
        { type: 'Transferencia', amount: 100, date: '2026-09-03', from: 'acc-2', to: 'acc-1' },
        { type: 'Transferencia', amount: 250, date: '2026-09-04', from: 'acc-1', to: 'debt-7' },
        { type: 'Transferencia', amount: 60, date: '2026-09-05', from: 'acc-1', to: 'acc-3' },
        { type: 'Gasto', amount: 25, date: '2026-09-06', refund: true, paymentType: 'Tarjeta de Débito' }
    ];
    assert.equal(E.cashNow(accounts, moves, new Date(2026, 8, 15)).adjust, -300 + 100 - 250 + 0 + 25);
});

test('a debt payment pays the month\'s interest first, then lowers the balance', () => {
    assert.equal(E.debtMonthlyInterest({ balance: 4795.62, rate: 23.9 }), 95.51);
    assert.deepEqual(E.applyDebtPayment(4795.62, 300, 95.51), { interest: 95.51, principal: 204.49, balance: 4591.13, overpaid: 0 });
    // Paying it off: never below zero, and anything extra is reported.
    assert.deepEqual(E.applyDebtPayment(150, 200, 3), { interest: 3, principal: 150, balance: 0, overpaid: 47 });
    // A payment smaller than the interest only covers interest.
    assert.deepEqual(E.applyDebtPayment(1000, 10, 20), { interest: 10, principal: 0, balance: 1000, overpaid: 0 });
});

test('debt balance history comes from the logged payments', () => {
    const debts = [
        { balance: 800, payments: [{ date: '2026-08-10', principal: 100 }, { date: '2026-09-10', principal: 100 }] },
        { balance: 500 }
    ];
    const h = E.debtBalanceHistory(debts, new Date(2026, 8, 20), 3);
    assert.deepEqual(h.map(x => x.month), ['2026-07', '2026-08', '2026-09']);
    assert.deepEqual(h.map(x => x.total), [1500, 1400, 1300]);
});

test('annual bills: monthly set-aside and whether the fund covers each bill in time', () => {
    const bills = [
        { name: 'Car insurance', amount: 600, every: 6, month: 3 },     // Mar & Sep
        { name: 'Registration', amount: 120, every: 12, month: 11 },
        { name: 'Prime', amount: 139, every: 12, month: 1 }
    ];
    assert.equal(E.annualSetAside(bills), 100 + 10 + 11.58);
    assert.ok(E.billDueIn(bills[0], 9) && E.billDueIn(bills[0], 3) && !E.billDueIn(bills[0], 6));
    // From October with an empty fund: Nov registration fine, Jan Prime fine, March insurance short.
    const p = E.annualBillsPlan(bills, { start: 0, today: new Date(2026, 9, 2) });
    assert.equal(p.yearly, 1459);
    assert.equal(p.rows[0].key, '2026-10');
    assert.equal(p.rows[1].paid, 120);
    assert.equal(p.firstShort.key, '2027-03');
    // Starting with what's needed, it never runs short.
    assert.equal(E.annualBillsPlan(bills, { start: p.needed, today: new Date(2026, 9, 2) }).firstShort, null);
});

test('a purchase paid from a savings fund does not count in the month\'s budget again', () => {
    const items = [{ id: 1, name: 'Viajes', linkedCategory: 'Viajes', real: 50 }];
    const txns = [{ id: 1, type: 'Gasto', parentCategory: 'Viajes', amount: 900, date: '2026-09-05', fromGoal: 3 }, { id: 2, type: 'Gasto', parentCategory: 'Viajes', amount: 40, date: '2026-09-06' }];
    assert.equal(E.lineSpend(items, txns, 2026, '9').byLine['1'].spent, 40);
    assert.equal(E.categorySpend(txns, 'Viajes', 2026, '9'), 40);
    assert.equal(E.categoryBreakdown(txns, { from: '2026-09-01', to: '2026-09-30' }).total, 940);   // reports still see it
});

test('subscription finder: steady rhythm and amount, not tracked, still active', () => {
    const t = (id, date, amount, d = 'Planet Fitness', extra = {}) => Object.assign({ id, type: 'Gasto', description: d, store: d, amount, date, parentCategory: 'Salud' }, extra);
    const txns = [
        t(1, '2026-06-15', 24.99), t(2, '2026-07-15', 24.99), t(3, '2026-08-15', 24.99), t(4, '2026-09-15', 24.99),
        // groceries every week but different amounts: not a subscription
        t(10, '2026-09-01', 120, 'Meijer'), t(11, '2026-09-08', 64, 'Meijer'), t(12, '2026-09-15', 181, 'Meijer'), t(13, '2026-09-22', 92, 'Meijer'),
        // already tracked as repeating
        t(20, '2026-07-02', 15.49, 'Netflix'), t(21, '2026-08-02', 15.49, 'Netflix'), t(22, '2026-09-02', 15.49, 'Netflix'),
        // stopped in March: canceled
        t(30, '2026-01-10', 9.99, 'Old App'), t(31, '2026-02-10', 9.99, 'Old App'), t(32, '2026-03-10', 9.99, 'Old App'),
        // yearly
        t(40, '2025-07-20', 139, 'Amazon Prime'), t(41, '2026-07-21', 139, 'Amazon Prime')
    ];
    const found = E.findRepeating(txns, { recurring: [{ description: 'Netflix', store: 'Netflix' }], today: new Date(2026, 9, 2) });
    assert.deepEqual(found.map(f => [f.name, f.frequency]), [['Planet Fitness', 'monthly'], ['Amazon Prime', 'yearly']]);
    assert.equal(found[0].yearly, 299.88);
    assert.equal(found[0].next, '2026-10-15');
    assert.deepEqual(found[0].ids, [1, 2, 3, 4]);
    assert.equal(E.findRepeating(txns, { dismissed: [E.repeatKey({ store: 'Planet Fitness' })], recurring: [{ description: 'Netflix' }], today: new Date(2026, 9, 2) }).length, 1);
});

test('month review: over and under lines, unassigned expenses and the leftover', () => {
    const items = [
        { id: 1, name: 'Comida', linkedCategory: 'Alimentación', real: 400, type: 'Gasto Variable' },
        { id: 2, name: 'Ropa', linkedCategory: 'Vestimenta', real: 100, type: 'Gasto Variable' },
        { id: 3, name: 'Ahorro', linkedCategory: 'Ahorro e Inversión', real: 200, type: 'Ahorro' }
    ];
    const txns = [
        { id: 1, type: 'Ingreso', parentCategory: 'Sueldo', amount: 1000, date: '2026-09-01' },
        { id: 2, type: 'Gasto', parentCategory: 'Alimentación', amount: 450, date: '2026-09-05' },
        { id: 3, type: 'Gasto', parentCategory: 'Vestimenta', amount: 30, date: '2026-09-09' },
        { id: 4, type: 'Gasto', parentCategory: 'Mascotas', amount: 20, date: '2026-09-10' },
        { id: 5, type: 'Gasto', parentCategory: 'Ahorro e Inversión', amount: 200, date: '2026-09-11' },
        { id: 6, type: 'Gasto', parentCategory: 'Alimentación', amount: 99, date: '2026-10-01' }
    ];
    const r = E.monthReview({ items, transactions: txns, year: 2026, month: '9' });
    assert.equal(r.key, '2026-09');
    assert.deepEqual(r.over.map(l => [l.name, l.left]), [['Comida', -50]]);
    assert.deepEqual(r.under.map(l => [l.name, l.left]), [['Ropa', 70]]);    // savings lines aren't "left over"
    assert.deepEqual(r.unassigned, { count: 1, total: 20 });
    assert.deepEqual([r.income, r.spent, r.leftover, r.planned], [1000, 700, 300, 700]);
    assert.equal(r.count, 5);
});

test('net worth month by month keeps one entry per month, oldest first', () => {
    let h = E.recordNetWorthMonth([], '2026-09', { assets: 1000, liabilities: 400 });
    h = E.recordNetWorthMonth(h, '2026-08', { assets: 900, liabilities: 400 });
    h = E.recordNetWorthMonth(h, '2026-09', { assets: 1100, liabilities: 400 });
    assert.deepEqual(h.map(x => [x.month, x.value]), [['2026-08', 500], ['2026-09', 700]]);
});

test('milestones: emergency fund, each debt, debt-free and net worth steps', () => {
    const debts = [{ id: 1, name: 'Visa', balance: 0, originalBalance: 3000 }, { id: 2, name: 'Car', balance: 6000, originalBalance: 12000 }];
    const m = E.milestones({ netWorth: 30000, liquid: 2500, monthsCovered: 1.5, debts });
    const by = Object.fromEntries(m.map(x => [x.key, x]));
    assert.equal(by.ef1000.done, true);
    assert.equal(by.ef3.done, false); assert.equal(by.ef3.progress, 0.5);
    assert.equal(by['debt-1'].done, true); assert.equal(by['debt-2'].progress, 0.5);
    assert.equal(by.debtfree.done, false); assert.equal(by.debtfree.progress, 0.6);
    assert.equal(by.nw0.done, true); assert.equal(by.nw25000.done, true); assert.equal(by.nw50000.progress, 0.6);
});

test('tags: normalized, parsed from a comma list, ranked by use; reports can count one in several groups', () => {
    assert.deepEqual(E.parseTags('Playa, #Boda  Ana; playa'), ['playa', 'boda-ana']);
    assert.equal(E.normTag('  ##Viaje Galápagos!  '), 'viaje-galápagos');
    assert.deepEqual(E.allTags([{ tags: ['a', 'b'] }, { tags: ['b'] }, {}]), ['b', 'a']);
    const r = E.monthlyByKey([{ date: '2026-09-02', amount: 10, tags: ['x', 'y'] }], t => t.tags, { end: new Date(2026, 8, 30), count: 1 });
    assert.deepEqual(r.series, { x: [10], y: [10] });
});

test('job-loss runway: months the money lasts, with benefits and income that continue', () => {
    // $9,000, $3,000/month of needs → 3 months.
    assert.equal(E.jobLossRunway({ cash: 9000, monthlyNeeds: 3000 }).months, 3);
    // A partner's $1,000 and 2 months of $1,500 benefit: 9000 → 9000-500 → 8000-500 → then -2000/month for 3.75.
    const r = E.jobLossRunway({ cash: 9000, monthlyNeeds: 3000, otherIncome: 1000, benefits: [1500, 1500] });
    assert.equal(r.months, 2 + 8000 / 2000);
    assert.deepEqual(r.path.slice(0, 3), [9000, 8500, 8000]);
    // Severance counts from day one; when income covers needs it lasts indefinitely.
    assert.equal(E.jobLossRunway({ cash: 0, lumpSum: 6000, monthlyNeeds: 2000 }).months, 3);
    assert.equal(E.jobLossRunway({ cash: 100, monthlyNeeds: 900, otherIncome: 1000 }).forever, true);
    assert.deepEqual(E.iessUnemployment(1000), [700, 650, 600, 550, 500]);
});

test('calculators: loan, credit card, compound growth, savings goal', () => {
    // $20,000 at 6% for 60 months: $386.66/month (standard amortization).
    assert.deepEqual(E.loanPayment(20000, 6, 60), { payment: 386.66, total: 23199.36, interest: 3199.36, months: 60 });
    assert.equal(E.loanPayment(1200, 0, 12).payment, 100);
    // $5,000 at 24% (2%/month) paying $200: −ln(1 − 0.02·5000/200)/ln 1.02 ≈ 35.0 → 36 payments.
    const c = E.cardPayoff(5000, 24, 200);
    assert.equal(c.fixed.months, 36);
    assert.ok(c.minimum.months > 100 && c.minimum.interest > c.fixed.interest * 2);
    assert.equal(E.cardPayoff(5000, 24, 90).fixed.never, true);           // below the interest
    // $10,000 + $500/month at 10% for 30 years ≈ $1.33M; contributions $190,000.
    const f = E.growthValue(10000, 500, 10, 30, 3);
    assert.equal(f.contributed, 190000);
    assert.ok(Math.abs(f.value - 1328568) < 1500, f.value);
    assert.ok(f.today < f.value / 2.3 && f.today > f.value / 2.5);
    assert.equal(E.monthlyToReach(1200, 0, 0, 12), 100);
    assert.equal(E.monthlyToReach(1000, 2000, 5, 12), 0);
});

test('next moves: urgent first, then the Baby Step, housekeeping last; snoozed ones hide', () => {
    const base = { hasIncome: true, hasData: true, step: 2, liquid: 1200, monthsCovered: 0.3, essential: 4000, unassigned: 0, income: 8000, savingsRate: 0, uncategorized: 0, backupDays: null,
        target: { name: 'Visa', balance: 900, rate: 24 } };
    let m = E.nextMoves(base);
    assert.deepEqual(m.map(x => x.key), ['snowball', 'backup']);
    m = E.nextMoves(Object.assign({}, base, { overdueBills: ['Luz'], unassigned: 300, uncategorized: 5 }));
    assert.deepEqual(m.map(x => x.key), ['overdue', 'unassigned', 'snowball']);
    assert.match(m[1].text, /snowball/);
    m = E.nextMoves(Object.assign({}, base, { overdueBills: ['Luz'] }), { snoozed: { overdue: '2099-01-01' } });
    assert.equal(m[0].key, 'snowball');
    assert.deepEqual(E.nextMoves({ hasIncome: false }).map(x => x.key), ['setup']);
    assert.equal(E.nextMoves(Object.assign({}, base, { step: 4, target: null, savingsRate: 0.05 })).find(x => x.key === 'retire15').text.includes('$800'), true);
});

test('retirement need vs have: the 4% rule, the pension, the bridge years and the monthly fix', () => {
    // $5,000/month wanted, $2,000 pension → $3,000 × 12 / 4% = $900,000.
    const g = E.retirementGap({ desiredMonthly: 5000, pensionMonthly: 2000, haveToday: 450000, months: 300, returnPct: 7, inflationPct: 3 });
    assert.equal(g.need, 900000);
    assert.equal(g.gap, 450000);
    assert.equal(g.pct, 0.5);
    // Real return 1.07/1.03 − 1 ≈ 3.88%/yr (0.318%/mo); over 300 months the annuity factor is
    // ≈ 500.7, so $450,000 ÷ 500.7 ≈ $899 more a month.
    assert.ok(Math.abs(g.extraMonthly - 898.78) < 0.02, g.extraMonthly);
    // Three years before the pension starts: those years come from savings too.
    assert.equal(E.retirementGap({ desiredMonthly: 5000, pensionMonthly: 2000, bridgeYears: 3 }).need, 900000 + 72000);
    assert.equal(E.retirementGap({ desiredMonthly: 3000, pensionMonthly: 1000, haveToday: 900000, months: 120 }).extraMonthly, 0);
});

test('health score: eight indicators, bands, and missing data left out', () => {
    const good = E.healthScore({ spendRatio: 0.85, overdue: 0, monthsCovered: 4, savingsRate: 0.16, debtToIncome: 0.05, costlyDebtRatio: 0, unassignedRatio: 0, retirePct: 1.2 });
    assert.equal(good.score, 100); assert.equal(good.band, 'sano');
    const mid = E.healthScore({ spendRatio: 1.0, overdue: 1, monthsCovered: 1.5, savingsRate: 0.05, debtToIncome: 0.23, costlyDebtRatio: 0.03, unassignedRatio: 0.03, retirePct: 0.5 });
    // 50, 50, 50, 33, 50, 80, 60, 50 → 52.875 → 53
    assert.equal(mid.score, 53); assert.equal(mid.band, 'camino');
    assert.equal(mid.weakest.key, 'longTerm');
    const partial = E.healthScore({ overdue: 0, monthsCovered: 0 });
    assert.equal(partial.score, 50);
    assert.equal(partial.pillars.find(p => p.key === 'borrow').score, null);
    assert.equal(E.healthScore({}).score, null);
});

test('budget coaching: shares vs guidelines, lines always over, lines barely used', () => {
    const buckets = [{ key: 'vivienda', label: 'Vivienda', amount: 2400 }, { key: 'ahorro', label: 'Ahorro', amount: 300 }, { key: 'comida', label: 'Comida', amount: 600 }, { key: 'dar', label: 'Dar', amount: 500 }];
    const items = [{ id: 1, name: 'Comida', linkedCategory: 'Alimentación', real: 400, type: 'Gasto Variable' }, { id: 2, name: 'Gimnasio', linkedCategory: 'Salud', real: 100, type: 'Gasto Variable' }];
    const txns = [];
    ['2026-06', '2026-07', '2026-08', '2026-09'].forEach((m, i) => {
        txns.push({ id: i * 2 + 1, type: 'Gasto', parentCategory: 'Alimentación', amount: i === 0 ? 380 : 480, date: m + '-10' });
        txns.push({ id: i * 2 + 2, type: 'Gasto', parentCategory: 'Salud', amount: 20, date: m + '-12' });
    });
    const c = E.budgetCoach({ buckets, income: 5000, itemsFor: () => items, transactions: txns, today: new Date(2026, 9, 2) });
    const by = Object.fromEntries(c.ranges.map(r => [r.key, r]));
    assert.equal(by.vivienda.status, 'alto');   // 48% > 35%
    assert.equal(by.ahorro.status, 'bajo');     // 6% < 10%
    assert.equal(by.comida.status, 'ok');       // 12%
    assert.deepEqual(c.chronicOver.map(l => [l.name, l.months, l.avgOver]), [['Comida', 3, 80]]);
    assert.deepEqual(c.underUsed.map(l => [l.name, l.left]), [['Gimnasio', 80]]);
    // A seasonal line (all of it spent in December) isn't "barely used" in October.
    const xmas = [{ id: 3, name: 'Navidad', linkedCategory: 'Regalos', real: 100, type: 'Gasto Variable' }];
    const gifts = [{ id: 90, type: 'Gasto', parentCategory: 'Regalos', amount: 1100, date: '2025-12-15' }, { id: 91, type: 'Gasto', parentCategory: 'Regalos', amount: 10, date: '2026-09-15' }];
    assert.deepEqual(E.budgetCoach({ buckets: [], income: 5000, itemsFor: () => xmas, transactions: gifts, today: new Date(2026, 9, 2) }).underUsed, []);
});

test('insurance check: what to have, guessed from the budget, answers win', () => {
    const r = E.insuranceCheck({ income: 90000, dependents: true, lifeCoverage: 500000, ownsHome: true, hasCar: true, netWorth: 300000, age: 40,
        seen: ['Seguro Vehicular', 'Health insurance premium', 'Term life – Haven Life'] });
    const by = Object.fromEntries(r.items.map(i => [i.key, i]));
    assert.equal(by.auto.status, 'ok'); assert.equal(by.auto.guessed, true);
    assert.equal(by.health.status, 'ok');
    assert.equal(by.life.status, 'revisar');        // $500k < 10 × $90k
    assert.equal(r.lifeGap, 400000);
    assert.equal(by.disability.status, 'falta');
    assert.equal(by.home.label, "Homeowner's insurance");
    assert.equal(by.umbrella.status, 'na'); assert.equal(by.ltc.status, 'na');
    assert.equal(r.missing, 2);                       // disability, home
    const r2 = E.insuranceCheck({ income: 90000, dependents: false, answers: { home: 'si', disability: 'si', health: 'no' }, seen: ['Seguro médico'] });
    const by2 = Object.fromEntries(r2.items.map(i => [i.key, i]));
    assert.equal(by2.life.status, 'na'); assert.equal(by2.health.status, 'falta'); assert.equal(by2.home.label, "Renter's insurance");
});

test('college estimator: future cost, projected savings, gap and monthly needed', () => {
    // Age 8 → starts in 10 years; $25,000/yr growing 5%: years 10..13 cost 25000·1.05^10…1.05^13.
    const c = E.collegePlan({ age: 8, annualCost: 25000, costInflation: 5, saved: 10000, monthly: 200, returnPct: 6 });
    const expected = [10, 11, 12, 13].reduce((a, k) => a + 25000 * Math.pow(1.05, k), 0);
    assert.ok(Math.abs(c.total - expected) < 0.01, c.total);
    assert.equal(c.yearsToStart, 10);
    assert.equal(c.projected, E.growthValue(10000, 200, 6, 10).value);
    assert.equal(c.gap, Math.round((c.total - c.projected) * 100) / 100);
    // Saving the monthly amount it suggests (on top of what's saved) covers the total.
    assert.ok(Math.abs(E.growthValue(10000, c.monthlyNeeded, 6, 10).value - c.total) < 1);
    // Already in college: no months left to save.
    assert.equal(E.collegePlan({ age: 19, annualCost: 1000 }).monthlyNeeded, null);
});

test('US refund or owe: household tax vs withholding, and the W-4 fix per paycheck', () => {
    const U = require('../js/defaults-us.js');
    const yd = Object.assign(U.newYear(), { filingStatus: 'mfj', dependents: 2, otherDependents: 0, itemized: 0 });
    // MFJ 2026: $100,000 − $32,200 standard = $67,800 taxable → 10% × 24,800 + 12% × 43,000 = $7,640; − 2 × $2,200 = $3,240.
    const r = E.usRefundEstimate({ yd, wagesIncome: 100000, withheldYtd: 2000, perCheck: 100, checksLeft: 6 });
    assert.equal(r.tax, 3240);
    assert.equal(r.withheld, 2600);
    assert.equal(r.diff, -640);
    assert.equal(r.adjustPerCheck, 106.67);
    assert.equal(r.penaltyRisk, false);
    // A spouse's wages and withholding count; a big refund suggests withholding less.
    const r2 = E.usRefundEstimate({ yd, wagesIncome: 100000, otherWages: 0, otherWithheld: 0, withheldYtd: 6000, perCheck: 300, checksLeft: 4 });
    assert.equal(r2.diff, 7200 - 3240);
    assert.equal(r2.refund, true);
    assert.equal(r2.adjustPerCheck, -990);
});

test('side income: what to set aside (US self-employment + income tax + state; Ecuador SRI table)', () => {
    const U = require('../js/defaults-us.js');
    const yd = Object.assign(U.newYear(), { filingStatus: 'mfj' });
    // $10,000 net: SE = 10,000 × 0.9235 × 15.3% = $1,412.96; QBI = 20% × (10,000 − 706.48) = $1,858.70;
    // added income $7,434.82, all in the 12% bracket above $50,000 taxable → $892.18; state 4.25% → $425.
    const r = E.sideIncomeTax({ country: 'US', net: 10000, yd, wages: 80000, taxableBefore: 50000, stateRate: 4.25 });
    assert.equal(r.parts.se, 1412.96);
    assert.ok(Math.abs(r.parts.fed - 892.18) < 0.02, r.parts.fed);
    assert.equal(r.parts.state, 425);
    assert.ok(Math.abs(r.pct - 0.2730) < 0.001, r.pct);
    // Over the Social Security wage base, only Medicare (2.9%) is left.
    assert.equal(E.sideIncomeTax({ country: 'US', net: 10000, yd, wages: 200000, taxableBefore: 150000 }).parts.se, 267.82);
    // Ecuador: the difference the SRI table makes on the taxable base.
    const ec = D.newYear();
    const x = E.sideIncomeTax({ country: 'EC', net: 10000, yd: ec, ecBase: 20000 });
    assert.equal(x.total, Math.round((E.incomeTax(30000, ec.sriBrackets) - E.incomeTax(20000, ec.sriBrackets)) * 100) / 100);
    assert.equal(E.sideIncomeTax({ net: 0, yd }).total, 0);
});

test('Ecuador personal expenses: SRI categories, invoices, rebate vs cap', () => {
    const t = (id, cat, sub, amount, extra = {}) => Object.assign({ id, type: 'Gasto', parentCategory: cat, category: sub, amount, date: '2026-05-10' }, extra);
    const txns = [
        t(1, 'Alimentación', 'Mercado/Supermercado', 300, { source: 'sri' }),
        t(2, 'Alimentación', 'Restaurantes', 80, { source: 'sri' }),          // restaurants don't count
        t(3, 'Salud', 'Medicinas', 120, { factura: true }),
        t(4, 'Vivienda', 'Hipoteca', 900, { factura: true }),                 // only the interest counts
        t(5, 'Servicios Básicos y Comunicación', 'Energía Eléctrica', 40),     // no invoice marked
        t(6, 'Educación', 'Útiles Escolares', 60, { factura: true, date: '2025-09-01' })   // another year
    ];
    const r = E.sriPersonalExpenses(txns, 2026, { cap: 400 });
    const by = Object.fromEntries(r.groups.map(g => [g.key, g]));
    assert.equal(by.alimentacion.total, 300); assert.equal(by.salud.invoiced, 120); assert.equal(by.vivienda.total, 40); assert.equal(by.vivienda.invoiced, 0);
    assert.equal(r.total, 460); assert.equal(r.invoiced, 420);
    assert.equal(r.rebate, 72);           // 18% × min(420, 400)
    assert.equal(r.missingInvoices, 0);   // the invoiced part already passes the cap
    assert.equal(E.sriPersonalExpenses(txns, 2026, { cap: 1000 }).missingInvoices, 40);
});

test('itemize or standard (US 2026): SALT cap, charity and medical floors, tax each way', () => {
    const yd = usYear({ filingStatus: 'mfj', dependents: 2 });
    const a = E.usItemizeCheck({ yd, income: 150000, mortgageInterest: 15000, saltIncome: 6000, propertyTax: 4000, charity: 5000, medical: 3000 });
    assert.deepEqual(a.items.map(i => i.amount), [15000, 10000, 4250, 0]);   // charity − 0.5% × 150,000; medical under 7.5%
    assert.equal(a.itemized, 29250); assert.equal(a.stdCharity, 2000); assert.equal(a.standardTotal, 34200);
    assert.equal(a.itemize, false); assert.equal(a.short, 4950);
    assert.equal(a.taxStandard, 10500);   // (150,000 − 34,200) through the joint brackets − $4,400 credits
    const b = E.usItemizeCheck({ yd, income: 150000, mortgageInterest: 25000, saltIncome: 6000, propertyTax: 4000, charity: 5000, medical: 3000 });
    assert.equal(b.itemize, true); assert.equal(b.taxItemized, 9389); assert.equal(b.saving, 1111);
    // SALT cap shrinks 30% of income above $505,000, never under $10,000.
    const c = E.usItemizeCheck({ yd: usYear({ filingStatus: 'single' }), income: 600000, saltIncome: 30000, propertyTax: 9000 });
    assert.equal(c.saltCap, 11900); assert.equal(c.items[1].amount, 11900);
    assert.equal(E.usItemizeCheck({ yd: usYear({}), income: 900000, saltIncome: 50000 }).saltCap, 10000);
    // The refund estimate takes the gifts that come off the standard deduction too (12% bracket here).
    const ref = (x) => E.usRefundEstimate({ yd, wagesIncome: 90000, stdExtra: x }).tax;
    assert.equal(Math.round((ref(0) - ref(2000)) * 100) / 100, 240);
    const i = E.loanInterestAhead(100000, 6, E.loanPayment(100000, 6, 360).payment, 12);
    assert.ok(i > 5900 && i < 6000, String(i));
});

test('investments: cost and gain, mix by asset class, drift, rebalancing and new money only', () => {
    const H = [{ id: 1, ticker: 'VTI', shares: 24, price: 318.42, cost: 6120 }, { id: 2, ticker: 'vxus', shares: 61, price: 71.15, cost: 3660 },
        { id: 3, ticker: 'BND', shares: 28, price: 73.86, cost: 2030 }, { id: 4, ticker: 'XYZ', kind: 'Cripto', shares: 0, price: 10 }];
    assert.deepEqual(H.map(E.assetClassOf), ['us', 'intl', 'bonds', 'other']);
    assert.equal(E.assetClassOf({ ticker: 'VTI', asset: 'bonds' }), 'bonds');   // set by hand wins
    const m = E.portfolioMix(H, { us: 60, intl: 30, bonds: 10 }, { newMoney: 500 });
    assert.equal(m.total, 14050.31); assert.equal(m.cost, 11810); assert.equal(m.gain, 2240.31);
    close(m.drift, 5.609, 0.001); assert.equal(m.rebalance, true);
    const by = Object.fromEntries(m.classes.map(c => [c.key, c]));
    assert.equal(by.us.diff, 788.11); assert.equal(by.bonds.diff, -663.05);
    close(m.classes.reduce((a, c) => a + c.diff, 0), 0);                        // buys and sells net out
    assert.deepEqual(m.split, [{ key: 'us', amount: 488.8 }, { key: 'intl', amount: 11.2 }]);
    close(m.split.reduce((a, x) => a + x.amount, 0), 500);
    // Targets that don't add to 100 are taken proportionally; no target → no rebalancing.
    close(E.portfolioMix(H, { us: 6, intl: 3, bonds: 1 }).drift, m.drift, 1e-9);
    const none = E.portfolioMix(H, null);
    assert.equal(none.hasTarget, false); assert.equal(none.rebalance, false); assert.deepEqual(none.split, []);
    assert.equal(E.portfolioMix([{ ticker: 'VOO', shares: 1, price: 500 }], null).gain, null);   // no cost entered
});

test('prepay the mortgage or invest: both paths, interest saved, break-even return', () => {
    const P = E.loanPayment(250000, 6.5, 300).payment;
    const a = E.prepayOrInvest({ balance: 250000, ratePct: 6.5, payment: P, extra: 300, returnPct: 10, gainsTaxPct: 15 });
    assert.equal(a.horizon, 300); assert.equal(a.prepayMonths, 212); assert.equal(a.monthsSooner, 88);
    assert.ok(a.interestSaved > 85000 && a.interestSaved < 86000, String(a.interestSaved));
    assert.equal(a.winner, 'invest'); assert.ok(a.diff > 100000);
    close(a.breakEven, 7.04, 0.01);                       // above the 6.5% rate: the gains tax
    const b = E.prepayOrInvest({ balance: 250000, ratePct: 6.5, payment: P, extra: 300, returnPct: 5 });
    assert.equal(b.winner, 'prepay');
    close(b.breakEven, 6.5, 0.001);                       // no taxes: even exactly at the mortgage rate
    // Deducting the interest lowers the mortgage's real cost, so the break-even drops.
    assert.ok(E.prepayOrInvest({ balance: 250000, ratePct: 6.5, payment: P, extra: 300, returnPct: 5, deductPct: 22 }).breakEven < 6.5);
    assert.equal(E.prepayOrInvest({ balance: 100000, ratePct: 12, payment: 900, extra: 100, returnPct: 8 }).never, true);  // payment under the interest
});

test('rate sensitivity: a loan at ±1 point, certificates renewing 1 point lower', () => {
    const sc = E.loanRateScenarios('frances', 272000, 6.25, 360);
    assert.deepEqual(sc.map(x => x.rate), [5.25, 6.25, 7.25]);
    assert.deepEqual(sc.map(x => x.payment), [1501.99, 1674.75, 1855.52]);
    assert.ok(sc[0].totalInterest < sc[1].totalInterest && sc[1].totalInterest < sc[2].totalInterest);
    assert.equal(E.loanRateScenarios('frances', 1000, 0.5, 12, [-1])[0].rate, 0);      // never below 0
    const pol = [{ amount: 10000, rate: 5, days: 90, maturityDate: '2026-11-20' }, { amount: 5000, rate: 4, days: 365, maturityDate: '2027-02-01' }, { amount: 0, rate: 9 }];
    const r = E.cdRenewalRisk(pol, 'US', { today: new Date(2026, 9, 3) });
    assert.equal(r.count, 2); assert.equal(r.yearly, 700); assert.equal(r.lower, 550); assert.equal(r.loss, 150);   // APY on a full year
    assert.equal(r.nextRenewal, '2026-11-20');
    assert.equal(E.cdRenewalRisk([], 'EC').loss, 0);
});

test('renaming a category or subcategory carries the new name everywhere it is saved', () => {
    const st = {
        taxonomy: { expense: { 'Alimentación': ['Mercado/Supermercado', 'Restaurantes'], 'Hogar': ['Muebles'] }, income: { 'Ingresos Laborales': ['Sueldo/Salario'] } },
        transactions: [{ type: 'Gasto', parentCategory: 'Alimentación', category: 'Restaurantes' }, { type: 'Ingreso', parentCategory: 'Alimentación', category: 'x' }, { parentCategory: 'Hogar', category: 'Muebles' }],
        recurring: [{ type: 'Gasto', parentCategory: 'Alimentación', category: 'Mercado/Supermercado' }],
        rules: [{ contains: 'kroger', category: 'Alimentación', sub: 'Mercado/Supermercado' }, { contains: 'xfer', type: 'Transferencia', category: '' }],
        years: { 2026: { budgetBase: [{ linkedCategory: 'Alimentación' }], monthOverrides: { 3: [{ linkedCategory: 'Alimentación' }] }, otherIncomes: [] } },
        settings: {}
    };
    assert.equal(E.renameCategory(st, { kind: 'expense', category: 'Alimentación', to: 'Food' }), 5);
    assert.deepEqual(Object.keys(st.taxonomy.expense), ['Food', 'Hogar']);                 // same place in the list
    assert.deepEqual([st.transactions[0].parentCategory, st.transactions[1].parentCategory], ['Food', 'Alimentación']);   // income untouched
    assert.equal(st.rules[0].category, 'Food');
    assert.equal(st.years[2026].monthOverrides[3][0].linkedCategory, 'Food');
    assert.equal(E.renameCategory(st, { kind: 'expense', category: 'Food', sub: 'Restaurantes', to: 'Eating out' }), 1);
    assert.deepEqual(st.taxonomy.expense.Food, ['Mercado/Supermercado', 'Eating out']);
    assert.equal(st.transactions[0].category, 'Eating out');
    assert.equal(E.renameCategory(st, { kind: 'expense', category: 'Food', to: 'Hogar' }), 0);   // name taken
    // The statement reader still guesses with the original names: they follow the renames.
    assert.deepEqual(E.renamedCategory(st.settings, 'expense', 'Alimentación', 'Restaurantes'), { category: 'Food', sub: 'Eating out' });
    assert.deepEqual(E.renamedCategory(st.settings, 'expense', 'Alimentación', 'Mercado/Supermercado'), { category: 'Food', sub: 'Mercado/Supermercado' });
    E.renameCategory(st, { kind: 'expense', category: 'Food', to: 'Groceries & dining' });
    assert.equal(E.renamedCategory(st.settings, 'expense', 'Alimentación').category, 'Groceries & dining');
});

test('household (shared) is its own row in the member totals', () => {
    const t = (memberId, amount, type = 'Gasto') => ({ type, date: '2026-03-10', amount, memberId, parentCategory: 'Vivienda', category: 'x' });
    const r = E.memberTotals([t(1, 100), t(E.HOUSEHOLD, 1500), t(undefined, 20), t(2, 3000, 'Ingreso')], [{ id: 1, name: 'Ana' }, { id: 2, name: 'Luis' }], 2026, 3);
    assert.deepEqual(r.rows.map(x => [x.name, x.expense, x.income]), [['Ana', 100, 0], ['Luis', 0, 3000], ['Household', 1500, 0], ['Sin asignar', 20, 0]]);
    assert.ok(E.HOUSEHOLD_CATEGORIES.includes('Vivienda'));
});

test('accounts: a balance follows the imported rows; cards count as owed once', () => {
    const rows = [{ type: 'Gasto', amount: 50 }, { type: 'Ingreso', amount: 1000 }, { type: 'Transferencia', amount: 300, signed: -300 }, { type: 'Transferencia', amount: 20 }];
    assert.equal(E.balanceAfterRows(100, rows), 750);                       // −50 +1000 −300; a transfer with no sign doesn't move it
    assert.equal(E.balanceAfterRows(-200, [{ type: 'Gasto', amount: 80 }, { type: 'Transferencia', amount: 200, signed: 200 }]), -80);   // card: spend, then a payment
    const accounts = [{ id: 1, kind: 'corriente', balance: 900 }, { id: 2, kind: 'tarjeta', balance: -350 }, { id: 3, kind: 'tarjeta', balance: -1000, debtId: 7 }];
    const nw = E.netWorthFromSources({ accounts, debts: [{ id: 7, kind: 'tarjeta', balance: 1000 }] });
    assert.equal(nw.checking, 900);
    assert.equal(nw.creditCards, 1350);                                     // 1,000 through its debt + 350 unlinked
});

test('where a transaction came from; typed ones are reconciled once a statement matched them', () => {
    assert.equal(E.txnOrigin({ source: 'csv' }), 'imported');
    assert.equal(E.txnOrigin({ source: 'ofx', importRef: 'x' }), 'imported');
    assert.equal(E.txnOrigin({ recurringId: 3 }), 'scheduled');
    assert.equal(E.txnOrigin({ createdAt: '2026-01-01' }), 'typed');
    assert.equal(E.isReconciled({ importRef: 'abc' }), true);              // typed, matched by an import
    assert.equal(E.isReconciled({}), false);
    assert.equal(E.isReconciled({ source: 'csv', importRef: 'abc' }), false);   // imported isn't "reconciled typed"
});

test('spendingBreakdown: expenses by category in a period, per person, small ones folded', () => {
    const t = (date, cat, amount, extra = {}) => Object.assign({ date, type: 'Gasto', parentCategory: cat, amount }, extra);
    const list = [
        t('2026-10-01', 'Vivienda', 1200, { memberId: E.HOUSEHOLD }), t('2026-10-03', 'Alimentación', 300, { memberId: 1 }),
        t('2026-10-05', 'Alimentación', 50, { refund: true, memberId: 1 }), t('2026-10-06', 'Transporte', 80, { memberId: 2 }),
        t('2026-09-30', 'Ocio', 999), { date: '2026-10-02', type: 'Ingreso', parentCategory: 'Ingresos', amount: 4000 },
        { date: '2026-10-02', type: 'Transferencia', amount: 500 }
    ];
    const r = E.spendingBreakdown(list, { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(r.rows.map(x => [x.key, x.total, x.count]), [['Vivienda', 1200, 1], ['Alimentación', 250, 2], ['Transporte', 80, 1]]);
    assert.equal(r.total, 1530);
    assert.ok(Math.abs(r.rows[0].share - 1200 / 1530) < 1e-9);
    assert.deepEqual(E.spendingBreakdown(list, { from: '2026-10-01', to: '2026-10-31', who: E.HOUSEHOLD }).rows.map(x => x.key), ['Vivienda']);
    assert.equal(E.spendingBreakdown(list, { from: '2026-10-01', to: '2026-10-31', who: 1 }).total, 250);
    // More categories than colors: the smallest fold into one row.
    const many = ['A', 'B', 'C', 'D'].map((c, i) => t('2026-10-01', c, 100 - i * 10));
    const f = E.spendingBreakdown(many, { from: '2026-10-01', to: '2026-10-31', max: 3 });
    assert.deepEqual(f.rows.map(x => [x.key, x.total]), [['A', 100], ['B', 90], [null, 150]]);
    assert.deepEqual(f.rows[2].other, ['C', 'D']);
});

test('categoryTrend: spending by category per month, income line, account and category filters', () => {
    const t = (date, cat, amount, extra = {}) => Object.assign({ date, type: 'Gasto', parentCategory: cat, amount }, extra);
    const list = [
        t('2026-08-03', 'Alimentación', 100, { accountId: 1 }), t('2026-09-03', 'Alimentación', 120, { accountId: 2, category: 'Supermercado' }),
        t('2026-10-02', 'Vivienda', 900, { accountId: 1 }), t('2026-10-05', 'Alimentación', 30, { category: 'Restaurantes' }),
        t('2026-04-01', 'Ocio', 500),                                         // before the window
        { date: '2026-10-01', type: 'Ingreso', amount: 3000, accountId: 1 }, { date: '2026-10-01', type: 'Transferencia', amount: 400 }
    ];
    const r = E.categoryTrend(list, { end: new Date(2026, 9, 6), months: 3 });
    assert.deepEqual(r.months, ['2026-08', '2026-09', '2026-10']);
    assert.deepEqual(r.series.map(x => [x.key, x.values]), [['Vivienda', [0, 0, 900]], ['Alimentación', [100, 120, 30]]]);
    assert.deepEqual(r.income, [0, 0, 3000]);
    assert.deepEqual(r.spend, [100, 120, 930]);
    // One account; transactions with no account.
    assert.deepEqual(E.categoryTrend(list, { end: new Date(2026, 9, 6), months: 3, account: 1 }).spend, [100, 0, 900]);
    assert.deepEqual(E.categoryTrend(list, { end: new Date(2026, 9, 6), months: 3, account: 'none' }).spend, [0, 0, 30]);
    // One category: its subcategories, no income line.
    const one = E.categoryTrend(list, { end: new Date(2026, 9, 6), months: 3, category: 'Alimentación' });
    assert.deepEqual(one.series.map(x => x.key), ['Supermercado', 'Alimentación', 'Restaurantes']);
    assert.equal(one.income, null);
    // Folding.
    const f = E.categoryTrend(['A', 'B', 'C'].map((c, i) => t('2026-10-01', c, 30 - i)), { end: new Date(2026, 9, 6), months: 1, max: 2 });
    assert.deepEqual(f.series.map(x => [x.key, x.values[0]]), [['A', 30], [null, 57]]);
});

test('budgetBubbles: lines grouped by category, planned vs spent, state by share spent', () => {
    const items = [
        { id: 1, name: 'Rent', real: 1000, linkedCategory: 'Vivienda' }, { id: 2, name: 'Repairs', real: 100, linkedCategory: 'Vivienda' },
        { id: 3, name: 'Groceries', real: 500, linkedCategory: 'Alimentación' }, { id: 4, name: 'Fun', real: 50, linkedCategory: 'Entretenimiento y Ocio' },
        { id: 5, name: 'Nothing', real: 0, linkedCategory: 'Mascotas' }, { id: 6, name: 'Unplanned', real: 0 }
    ];
    const spent = { 1: 1000, 2: 0, 3: 200, 4: 80, 5: 0, 6: 15 };
    const r = E.budgetBubbles(items, id => spent[id]);
    assert.deepEqual(r.map(b => [b.category, b.planned, b.spent, b.state]), [
        ['Vivienda', 1100, 1000, 'warn'], ['Alimentación', 500, 200, 'ok'], ['Entretenimiento y Ocio', 50, 80, 'over'], ['Otros', 0, 15, 'over']]);
    assert.deepEqual(r[0].lines.map(l => l.name), ['Rent', 'Repairs']);
    assert.equal(r[3].share, null);
});

test('cashEvents: one-off events in the window join the forecast', () => {
    const oneOff = [{ id: 1, date: '2026-10-10', name: 'Tax refund', amount: 900 }, { id: 2, date: '2026-10-20', name: 'Car repair', amount: -1500 }, { id: 3, date: '2026-12-01', name: 'Later', amount: -50 }];
    const ev = E.cashEvents({ from: '2026-10-06', to: '2026-10-31', months: [], recurring: [], oneOff });
    assert.deepEqual(ev.map(e => [e.date, e.kind, e.name, e.amount]), [['2026-10-10', 'oneoff', 'Tax refund', 900], ['2026-10-20', 'oneoff', 'Car repair', -1500]]);
    const f = E.cashForecast({ from: '2026-10-06', to: '2026-10-31', start: 400, events: ev });
    assert.equal(f.find(d => d.date === '2026-10-10').balance, 1300);
    assert.equal(f.find(d => d.date === '2026-10-20').balance, -200);
    assert.equal(f.find(d => d.date === '2026-10-20').status, 'short');
});

test('debtPayoff: each debt\'s balance month by month adds up to the total', () => {
    const debts = [{ id: 1, name: 'Card', balance: 1000, rate: 20, minPayment: 50 }, { id: 2, name: 'Car', balance: 5000, rate: 6, minPayment: 200 }];
    const p = E.debtPayoff(debts, 'snowball', 100);
    assert.equal(p.byDebt[1].length, p.months);
    assert.equal(p.byDebt[2].length, p.months);
    p.history.forEach((t, i) => assert.ok(Math.abs(t - p.byDebt[1][i] - p.byDebt[2][i]) < 1e-6));
    const first = p.items.find(i => i.id === 1).payoffMonth;
    assert.equal(p.byDebt[1][first - 1], 0);
    assert.ok(p.byDebt[1][first - 2] > 0);
    assert.equal(p.byDebt[2][p.months - 1], 0);
});

test('accountsHub: everything by type, a linked card once, totals', () => {
    const r = E.accountsHub({
        accounts: [{ id: 1, name: 'Checking', kind: 'corriente', balance: 1200 }, { id: 2, name: 'Savings', kind: 'ahorros', balance: 5000 },
            { id: 3, name: 'Visa', kind: 'tarjeta', balance: -800, debtId: 9 }, { id: 4, name: 'Store card', kind: 'tarjeta', balance: -150 },
            { id: 5, name: '401k', kind: 'retiro', balance: 20000 }, { id: 6, name: 'Wallet', kind: 'efectivo', balance: 60 }],
        holdings: [], polizas: [{ id: 1, coopName: 'Bank CD', number: 'A1', amount: 3000 }],
        assets: [{ id: 1, name: 'House', category: 'Bienes Raíces', purchaseYear: 2020, purchaseValue: 250000, status: 'Activo', valuesByYear: {} },
            { id: 2, name: 'Old car', category: 'Vehículo', purchaseYear: 2015, purchaseValue: 9000, status: 'Vendido', saleYear: 2024, valuesByYear: {} }],
        debts: [{ id: 9, name: 'Visa debt', kind: 'tarjeta', balance: 800 }, { id: 10, name: 'Car loan', kind: 'vehicular', balance: 12000 }, { id: 11, name: 'Paid', kind: 'personal', balance: 0 }],
        years: { 2026: { netWorth: { mortgage: 180000 }, netWorthTouched: { mortgage: true } } }, year: 2026
    });
    const g = Object.fromEntries(r.groups.map(x => [x.key, x]));
    assert.deepEqual(g.checking.rows.map(x => x.name), ['Checking']);
    assert.equal(g.cash.total, 60);
    assert.equal(g.investment.total, 23000);
    assert.deepEqual(g.property.rows.map(x => x.name), ['House']);
    assert.deepEqual(g.card.rows.map(x => [x.name, x.balance, x.ref.type]), [['Store card', 150, 'account'], ['Visa', 800, 'debt']]);
    assert.deepEqual(g.loan.rows.map(x => x.name), ['Car loan']);
    assert.equal(g.mortgage.total, 180000);
    assert.equal(r.assets, 1200 + 5000 + 60 + 23000 + 250000);
    assert.equal(r.liabilities, 150 + 800 + 12000 + 180000);
    assert.equal(r.net, r.assets - r.liabilities);
});

test('accountActivity: one account\'s money in and out by month, newest first', () => {
    const txns = [
        { id: 1, accountId: 3, date: '2026-09-05', type: 'Gasto', amount: 40 }, { id: 2, accountId: 3, date: '2026-10-02', type: 'Gasto', amount: 25 },
        { id: 3, accountId: 3, date: '2026-10-03', type: 'Gasto', amount: 10, refund: true }, { id: 4, accountId: 3, date: '2026-10-04', type: 'Transferencia', amount: 120, signed: 120 },
        { id: 5, accountId: 3, date: '2026-10-05', type: 'Ingreso', amount: 1000 }, { id: 6, accountId: 4, date: '2026-10-05', type: 'Gasto', amount: 99 },
        { id: 7, accountId: 3, date: '2025-01-01', type: 'Gasto', amount: 5 }
    ];
    const r = E.accountActivity(txns, 3, { end: new Date(2026, 9, 6), months: 2 });
    assert.deepEqual(r.months, ['2026-09', '2026-10']);
    assert.deepEqual(r.out, [40, 25]);
    assert.deepEqual(r.in, [0, 1130]);
    assert.deepEqual(r.txns.map(t => t.id), [5, 4, 3, 2, 1, 7]);
});

test('rangeFor and shiftRange: presets and stepping back and forward', () => {
    const today = new Date(2026, 9, 6);
    assert.deepEqual(E.rangeFor('this-month', today), { from: '2026-10-01', to: '2026-10-31' });
    assert.deepEqual(E.rangeFor('last-month', today), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(E.rangeFor('7d', today), { from: '2026-09-30', to: '2026-10-06' });
    assert.deepEqual(E.rangeFor('90d', today), { from: '2026-07-09', to: '2026-10-06' });
    assert.deepEqual(E.rangeFor('all', today), { from: null, to: null });
    // Whole months move by months (a quarter by a quarter), other spans by their length.
    assert.deepEqual(E.shiftRange('2026-10-01', '2026-10-31', -1), { from: '2026-09-01', to: '2026-09-30' });
    assert.deepEqual(E.shiftRange('2026-01-01', '2026-03-31', 1), { from: '2026-04-01', to: '2026-06-30' });
    assert.deepEqual(E.shiftRange('2026-02-01', '2026-02-28', 1), { from: '2026-03-01', to: '2026-03-31' });
    assert.deepEqual(E.shiftRange('2026-09-30', '2026-10-06', -1), { from: '2026-09-23', to: '2026-09-29' });
    assert.deepEqual(E.shiftRange(null, null, 1), { from: null, to: null });
});

test('spendingBreakdown: one category splits into its subcategories', () => {
    const t = (cat, sub, amount) => ({ date: '2026-10-02', type: 'Gasto', parentCategory: cat, category: sub, amount });
    const list = [t('Alimentación', 'Supermercado', 300), t('Alimentación', 'Restaurantes', 80), t('Alimentación', '', 20), t('Vivienda', 'Arriendo', 1000)];
    const r = E.spendingBreakdown(list, { from: '2026-10-01', to: '2026-10-31', category: 'Alimentación' });
    assert.deepEqual(r.rows.map(x => [x.key, x.total]), [['Supermercado', 300], ['Restaurantes', 80], ['Alimentación', 20]]);
    assert.equal(r.total, 400);
});

test('suggestBudget: average of the last months per everyday line, rounded; spendPace', () => {
    const items = [{ id: 1, name: 'Groceries', real: 600, type: 'Gasto Variable' }, { id: 2, name: 'Coffee', real: 20, type: 'Gasto Variable' },
        { id: 3, name: 'Car loan', real: 350, type: 'Deuda', link: 'debt' }, { id: 4, name: 'Emergency fund', real: 100, type: 'Ahorro' }];
    const m = (a, b) => ({ spend: { byLine: { 1: { spent: a }, 2: { spent: b } } } });
    const r = E.suggestBudget([m(700, 30), m(650, 41), m(712, 0)], items);
    assert.deepEqual(r.map(x => [x.id, x.suggested]), [[1, 690], [2, 25]]);
    assert.ok(Math.abs(r[0].avg - 687.33) < 0.01);
    const p = E.spendPace({ planned: 600, spent: 400, day: 15, daysInMonth: 30 });
    assert.equal(p.expected, 300);
    assert.equal(p.state, 'fast');
    assert.equal(p.daysLeft, 16);
    assert.equal(p.perDay, 12.5);
    assert.equal(E.spendPace({ planned: 600, spent: 700, day: 20, daysInMonth: 30 }).state, 'over');
    assert.equal(E.spendPace({ planned: 600, spent: 250, day: 15, daysInMonth: 30 }).state, 'ok');
});

test('monthVsAverage: one month of a trend vs the period average', () => {
    const tr = { months: ['2026-08', '2026-09', '2026-10'], series: [{ key: 'A', values: [100, 200, 300], total: 600 }, { key: 'B', values: [90, 0, 0], total: 90 }, { key: 'C', values: [0, 0, 0], total: 0 }] };
    const r = E.monthVsAverage(tr, 2);
    assert.deepEqual(r.map(x => [x.key, x.value, x.avg, x.diff]), [['A', 300, 200, 100], ['B', 0, 30, -30]]);
});
