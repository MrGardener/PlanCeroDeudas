// The "Explore the example" household (js/sample.js), for both editions.
// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');

global.Defaults = require('../js/defaults.js');
global.Engine = require('../js/engine.js');
const E = global.Engine;
const Store = require('../js/store.js');
const Sample = require('../js/sample.js');
const US = require('../js/defaults-us.js');

const TODAY = new Date('2026-10-02T12:00:00');
const TODAY_ISO = '2026-10-02';
const plain = (x) => JSON.parse(JSON.stringify(x));

// The state as the app would load it (Store.migrate), with Store pointed at it so the derived
// debt/goal budget lines (Store.effective) are the app's own.
function load(country, today = TODAY) {
    const raw = Sample.build(country, today);
    Store.state = Store.migrate(plain(raw), today);
    return { raw, s: Store.state };
}

['US', 'EC'].forEach(country => {
    test(`${country}: deterministic, and Store.migrate keeps it exactly as built`, () => {
        const a = Sample.build(country, TODAY);
        assert.deepEqual(plain(Sample.build(country, TODAY)), plain(a));
        assert.equal(a.version, 8);
        assert.equal(a.settings.country, country);
        assert.equal(a.settings.currency, 'USD');
        assert.equal(a.activeYear, 2026);
        assert.ok(a.configStartYear <= 2025);
        // Same top-level shape as a new state.
        const fresh = (country === 'US' ? US : Defaults).newState(TODAY);
        assert.deepEqual(Object.keys(a).sort(), Object.keys(fresh).sort());
        assert.deepEqual(plain(Store.migrate(plain(a), TODAY)), plain(a));
    });

    test(`${country}: every number is finite and the required amounts are set`, () => {
        const { s } = load(country);
        const bad = [];
        (function walk(o, path) {
            if (typeof o === 'number') { if (!Number.isFinite(o)) bad.push(path); }
            else if (o && typeof o === 'object') Object.keys(o).forEach(k => walk(o[k], `${path}.${k}`));
        })(s, '');
        assert.deepEqual(bad, []);
        s.transactions.forEach(t => assert.ok(t.amount > 0 && typeof t.amount === 'number', `amount of #${t.id}`));
        s.debts.forEach(d => ['balance', 'rate', 'minPayment', 'monthly', 'dueDay', 'originalBalance'].forEach(f => assert.equal(typeof d[f], 'number', `${d.name}.${f}`)));
        Object.values(s.years).forEach(yd => yd.budgetBase.forEach(i => assert.ok(Number.isFinite(i.real) && i.real >= 0)));
        s.assets.forEach(a => assert.ok(E.ASSET_CATEGORIES.includes(a.category), a.category));
        s.accounts.forEach(a => assert.ok(['corriente', 'ahorros', 'efectivo', 'retiro'].includes(a.kind)));
    });

    test(`${country}: payroll works and every month of every year balances (zero-based)`, () => {
        const { s } = load(country);
        const years = Object.keys(s.years).map(Number);
        assert.ok(years.includes(2025) && years.includes(2026));
        years.forEach(y => {
            const eff = Store.effective(y);
            const pay = E.payroll(eff);
            assert.ok(pay.netoM > 0, `net pay ${y}`);
            for (let m = 1; m <= 12; m++) {
                const mb = E.monthBudget(eff, String(m), pay);
                assert.ok(Math.abs(mb.income - mb.expReal) < 25, `${y}-${m}: income ${mb.income.toFixed(2)} vs assigned ${mb.expReal.toFixed(2)}`);
            }
        });
    });

    test(`${country}: the taxonomy is fully used, with valid subcategories and budget lines`, () => {
        const { s } = load(country);
        const tax = s.taxonomy;
        const used = new Set();
        s.transactions.filter(t => t.type === 'Gasto').forEach(t => used.add(t.parentCategory));
        s.years[2026].budgetBase.forEach(i => used.add(i.linkedCategory));
        assert.deepEqual(Object.keys(tax.expense).filter(c => !used.has(c)), []);
        s.transactions.forEach(t => {
            // Transfers (ATM cash) move money between accounts and carry no category.
            if (t.type === 'Transferencia') { assert.ok(/^acc-\d+$/.test(t.from) && /^acc-\d+$/.test(t.to)); return; }
            const list = (t.type === 'Ingreso' ? tax.income : tax.expense)[t.parentCategory] || [];
            assert.ok(list.includes(t.category), `#${t.id} ${t.description}: ${t.parentCategory} / ${t.category}`);
            assert.ok(['Efectivo', 'Tarjeta de Débito', 'Tarjeta de Crédito', 'Transferencia'].includes(t.paymentType));
        });
        // Every expense assigned to a budget line points at a line of its year.
        s.transactions.filter(t => t.budgetLine).forEach(t => {
            const items = Store.effective(Number(t.date.slice(0, 4))).budgetBase;
            assert.ok(items.some(i => String(i.id) === t.budgetLine), `#${t.id} → line ${t.budgetLine}`);
        });
        // A few returns, each pointing at the purchase it came from (same category, not more).
        const refunds = s.transactions.filter(t => t.refund);
        assert.ok(refunds.length >= 2, 'some refunds');
        refunds.filter(r => r.refundOf).forEach(r => { const o = s.transactions.find(t => t.id === r.refundOf); assert.ok(o && o.parentCategory === r.parentCategory && r.amount <= o.amount && r.date > o.date); });
        assert.ok(s.transactions.filter(t => t.type === 'Transferencia').length >= 20, 'ATM transfers');
        // Types like the templates use.
        const types = new Set(s.years[2026].budgetBase.map(i => i.type));
        ['Gasto Fijo', 'Gasto Variable', 'Ahorro', 'Deuda'].forEach(k => assert.ok(types.has(k), k));
        assert.ok(s.years[2026].budgetBase.some(i => i.dueDay >= 1), 'fixed bills have a due day');
    });

    test(`${country}: at least 13 whole months of transactions, none after today, realistic volume`, () => {
        const { s } = load(country);
        const tx = s.transactions;
        assert.ok(tx.every(t => t.date <= TODAY_ISO));
        const months = {};
        tx.forEach(t => { months[t.date.slice(0, 7)] = (months[t.date.slice(0, 7)] || 0) + 1; });
        const whole = Object.keys(months).filter(k => k < '2026-10');
        assert.ok(whole.length >= 13, `${whole.length} months`);
        whole.forEach(k => assert.ok(months[k] >= 45 && months[k] <= 90, `${k}: ${months[k]} transactions`));
        assert.ok(tx.filter(t => t.memberId).length > tx.length / 2, 'most transactions say who');
        assert.ok(tx.some(t => t.memberId === 3), 'the teenager has expenses');
        // Spending lands near the budget each month (seasonal overs and unders, never wild).
        whole.forEach(k => {
            const y = Number(k.slice(0, 4)), m = String(Number(k.slice(5)));
            const actual = E.budgetVsActualByMonth(Store.effective(y), tx, y)[Number(m) - 1];
            const ratio = actual.actual / actual.budgeted;
            assert.ok(ratio > 0.75 && ratio < 1.3, `${k}: spent ${actual.actual.toFixed(0)} of ${actual.budgeted.toFixed(0)}`);
        });
        // A 13-month window even when today is in January.
        const jan = Sample.build(country, new Date('2027-01-03T12:00:00'));
        assert.ok(jan.transactions[0].date <= '2025-12-01');
    });

    test(`${country}: debts pay off, net worth matches accounts and debts, recurring is caught up`, () => {
        const { s } = load(country);
        const extra = s.years[2026].budgetBase.filter(i => i.type === 'Deuda').reduce((t, i) => t + i.real, 0);
        const plan = E.debtPayoff(s.debts, s.debtPlan.strategy, extra);
        assert.equal(plan.never, false);
        assert.ok(plan.months > 0 && plan.months < 120);
        assert.equal(plan.shortfall, 0);
        // This year's net worth is exactly the registered accounts, CDs, holdings and debts.
        const f = s.years[2026].netWorth;
        const acct = (kinds) => s.accounts.filter(a => kinds.includes(a.kind)).reduce((t, a) => t + a.balance, 0);
        assert.ok(Math.abs(f.checking - acct(['corriente', 'efectivo'])) < 0.01);
        assert.ok(Math.abs(f.savings - acct(['ahorros'])) < 0.01);
        assert.ok(Math.abs(f.investments - (E.polizasCapital(s.polizas) + E.holdingsValue(s.holdings) + acct(['retiro']))) < 0.01);
        E.DEBT_KINDS.forEach(k => {
            const owed = s.debts.filter(d => d.kind === k.id).reduce((t, d) => t + d.balance, 0);
            assert.ok(Math.abs(f[k.netWorthField] - owed) < 0.01, k.netWorthField);
        });
        assert.ok(f.mortgage > 0);
        const history = E.netWorthYears(s.years, s.assets, 2026);
        assert.ok(history.length >= 2 && history.includes(2025));
        history.forEach(y => assert.ok(E.netWorth(s.years, s.assets, y).value > 0));
        assert.ok(s.recurring.length >= 3);
        s.recurring.forEach(r => {
            assert.deepEqual(E.dueOccurrences(r, TODAY), [], `${r.description} has nothing pending`);
            assert.ok(s.transactions.filter(t => t.recurringId === r.id).length >= 12);
        });
        assert.ok(s.rules.length >= 3);
        assert.equal(s.members.length, 3);
        assert.ok(s.goals.length >= 4 && s.goals.every(g => g.monthly > 0 && /^\d{4}-\d{2}$/.test(g.targetDate)));
    });
});

test('US: Michigan family, every other Friday, 401(k) with match, HSA, Grand Rapids city tax', () => {
    const { s } = load('US');
    const yd = s.years[2026];
    assert.equal(yd.country, 'US');
    assert.equal(yd.filingStatus, 'mfj');
    assert.equal(yd.dependents, 2);
    assert.equal(yd.localName, 'Grand Rapids');
    assert.deepEqual(['retirement', 'employer', 'insurance'].filter(g => !yd.payDeductions.some(d => d.group === g)), []);
    assert.ok(yd.payDeductions.some(d => d.kind === 'hsa'));
    const pay = E.payroll(Store.effective(2026));
    assert.ok(pay.localM > 0 && pay.stateM > 0 && pay.fedM > 0);
    assert.equal(s.settings.paySchedule.freq, 'weekly');
    assert.equal(s.settings.paySchedule.interval, 2);
    assert.equal(new Date(s.settings.paySchedule.anchor + 'T00:00:00').getDay(), 5);
    // Paychecks land on the schedule's Fridays and are not counted twice by the budget.
    const paydays = s.transactions.filter(t => t.category === 'Sueldo/Salario' && !t.countAsExtra);
    assert.ok(paydays.length >= 26);
    paydays.forEach(t => assert.equal(new Date(t.date + 'T00:00:00').getDay(), 5));
    assert.ok(s.holdings.length >= 3 && s.accounts.some(a => a.kind === 'retiro'));
    assert.ok(s.polizas.every(p => US.BANKS.some(b => b.name === p.coopName)));
    assert.ok(s.mortgage.homeValue > 0 && s.mortgage.propertyTax > 0);
    // The tax refund in March has a job in March's own budget.
    assert.ok(yd.monthOverrides['3']);
});

test('Ecuador: Quito (Sierra) family with décimos, cargas, deductible lines and the IESS loan by payroll', () => {
    const { s } = load('EC');
    const yd = s.years[2026];
    assert.equal(yd.d4Region, 'sierra');
    assert.ok(yd.d3 && yd.d4);
    assert.equal(yd.cargas, 2);
    assert.ok(yd.budgetBase.filter(i => i.isDeductible).length >= 5);
    const loan = yd.payDeductions.find(d => d.group === 'loan');
    assert.ok(loan && s.debts.some(d => d.id === loan.debtId));
    // Paid by the paycheck, so it isn't a budget line.
    assert.ok(!Store.effective(2026).budgetBase.some(i => i.id === 'debt-' + loan.debtId));
    // The décimos (August and December) are planned in those months' budgets.
    assert.ok(yd.monthOverrides['8'] && yd.monthOverrides['12']);
    assert.ok(s.transactions.some(t => t.category === 'Décimo Tercero') && s.transactions.some(t => t.category === 'Décimo Cuarto'));
    assert.ok(s.polizas.length >= 2 && s.polizas.every(p => Defaults.COOPERATIVAS.some(c => c.name === p.coopName)));
    assert.deepEqual(s.settings.paySchedule.days, [15, 30]);
});
