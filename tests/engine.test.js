// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const E = require('../js/engine.js');
const D = require('../js/defaults.js');

const close = (a, b, eps = 0.01) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);
const year = (overrides = {}) => Object.assign(D.newYear(), overrides);

test('income tax follows the progressive SRI brackets', () => {
    const b = D.sriBrackets();
    assert.equal(E.incomeTax(10000, b), 0);
    close(E.incomeTax(15159, b), (15159 - 11902) * 0.05);
    close(E.incomeTax(20000, b), 615 + (20000 - 19682) * 0.12);
    close(E.incomeTax(60000, b), 5538 + (60000 - 49207) * 0.25);
});

test('payroll: IESS, deductions capped at canasta × multiplier, net salary', () => {
    const yd = year({ sueldo: 2500 });
    const p = E.payroll(yd);
    close(p.iessM, 2500 * 0.0945);
    close(p.sriCap, 764.70 * 7);
    assert.ok(p.dedApplied <= p.sriCap);
    close(p.baseImponible, 2500 * 12 - p.iessAnual - p.dedApplied);
    close(p.netoM, 2500 - p.iessM - p.isrAnual / 12);
});

test('a zero SRI multiplier means no deduction (not silently 7)', () => {
    const p = E.payroll(year({ sueldo: 3000, sriCapMultiplier: 0 }));
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
    assert.deepEqual(axis.labels, ['Año 1', 'Año 2', 'Año 2+6m']);
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
    assert.equal(F.money(-5), '-$5.00');
    assert.equal(F.money(-0.001), '$0.00');
    F.setCurrency('EUR');
    assert.ok(F.money(1234.5).includes('€'));
    F.setCurrency('COP');
    assert.ok(!F.money(1234.5).includes(',50'));   // COP shows no cents
    F.setCurrency('XXX');                           // unknown → back to USD
    assert.equal(F.money(1), '$1.00');
});
