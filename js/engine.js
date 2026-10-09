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

    // Since 2023 (Ley de Fortalecimiento de la Economía Familiar) personal expenses don't lower the
    // taxable base: they give a tax rebate (rebaja) of 18% of the smaller of the expenses and a cap
    // in canastas familiares básicas that grows with the family dependents (cargas): 7 with none,
    // then 9 / 11 / 14 / 17 / 20 with 1 / 2 / 3 / 4 / 5 or more (20 also for a catastrophic illness).
    const CARGAS_CANASTAS = [7, 9, 11, 14, 17, 20];
    function sriCapMultiplier(yd) {
        if (yd.cargas !== undefined && yd.cargas !== null && yd.cargas !== '') {
            const c = yd.cargas === 'cat' ? 5 : Math.min(5, Math.max(0, Math.floor(num(yd.cargas))));
            return CARGAS_CANASTAS[c];
        }
        // Years saved before the cargas field: the multiplier the person had (7 by default).
        return Number.isFinite(Number(yd.sriCapMultiplier)) && yd.sriCapMultiplier !== '' && yd.sriCapMultiplier !== null
            ? Math.max(0, Number(yd.sriCapMultiplier)) : 7;
    }
    function sriCap(yd) { return num(yd.canasta) * sriCapMultiplier(yd); }

    // Monthly payroll for a year: IESS personal contribution, SRI income tax withheld and
    // the resulting net salary (without décimos — those depend on the month, see below).
    // Paycheck deductions beyond what the app computes (IESS, income tax). Groups:
    //   retirement (savings), insurance, garnishment (court-ordered), loan, other: taken from pay;
    //   employer: paid by the employer on top (e.g. 401k match) — not taken from pay.
    const DEDUCTION_GROUPS = ['mandatory', 'retirement', 'insurance', 'garnishment', 'loan', 'other', 'employer'];
    // Lines the app computes itself (so a pay stub's copy isn't subtracted twice).
    const COMPUTED_KINDS = { EC: ['iess', 'ir'], US: ['federal', 'state', 'local', 'ss', 'medicare'] };
    function payDeductionsSummary(yd) {
        const computed = COMPUTED_KINDS[(yd && yd.country) || 'EC'] || [];
        const list = ((yd && yd.payDeductions) || []).filter(d => !(d.group === 'mandatory' && computed.includes(d.kind)));
        const byGroup = {};
        DEDUCTION_GROUPS.forEach(g => { byGroup[g] = 0; });
        list.forEach(d => { const g = DEDUCTION_GROUPS.includes(d.group) ? d.group : 'other'; byGroup[g] += Math.max(0, num(d.monthly)); });
        const taken = sum(DEDUCTION_GROUPS.filter(g => g !== 'employer'), g => byGroup[g]);
        return { byGroup, taken, retirement: byGroup.retirement + list.filter(d => d.group === 'employer' && d.kind === 'retirement').reduce((a, d) => a + Math.max(0, num(d.monthly)), 0), employer: byGroup.employer };
    }

    // ------------------------------------------------------------------ US payroll
    // Progressive tax on an amount with [[from, rate], …] brackets.
    function bracketTax(amount, brackets) {
        let tax = 0;
        (brackets || []).forEach(([from, rate], i) => {
            const to = i + 1 < brackets.length ? brackets[i + 1][0] : Infinity;
            if (amount > from) tax += (Math.min(amount, to) - from) * rate;
        });
        return tax;
    }
    const US_STATE_DEFAULT = { type: 'custom', rate: null, exemption: 0 };
    const US_STATES_FALLBACK = () => (typeof require !== 'undefined' ? require('./defaults-us.js').STATES : []);
    // Paycheck math for the US (annual figures ÷ 12): pre-tax 401(k)/403(b) lower income tax;
    // pre-tax health, dental, vision, FSA and HSA (section 125) lower income tax and FICA too.
    // Federal income tax on a year's income (after pre-tax deductions): the larger of the standard
    // or itemized deduction, the brackets, minus child / other-dependent credits — which phase out
    // $50 per $1,000 (or part) of income above $200,000 ($400,000 married filing jointly), IRC §24(b).
    // `stdExtra`: what still comes off when taking the standard deduction (cash gifts to charity, from 2026).
    function usFederalTax({ income, status = 'single', dependents = 0, otherDependents = 0, itemized = 0, stdExtra = 0, t = {} }) {
        const std = num((t.stdDeduction || {})[status]);
        const dedApplied = Math.max(std + num(stdExtra), num(itemized));
        const taxable = Math.max(0, num(income) - dedApplied);
        const baseCredits = num(dependents) * num(t.childCredit) + num(otherDependents) * num(t.otherDependentCredit);
        const phaseStart = num((t.ctcPhaseoutStart || { single: 200000, mfj: 400000, hoh: 200000 })[status]);
        const credits = Math.max(0, baseCredits - Math.ceil(Math.max(0, num(income) - phaseStart) / 1000) * (num(t.ctcPhaseoutStep) || 50));
        const before = bracketTax(taxable, (t.brackets || {})[status]);
        return { std, dedApplied, taxable, credits, before, tax: Math.max(0, before - credits) };
    }

    // Interest paid on a loan over the next `months` payments, from its balance today.
    function loanInterestAhead(balance, ratePct, payment, months = 12) {
        let b = Math.max(0, num(balance)), total = 0;
        const r = num(ratePct) / 1200;
        for (let i = 0; i < months && b > 0.005; i++) { const it = b * r; total += it; b = Math.max(0, b + it - num(payment)); }
        return cents(total);
    }

    // Itemize or take the standard deduction (US, tax years from 2026): mortgage interest; state and
    // local income and property taxes up to the SALT cap ($40,400 in 2026, less 30% of income above
    // $505,000, never under $10,000); gifts to charity above 0.5% of income; medical costs above
    // 7.5% of income. With the standard deduction, cash gifts up to $1,000 ($2,000 joint) still count.
    function usItemizeCheck({ yd = {}, income = 0, mortgageInterest = 0, saltIncome = 0, propertyTax = 0, charity = 0, medical = 0 }) {
        const t = yd.usTax || {};
        const status = ['single', 'mfj', 'hoh'].includes(yd.filingStatus) ? yd.filingStatus : 'single';
        const inc = Math.max(0, num(income));
        const pick = (v, d) => (v === undefined || v === null || v === '' ? d : num(v));
        const saltCap = Math.max(pick(t.saltFloor, 10000), pick(t.saltCap, 40400) - 0.3 * Math.max(0, inc - pick(t.saltPhaseoutStart, 505000)));
        const saltRaw = num(saltIncome) + num(propertyTax);
        const charityFloor = inc * pick(t.charityFloorPct, 0.5) / 100;
        const medFloor = inc * pick(t.medicalFloorPct, 7.5) / 100;
        const items = [
            { key: 'mortgage', label: 'Mortgage interest', amount: cents(num(mortgageInterest)), raw: cents(num(mortgageInterest)) },
            { key: 'salt', label: 'State, local and property taxes', amount: cents(Math.min(saltRaw, saltCap)), raw: cents(saltRaw), limit: cents(saltCap) },
            { key: 'charity', label: 'Charitable gifts', amount: cents(Math.max(0, num(charity) - charityFloor)), raw: cents(num(charity)), floor: cents(charityFloor) },
            { key: 'medical', label: 'Medical costs', amount: cents(Math.max(0, num(medical) - medFloor)), raw: cents(num(medical)), floor: cents(medFloor) }
        ];
        const itemized = cents(sum(items, i => i.amount));
        const std = num((t.stdDeduction || {})[status]);
        const stdCharity = cents(Math.min(num(charity), pick((t.charityNonItemizer || {})[status], status === 'mfj' ? 2000 : 1000)));
        const base = { income: inc, status, dependents: yd.dependents, otherDependents: yd.otherDependents };
        const taxStandard = usFederalTax(Object.assign({}, base, { stdExtra: stdCharity, t })).tax;
        const taxItemized = usFederalTax(Object.assign({}, base, { itemized, t: Object.assign({}, t, { stdDeduction: { [status]: 0 } }) })).tax;
        const itemize = itemized > std + stdCharity;
        return { items, itemized, std, stdCharity, standardTotal: cents(std + stdCharity), itemize, taxStandard: cents(taxStandard), taxItemized: cents(taxItemized),
            saving: cents(Math.abs(taxStandard - taxItemized)), short: cents(Math.max(0, std + stdCharity - itemized)), saltCap: cents(saltCap) };
    }

    // Ecuador's personal expenses (gastos personales) for the 18% rebate, from what you actually
    // spent this year: which categories and subcategories the SRI accepts, how much has an
    // invoice in your name (imported SRI invoices, or marked "con factura"), and against the cap.
    // Mortgage payments are left out: only their interest counts (the bank's yearly certificate).
    const SRI_PERSONAL = [
        { key: 'vivienda', label: 'Vivienda', cats: { 'Vivienda': ['Arriendo', 'Alícuotas/Condominio', 'Impuesto Predial'], 'Servicios Básicos y Comunicación': ['Agua', 'Energía Eléctrica', 'Gas'] } },
        { key: 'salud', label: 'Salud', cats: { 'Salud': null } },
        { key: 'educacion', label: 'Education, arts and culture', cats: { 'Educación': null } },
        { key: 'alimentacion', label: 'Alimentación', cats: { 'Alimentación': ['Mercado/Supermercado', 'Mercado Municipal/Ferias', 'Panadería'] } },
        { key: 'vestimenta', label: 'Vestimenta', cats: { 'Vestimenta': ['Ropa y Calzado', 'Ropa de Trabajo'] } },
        { key: 'turismo', label: 'Turismo', cats: { 'Viajes y Vacaciones': ['Hospedaje', 'Vuelos', 'Alquiler de Auto de Viaje'] } }
    ];
    const sriGroupOf = (t) => SRI_PERSONAL.find(g => { const subs = g.cats[t.parentCategory]; return subs !== undefined && (subs === null || subs.includes(t.category)); });
    function sriPersonalExpenses(transactions, year, { cap = 0, ratePct = 18 } = {}) {
        const groups = SRI_PERSONAL.map(g => ({ key: g.key, label: g.label, total: 0, invoiced: 0 }));
        (transactions || []).forEach(t => {
            if (txnType(t) !== 'Gasto' || !t.date || Number(t.date.slice(0, 4)) !== Number(year)) return;
            const g = sriGroupOf(t);
            if (!g) return;
            const row = groups.find(x => x.key === g.key), v = amt(t);
            row.total += v;
            if (t.source === 'sri' || t.factura) row.invoiced += v;
        });
        groups.forEach(g => { g.total = cents(g.total); g.invoiced = cents(g.invoiced); });
        const total = cents(sum(groups, g => g.total)), invoiced = cents(sum(groups, g => g.invoiced));
        const rate = num(ratePct) / 100;
        return { groups, total, invoiced, cap: num(cap), rebate: cents(Math.min(invoiced, num(cap)) * rate), potential: cents(Math.min(total, num(cap)) * rate), toCap: cents(Math.max(0, num(cap) - invoiced)), missingInvoices: cents(Math.max(0, Math.min(total, num(cap)) - invoiced)) };
    }

    // Side income (freelance, a small business): what to set aside for taxes. US: self-employment
    // tax (15.3% of 92.35% of the net, Social Security only up to the wage base left after W-2
    // wages), then federal income tax on top of your other taxable income — half the SE tax and the
    // 20% qualified-business-income deduction come off first — plus the state's flat rate.
    // Ecuador: the extra income tax from the SRI table when it's added to your taxable base.
    function sideIncomeTax({ country = 'US', net = 0, yd = {}, wages = 0, taxableBefore = 0, stateRate = 0, ecBase = 0, status: asked = null }) {
        const n = Math.max(0, num(net));
        if (n <= 0) return { net: 0, total: 0, pct: 0, parts: {} };
        if (country !== 'US') {
            const brackets = yd.sriBrackets || [];
            const ir = incomeTax(num(ecBase) + n, brackets) - incomeTax(num(ecBase), brackets);
            return { net: cents(n), total: cents(ir), pct: ir / n, parts: { ir: cents(ir) } };
        }
        const t = yd.usTax || {};
        const status = ['single', 'mfj', 'hoh'].includes(asked || yd.filingStatus) ? asked || yd.filingStatus : 'single';
        const base = n * 0.9235;
        const ssRoom = Math.max(0, (num(t.ssWageBase) || Infinity) - num(wages));
        const se = Math.min(base, ssRoom) * 2 * num(t.ssRate) / 100 + base * 2 * num(t.medicareRate) / 100;
        const qbi = 0.2 * Math.max(0, n - se / 2);
        const added = Math.max(0, n - se / 2 - qbi);
        const brackets = (t.brackets || {})[status];
        const fed = bracketTax(num(taxableBefore) + added, brackets) - bracketTax(num(taxableBefore), brackets);
        const state = n * num(stateRate) / 100;
        const total = se + fed + state;
        return { net: cents(n), total: cents(total), pct: total / n, added, parts: { se: cents(se), fed: cents(fed), state: cents(state) } };
    }

    // Wages on the household's federal return besides the main paycheck: the other paychecks'
    // (Income & Taxes) when filing jointly, unless an amount was typed (yd.withholding); none on
    // separate returns. Their withholding: typed, or their share of the tax as if their W-4 were right.
    function jointWagesUS(pay, w = {}) {
        const joint = !!(pay && pay.household && pay.household.joint);
        const earners = joint ? (pay.earners || []) : [];
        const fromPay = sum(earners, e => num(e.incomeWages));
        const typed = num(w.spouseWages);
        return { joint, earners: earners.length, fromPay, wages: joint ? typed || fromPay : 0,
            withheld: joint ? num(w.spouseWithheld) || (typed ? 0 : sum(earners, e => num(e.fedM) * 12)) : 0, withheldFromPay: sum(earners, e => num(e.fedM) * 12) };
    }

    // Side income's taxes person by person (US): self-employment tax on each one's own earnings, with
    // Social Security only up to the wage base their own paycheck leaves; income tax on the joint
    // return stacked on the household's taxable income (filing jointly), or each on their own return
    // (the main earner with the filing status, the others as single). people: [{ memberId, net }]
    // (memberId null or the main earner's = the main paycheck).
    function sideIncomeTaxes({ yd = {}, pay = {}, people = [], mainId = null, stateRate = 0, typedSpouseWages = 0 }) {
        const joint = !!(pay.household && pay.household.joint);
        const earners = pay.earners || [];
        // A spouse's wages typed on the refund screen count when no other paycheck is entered.
        let jointBase = num(pay.baseImponible) + (joint && !earners.length ? num(typedSpouseWages) : 0);
        return people.map(x => {
            const isMain = !x.memberId || x.memberId === mainId;
            const e = isMain ? null : earners.find(k => k.memberId === x.memberId);
            const wages = isMain ? num(pay.sueldoAnual) : e ? num(e.annual) : 0;
            const taxableBefore = joint ? jointBase : isMain ? num(pay.baseImponible) : e ? num(e.baseImponible) : 0;
            const status = joint ? 'mfj' : isMain ? yd.filingStatus : 'single';
            const r = sideIncomeTax({ country: 'US', net: x.net, yd, status, wages, taxableBefore, stateRate });
            if (joint) jointBase += r.added || 0;
            return Object.assign({ memberId: x.memberId || null, main: isMain, joint }, r);
        });
    }

    // Refund or owe: the year's federal tax for the household against what will have been withheld
    // (so far this year + per paycheck × paychecks left), and the W-4 change that evens it out —
    // extra withholding per paycheck (Step 4(c)) when you'd owe, less when the refund is large.
    // Bonuses still to come this year are withheld apart from the paychecks, usually at a flat 22%
    // federal (supplemental wages): bonusesLeft (gross) adds that to the year's withholding.
    function usRefundEstimate({ yd, wagesIncome, otherWages = 0, otherWithheld = 0, untaxedIncome = 0, withheldYtd = 0, perCheck = 0, checksLeft = 0, stdExtra = 0, bonusesLeft = 0 }) {
        const t = yd.usTax || {};
        const status = ['single', 'mfj', 'hoh'].includes(yd.filingStatus) ? yd.filingStatus : 'single';
        const income = Math.max(0, num(wagesIncome) + num(otherWages) + num(untaxedIncome));
        const f = usFederalTax({ income, status, dependents: yd.dependents, otherDependents: yd.otherDependents, itemized: yd.itemized, stdExtra, t });
        const supplemental = (num(t.supplementalRate) || 22) / 100;
        const withheld = num(withheldYtd) + num(perCheck) * Math.max(0, num(checksLeft)) + num(otherWithheld) + Math.max(0, num(bonusesLeft)) * supplemental;
        const diff = withheld - f.tax;        // > 0 refund, < 0 owe
        const n = Math.max(1, Math.round(num(checksLeft)));
        return Object.assign({}, f, { income: cents(income), withheld: cents(withheld), bonusWithheld: cents(Math.max(0, num(bonusesLeft)) * supplemental), diff: cents(diff), refund: diff > 0, adjustPerCheck: num(checksLeft) > 0 ? cents(-diff / n) : null,
            // Owing $1,000+ (after withholding) can bring an underpayment penalty unless withholding covers 90% of this year's tax or 100% of last year's.
            penaltyRisk: diff < -1000 && withheld < f.tax * 0.9 });
    }

    // US gross pay: a monthly salary, or an hourly rate (hours a week, 52 weeks a year) with its
    // usual overtime, plus the bonuses expected this year. Taxes are on the whole year; the monthly
    // budget counts only the pay you can count on (Ramsey): base pay, plus overtime only when the
    // person says so. Bonuses count in their month only when marked to plan them (bonusForMonth).
    const WEEKS_PER_MONTH = 52 / 12;
    function usGrossPay(yd) {
        const bonusesY = sum((yd.bonuses || []).filter(b => num(b.amount) > 0), b => num(b.amount));
        if (yd.payType !== 'hourly') {
            const base = Math.max(0, num(yd.sueldo));
            return { payType: 'salary', baseM: base, overtimeM: 0, budgetM: base, bonusesY, annual: base * 12 + bonusesY };
        }
        const h = yd.hourly || {};
        const rate = Math.max(0, num(h.rate));
        const baseM = rate * Math.max(0, num(h.hours)) * WEEKS_PER_MONTH;
        const overtimeM = rate * (num(h.otRate) || 1.5) * Math.max(0, num(h.otHours)) * WEEKS_PER_MONTH;
        return { payType: 'hourly', baseM, overtimeM, budgetM: baseM + (h.otInBudget ? overtimeM : 0), bonusesY, annual: (baseM + overtimeM) * 12 + bonusesY };
    }

    // One person's wages for the year (US): gross, pre-tax deductions, the wages income tax and
    // FICA apply to, and their Social Security and Medicare (each person up to the wage base).
    function usWages(e, t) {
        const pay = usGrossPay(e);
        const gross = pay.annual;
        const ded = (e.payDeductions || []).filter(d => d.pretax && d.group !== 'employer');
        const pretaxRetire = sum(ded.filter(d => d.group === 'retirement' && d.kind !== 'hsa'), d => num(d.monthly)) * 12;
        const pretax125 = sum(ded.filter(d => !(d.group === 'retirement' && d.kind !== 'hsa')), d => num(d.monthly)) * 12;
        const incomeWages = Math.max(0, gross - pretaxRetire - pretax125);
        const ficaWages = Math.max(0, gross - pretax125);
        const ssAnnual = Math.min(ficaWages, num(t.ssWageBase) || Infinity) * num(t.ssRate) / 100;
        // Employers withhold the extra 0.9% Medicare on wages above $200,000 whatever the filing
        // status (the yearly liability threshold differs; it's settled on the tax return).
        const medAnnual = ficaWages * num(t.medicareRate) / 100 + Math.max(0, ficaWages - (num(t.addlMedicareWithholding) || 200000)) * num(t.addlMedicareRate) / 100;
        return { pay, gross, pretaxRetire, pretax125, incomeWages, ficaWages, ssAnnual, medAnnual };
    }

    // The household's other paychecks: income lines with `pay` (a member's pay before taxes, the
    // same fields as the main paycheck) → that person as a year: the household's settings, their pay.
    const PAY_FIELDS = { sueldo: 0, payType: 'salary', hourly: {}, bonuses: [], payDeductions: [] };
    function otherEarners(yd) {
        return (yd.otherIncomes || []).filter(l => l && l.pay && typeof l.pay === 'object')
            .map(l => ({ line: l, yd: Object.assign({}, yd, PAY_FIELDS, l.pay, { otherIncomes: [] }) }));
    }

    // US paychecks for the household. Married filing jointly: federal and state income tax on the
    // combined income (one return), shared out by each one's taxable wages. Otherwise each person
    // files on their own (the others as single). Social Security, Medicare and city tax per person.
    // Returns the main paycheck (as always) with `earners` (the others) and `household` (totals).
    function payrollUS(yd, states) {
        const t = yd.usTax || {};
        const status = ['single', 'mfj', 'hoh'].includes(yd.filingStatus) ? yd.filingStatus : 'single';
        const joint = status === 'mfj';
        const others = otherEarners(yd);
        const main = usWages(yd, t);
        const ws = [main].concat(others.map(o => usWages(o.yd, t)));
        const people = 1 + (joint ? 1 : 0) + num(yd.dependents) + num(yd.otherDependents);
        const total = (f) => sum(ws, f);
        const shareBy = (f, w) => { const all = total(f); return all > 0 ? f(w) / all : (w === main ? 1 : 0); };
        // Federal income tax
        const fedMain = usFederalTax({ income: joint ? total(w => w.incomeWages) : main.incomeWages, status, dependents: yd.dependents, otherDependents: yd.otherDependents, itemized: yd.itemized, t });
        const fedOf = (w) => (joint ? fedMain.tax * shareBy(x => x.incomeWages, w) : w === main ? fedMain.tax : usFederalTax({ income: w.incomeWages, status: 'single', t }).tax);
        // State (flat or a rate you enter); some states (Pennsylvania) tax 401(k) deferrals.
        const st = Object.assign({}, US_STATE_DEFAULT, (states || []).find(x => x.code === yd.state) || {});
        const stateRate = yd.stateRate !== null && yd.stateRate !== undefined && yd.stateRate !== '' ? num(yd.stateRate) : (st.type === 'none' ? 0 : num(st.rate));
        const noState = st.type === 'none' && (yd.stateRate === null || yd.stateRate === undefined || yd.stateRate === '');
        const stateWages = (w) => (st.taxes401k ? w.incomeWages + w.pretaxRetire : w.incomeWages);
        const stateOn = (wages, ppl) => (noState ? 0 : Math.max(0, wages - num(st.exemption) * ppl) * stateRate / 100);
        const stateJoint = joint ? stateOn(total(stateWages), people) : 0;
        const stateOf = (w) => (joint ? stateJoint * shareBy(stateWages, w) : stateOn(stateWages(w), w === main ? people : 1));
        // City tax (Michigan's Uniform City Income Tax): on Medicare wages (401(k) deferrals
        // included, section-125 benefits not), after the city's exemption per person; people who
        // only work in the city pay the non-resident rate (half). On a joint return the exemptions
        // are shared out by wages.
        const localOf = (w, e) => {
            const lt = localTax(e, people);
            const exempt = joint ? lt.exemption * people * shareBy(x => x.ficaWages, w) : lt.exemption * (w === main ? people : 1);
            return { annual: Math.max(0, w.ficaWages - exempt) * lt.rate / 100, rate: lt.rate, resident: lt.resident };
        };
        // One paycheck: taxes are on the whole year; the budget's paycheck carries its share of them
        // (all of them for a plain salary). Overtime and bonuses outside the budget keep the rest.
        const check = (w, e) => {
            const fed = fedOf(w), state = stateOf(w), local = localOf(w, e);
            const incomeTaxAnnual = fed + state + local.annual;
            const sueldo = w.pay.budgetM;
            const share = w.gross > 0 ? Math.min(1, sueldo * 12 / w.gross) : 1;
            const ficaM = (w.ssAnnual + w.medAnnual) / 12 * share;
            const netoAntesM = Math.max(0, sueldo - ficaM - incomeTaxAnnual / 12 * share);
            const otros = payDeductionsSummary(e).taken;
            return { w, fed, state, local, incomeTaxAnnual, sueldo, share, ficaM, netoAntesM, otros, netoM: Math.max(0, netoAntesM - otros),
                avgTaxRate: w.gross > 0 ? (w.ssAnnual + w.medAnnual + incomeTaxAnnual) / w.gross : 0 };
        };
        const m = check(main, yd);
        const earners = others.map((o, k) => {
            const c = check(ws[k + 1], o.yd);
            return { id: o.line.id, memberId: o.line.memberId, name: o.line.name, sueldo: c.sueldo, annual: c.w.gross, gross: c.w.pay, budgetShare: c.share,
                ssM: c.w.ssAnnual / 12 * c.share, medM: c.w.medAnnual / 12 * c.share, ficaM: c.ficaM, fedM: c.fed / 12 * c.share, stateM: c.state / 12 * c.share,
                localM: c.local.annual / 12 * c.share, localRate: c.local.rate, localResident: c.local.resident, isrM: c.incomeTaxAnnual / 12 * c.share,
                pretaxM: (c.w.pretaxRetire + c.w.pretax125) / 12, incomeWages: c.w.incomeWages, otrosDescuentosM: c.otros, netoAntesM: c.netoAntesM, netoM: c.netoM, avgTaxRate: c.avgTaxRate,
                baseImponible: joint ? fedMain.taxable : usFederalTax({ income: c.w.incomeWages, status: 'single', t }).taxable };
        });
        const ficaAll = total(w => w.ssAnnual + w.medAnnual);
        return {
            country: 'US', sueldo: m.sueldo, sueldoAnual: main.gross, status, gross: main.pay, budgetShare: m.share,
            // Average tax on every extra dollar of pay (FICA + income tax), for bonuses and overtime.
            avgTaxRate: m.avgTaxRate,
            iessM: m.ficaM, iessAnual: main.ssAnnual + main.medAnnual, ssM: main.ssAnnual / 12 * m.share, medM: main.medAnnual / 12 * m.share,
            fedM: m.fed / 12 * m.share, stateM: m.state / 12 * m.share, localM: m.local.annual / 12 * m.share, localRate: m.local.rate, localResident: m.local.resident, stateRate, stateType: st.type,
            pretaxM: (main.pretaxRetire + main.pretax125) / 12, stdDeduction: fedMain.std, credits: fedMain.credits, incomeWages: main.incomeWages,
            sriCap: 0, deductibles: { prep: 0, real: 0 }, dedApplied: fedMain.dedApplied, baseImponible: fedMain.taxable,
            isrAnual: m.incomeTaxAnnual, isrM: m.incomeTaxAnnual / 12 * m.share,
            netoAntesM: m.netoAntesM, otrosDescuentosM: m.otros, netoM: m.netoM,
            earners,
            household: { joint, wages: total(w => w.gross), incomeWages: total(w => w.incomeWages), fedAnnual: joint ? fedMain.tax : sum(ws, fedOf),
                stateAnnual: sum(ws, stateOf), ficaAnnual: ficaAll, earners: ws.length }
        };
    }

    // Income lines with a paycheck (`pay`): their monthly amount is the take-home computed with the
    // household's taxes (US). Other lines (typed take-home, rent, a pension) stay as they are.
    function paycheckLines(yd, pay) {
        const lines = yd.otherIncomes || [];
        if (yd.country !== 'US' || !lines.some(l => l && l.pay)) return lines;
        const p = pay || payroll(yd);
        return lines.map(l => {
            const e = l && l.pay && (p.earners || []).find(x => x.id === l.id);
            return e ? Object.assign({}, l, { amount: cents(e.netoM), taxed: e }) : l;
        });
    }

    // The city tax rate that applies: a listed city's resident or non-resident rate and its
    // exemption, or the rate the person typed for any other city.
    function localTax(yd, people) {
        const resident = yd.localResident !== false;
        const cities = (root.DefaultsUS && root.DefaultsUS.MI_CITIES) || (typeof require !== 'undefined' ? require('./defaults-us.js').MI_CITIES : []);
        const c = yd.state === 'MI' && yd.localName ? cities.find(x => x.name === yd.localName) : null;
        if (c) return { rate: resident ? c.rate : c.nonresident, exemption: num(c.exemption), resident, listed: true };
        return { rate: num(yd.localRate), exemption: num(yd.localExemption), resident, listed: false };
    }

    // Social Security retirement benefit (estimate): average monthly earnings over a 35-year
    // career (capped at the wage base), the PIA formula (90% / 32% / 15% at the bend points),
    // reduced for claiming before full retirement age or increased (8% a year) up to 70.
    function socialSecurity({ sueldoPromedio, aniosAportados, aniosRestantes, edadJubilacion, usTax }) {
        const t = usTax || {};
        const years = Math.min(35, num(aniosAportados) + num(aniosRestantes));
        const aime = Math.min(num(sueldoPromedio), (num(t.ssWageBase) || Infinity) / 12) * years / 35;
        const b1 = num(t.ssBend1), b2 = num(t.ssBend2);
        const pia = 0.9 * Math.min(aime, b1) + 0.32 * Math.max(0, Math.min(aime, b2) - b1) + 0.15 * Math.max(0, aime - b2);
        const full = num(t.ssFullAge) || 67;
        const age = Math.min(70, Math.max(62, num(edadJubilacion) || full));
        const months = Math.round((age - full) * 12);
        let factor = 1;
        if (months < 0) { const m = -months; factor = 1 - (Math.min(36, m) * 5 / 900) - (Math.max(0, m - 36) * 5 / 1200); }
        else factor = 1 + months * (8 / 1200);
        return pia * factor;
    }

    function payroll(yd, states) {
        if (yd && yd.country === 'US') return payrollUS(yd, states || (root.DefaultsUS && root.DefaultsUS.STATES) || US_STATES_FALLBACK());
        const sueldo = Math.max(0, num(yd.sueldo));
        const iessM = sueldo * num(yd.iessRate) / 100;
        const cap = sriCap(yd);
        const deductibles = annualDeductibles(yd);
        const dedApplied = Math.min(deductibles.real, cap);
        const baseImponible = Math.max(0, sueldo * 12 - iessM * 12);
        const isrBruto = incomeTax(baseImponible, yd.sriBrackets);
        const rebajaRate = (yd.sriRebajaRate === undefined || yd.sriRebajaRate === null || yd.sriRebajaRate === '' ? 18 : num(yd.sriRebajaRate)) / 100;
        // The rebate can bring the tax to zero, never below.
        const rebaja = Math.min(isrBruto, dedApplied * rebajaRate);
        const isrAnual = isrBruto - rebaja;
        const otros = payDeductionsSummary(yd).taken;
        return {
            sueldo,
            sueldoAnual: sueldo * 12,
            iessM,
            iessAnual: iessM * 12,
            sriCap: cap,
            sriCapCanastas: sriCapMultiplier(yd),
            deductibles,
            dedApplied,
            baseImponible,
            isrBruto,
            rebaja,
            rebajaRate,
            // What the rebate could still grow by with more personal expenses (up to the cap).
            rebajaRoom: Math.max(0, Math.min(isrBruto, cap * rebajaRate) - rebaja),
            isrAnual,
            isrM: isrAnual / 12,
            netoAntesM: Math.max(0, sueldo - iessM - isrAnual / 12),
            otrosDescuentosM: otros,
            netoM: Math.max(0, sueldo - iessM - isrAnual / 12 - otros)
        };
    }

    const d4Month = (yd) => (yd.d4Region === 'sierra' ? '8' : '3');

    // Décimo Tercero (December, one full salary) and Décimo Cuarto (March on the Coast,
    // August in the Sierra, one SBU) — paid on top of the regular net salary.
    // US: bonuses marked to plan them, in their month, after taxes (the year's average rate).
    function bonusForMonth(yd, month, pay) {
        if (month === 'base') return 0;
        if (yd.country === 'US') {
            const planned = (yd.bonuses || []).filter(b => b.inBudget && String(b.month) === String(month) && num(b.amount) > 0);
            if (!planned.length) return 0;
            const rate = (pay && pay.avgTaxRate !== undefined ? pay : payroll(yd)).avgTaxRate;
            return sum(planned, b => num(b.amount)) * (1 - rate);
        }
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

    // Rename a category, or one of its subcategories (sub = the subcategory's current name), in
    // everything that saves it: the list, transactions, scheduled transactions, rules, budget lines
    // and income lines of every year. kind: 'expense' | 'income'. Returns how many items changed.
    // settings.renamed remembers it, so the statement reader's guesses (which use the original
    // names) still land in the renamed category.
    function renameCategory(state, { kind, category, sub, to }) {
        const tax = state.taxonomy && state.taxonomy[kind];
        to = String(to || '').trim();
        if (!tax || !tax[category] || !to) return 0;
        const isKind = (type) => (kind === 'income') === (type === 'Ingreso');
        let n = 0;
        const fix = (o, catKey, subKey) => {
            if (!o || o[catKey] !== category) return;
            if (sub === undefined) { o[catKey] = to; n++; }
            else if (subKey && o[subKey] === sub) { o[subKey] = to; n++; }
        };
        if (sub === undefined) {
            if (tax[to]) return 0;
            Object.keys(tax).forEach(k => { const v = tax[k]; delete tax[k]; tax[k === category ? to : k] = v; });
        } else {
            if (!tax[category].includes(sub) || tax[category].includes(to)) return 0;
            tax[category] = tax[category].map(s => (s === sub ? to : s));
        }
        (state.transactions || []).concat(state.recurring || []).forEach(t => { if (isKind(t.type || 'Gasto')) fix(t, 'parentCategory', 'category'); });
        (state.rules || []).forEach(r => { if (r.type !== 'Transferencia') fix(r, 'category', 'sub'); });
        Object.values(state.years || {}).forEach(y => {
            if (kind === 'expense') {
                (y.budgetBase || []).forEach(i => fix(i, 'linkedCategory'));
                Object.values(y.monthOverrides || {}).forEach(list => (list || []).forEach(i => fix(i, 'linkedCategory')));
            } else (y.otherIncomes || []).forEach(l => fix(l, 'category'));
        });
        const s = state.settings || (state.settings = {});
        const renamed = s.renamed || (s.renamed = {});
        // Keyed by the original name, so a second rename still points the guesses at the right place.
        const orig = Object.keys(renamed).find(k => renamed[k] === `${kind}|${category}${sub !== undefined ? '|' + sub : ''}`);
        renamed[orig || `${kind}|${category}${sub !== undefined ? '|' + sub : ''}`] = `${kind}|${sub !== undefined ? category + '|' + to : to}`;
        return n;
    }
    // Where an original category (and subcategory) lives now, after renames.
    function renamedCategory(settings, kind, category, sub) {
        const r = (settings && settings.renamed) || {};
        const parent = r[`${kind}|${category}`];
        const cat = parent ? parent.split('|')[1] : category;
        const s = sub ? r[`${kind}|${category}|${sub}`] || r[`${kind}|${cat}|${sub}`] : null;
        return { category: cat, sub: s ? s.split('|')[2] : sub };
    }
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
        const salary = paycheckSalary(yd, month, pay) + bonusForMonth(yd, month, pay);
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

    // Interest a certificate earns over its term. Ecuador (DPF): the rate is nominal annual on a
    // 360-day year, simple or compounded by the modality. US (CD): banks quote APY, which already
    // includes compounding, on a 365-day year.
    function polizaInterest(p, country) {
        const amount = num(p.amount);
        const rate = num(p.rate) / 100;
        if (country === 'US') return amount * (Math.pow(1 + rate, (num(p.days) || 365) / 365) - 1);
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
            // The first year, the certificates you have earn their own rates; renewals and new
            // savings earn the year's rate.
            const own = y === startYear && opening > 0 ? sum(polizas || [], p => num(p.amount) * (num(p.rate) > 0 ? num(p.rate) / 100 : rate)) : null;
            const interest = (own !== null ? own : balance * rate) + contribution * rate * 0.5;
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
    // Money moved between your own accounts (or to pay a credit card): not income, not spending.
    const isTransfer = (t) => t.type === 'Transferencia';
    // A refund or reimbursement is logged as an expense that came back: it lowers what you spent
    // in its category and budget line.
    const amt = (t) => (t.refund ? -1 : 1) * num(t.amount);
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
            if (txnType(t) !== 'Gasto' || t.fromGoal || t.parentCategory !== category) return false;
            const d = txnDate(t);
            if (d.getFullYear() !== year) return false;
            return month === 'base' || (d.getMonth() + 1) === Number(month);
        }), amt);
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
        // Spending exactly what was planned (a bill paid in full) is "complete", not "over".
        if (spent > target + 0.005) return { kind: 'over', spent, target, ratio, over: spent - target };
        if (spent >= target - 0.005) return { kind: 'complete', spent, target, ratio: 1 };
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
            if (txnType(t) !== 'Gasto' || t.fromGoal) return;
            const d = txnDate(t);
            if (d.getFullYear() !== Number(year)) return;
            if (month !== 'base' && (d.getMonth() + 1) !== Number(month)) return;
            // A split transaction puts parts of its amount on several lines; whatever isn't
            // split follows the usual rule below.
            let rest = amt(t);
            (Array.isArray(t.splits) ? t.splits : []).forEach(sp => {
                const k = sp && byLine[String(sp.line)] ? String(sp.line) : null;
                const a = Math.min(rest, Math.max(0, num(sp && sp.amount)));
                if (!k || a <= 0) return;
                byLine[k].spent += a;
                if (!byLine[k].txns.includes(t)) byLine[k].txns.push(t);
                rest -= a;
            });
            if (rest <= 0.005 && !t.refund) return;
            const explicit = t.budgetLine !== undefined && t.budgetLine !== null && t.budgetLine !== '' && byLine[String(t.budgetLine)] ? String(t.budgetLine) : null;
            const key = explicit || firstByCat[t.parentCategory] || null;
            if (!key) { unassigned.push(rest === num(t.amount) || t.refund ? t : Object.assign({}, t, { amount: rest })); return; }
            byLine[key].spent += rest;
            if (!byLine[key].txns.includes(t)) byLine[key].txns.push(t);
        });
        return { byLine, unassigned, unassignedTotal: sum(unassigned, t => (t.refund ? -1 : 1) * num(t.amount)) };
    }

    // Planned spending vs. everything actually spent (all expense transactions), per month.
    function budgetVsActualByMonth(yd, transactions, year) {
        return MONTHS.map(m => {
            const actual = sum((transactions || []).filter(t => {
                if (txnType(t) !== 'Gasto' || t.fromGoal) return false;
                const d = txnDate(t);
                return d.getFullYear() === Number(year) && (d.getMonth() + 1) === Number(m);
            }), amt);
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
            if (isTransfer(t)) return;
            if (txnType(t) === 'Ingreso') r.income += num(t.amount); else r.expense += amt(t);
            r.count++;
        });
        return rows;
    }

    // "Where every dollar goes": a month's plan summed into a few fixed groups, in the order
    // Dave Ramsey lists them (giving, saving, the four walls, everything else, debt). A line goes
    // by its type (savings, debt) or by the category it's linked to. The auto-sweep counts as
    // savings. Returns every group (amount 0 when empty, so colors stay with the group), the
    // income, what's assigned, and what's left to assign (negative = assigned more than income).
    const BUCKETS = [
        { key: 'dar', label: 'Giving' },
        { key: 'ahorro', label: 'Ahorro' },
        { key: 'vivienda', label: 'Housing and utilities' },
        { key: 'comida', label: 'Food' },
        { key: 'transporte', label: 'Transporte' },
        { key: 'otros', label: 'Other spending' },
        { key: 'deudas', label: 'Deudas' }
    ];
    function bucketOf(item) {
        const t = item.type || '', c = item.linkedCategory || '';
        if (t.includes('Ahorro')) return 'ahorro';
        if (t === 'Deuda') return 'deudas';
        if (/Donaciones/.test(c) || /diezmo|ofrenda|donaci|caridad|iglesia|giving|tithe|charit/i.test(item.name || '')) return 'dar';
        if (c === 'Vivienda' || c === 'Servicios Básicos y Comunicación') return 'vivienda';
        if (c === 'Alimentación') return 'comida';
        if (c === 'Transporte') return 'transporte';
        return 'otros';
    }
    function budgetBuckets(items, { income = 0, sweep = 0 } = {}) {
        const by = {};
        BUCKETS.forEach(b => { by[b.key] = 0; });
        (items || []).forEach(i => { if (i.type !== 'Ingreso') by[bucketOf(i)] += Math.max(0, num(i.real)); });
        by.ahorro += Math.max(0, num(sweep));
        const assigned = sum(BUCKETS, b => by[b.key]);
        return { buckets: BUCKETS.map(b => ({ key: b.key, label: b.label, amount: by[b.key] })), income: num(income), assigned, left: num(income) - assigned };
    }

    // Spending per day over the last `weeks` whole weeks (Monday first) up to the week of `end`:
    // { weeks: [{ start, total, days: [{ date, total, future }] }], max, total }. Days after `end`
    // are marked future (no data yet, not "no spending").
    function dailySpend(transactions, { end = new Date(), weeks = 12 } = {}) {
        const last = periodStart(new Date(end), 'week');
        const endIso = isoDate(new Date(end));
        const first = shiftPeriod(last, 'week', -(weeks - 1));
        const by = {};
        (transactions || []).forEach(t => { if (txnType(t) === 'Gasto') { const k = isoDate(txnDate(t)); by[k] = (by[k] || 0) + amt(t); } });
        const out = [];
        let max = 0, total = 0;
        for (let w = 0; w < weeks; w++) {
            const start = shiftPeriod(first, 'week', w);
            const days = [];
            for (let d = 0; d < 7; d++) {
                const day = new Date(start.getFullYear(), start.getMonth(), start.getDate() + d);
                const date = isoDate(day), future = date > endIso;
                const v = future ? 0 : Math.round((by[date] || 0) * 100) / 100;
                if (v > max) max = v;
                total += v;
                days.push({ date, total: v, future });
            }
            out.push({ start: isoDate(start), total: sum(days, x => x.total), days });
        }
        return { weeks: out, max, total };
    }

    // Monthly totals per group for the last `count` months up to the month of `end` (included):
    // { months: ['2026-01', …], series: { key: [total per month] } }. `keyOf(t)` names the group
    // (null = skip); `value(t)` is what a transaction adds (default: its amount).
    function monthlyByKey(transactions, keyOf, { end = new Date(), count = 12, value } = {}) {
        const e = new Date(end);
        const months = [];
        for (let i = count - 1; i >= 0; i--) { const d = new Date(e.getFullYear(), e.getMonth() - i, 1); months.push(`${d.getFullYear()}-${pad2(d.getMonth() + 1)}`); }
        const index = new Map(months.map((m, i) => [m, i]));
        const series = {};
        (transactions || []).forEach(t => {
            const i = index.get(String(t.date || '').slice(0, 7));
            if (i === undefined) return;
            // A key per transaction, or several (a transaction with two tags counts in both).
            [].concat(keyOf(t)).forEach(k => {
                if (k === null || k === undefined) return;
                const row = series[k] || (series[k] = new Array(count).fill(0));
                row[i] += value ? value(t) : amt(t);
            });
        });
        return { months, series };
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
            (transactions || []).forEach(x => { if (txnType(x) === 'Gasto' && inMonth(x, yy, mm)) daily[txnDate(x).getDate() - 1] += amt(x); });
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
            by[k].amount += amt(x); by[k].count++;
            total += amt(x);
        });
        return { total, items: Object.values(by).sort((a, b) => b.amount - a.amount).map(r => Object.assign(r, { share: total ? r.amount / total : 0 })) };
    }

    function cashFlow(transactions, y, m) {
        let income = 0, expense = 0;
        (transactions || []).forEach(x => { if (!inMonth(x, y, m) || isTransfer(x)) return; if (txnType(x) === 'Ingreso') income += num(x.amount); else expense += amt(x); });
        return { income, expense, net: income - expense };
    }

    // ------------------------------------------------------------------ pay schedule
    // How the salary arrives. { freq, ... }:
    //   'monthly'  days: [15, 30] (31 = last day), interval: 1 | 2 | 3 | 6 | 12 months counted
    //              from `anchor`'s month, weekend: 'same' | 'before' | 'after' (payday moved to
    //              Friday before / Monday after when it falls on a weekend)
    //   'weekly'   weekday (0 = Sunday … 6 = Saturday), interval 1 | 2 (every 2 weeks from `anchor`)
    //   'nth'      weekday + nths: [2, 4] ("2nd and 4th Friday"), -1 = the last one of the month
    //   'daily'    businessDays: true = Monday to Friday
    //   amount     optional: what each payment is (otherwise the net salary is spread over them)
    // A plain array of days (the old "días de pago") means monthly on those days.
    function normalizeSchedule(sch) {
        if (Array.isArray(sch)) sch = { freq: 'monthly', days: sch };
        if (!sch || !sch.freq) return null;
        const wd = Number(sch.weekday);
        const out = { freq: sch.freq, interval: Math.max(1, Number(sch.interval) || 1), amount: num(sch.amount) > 0 ? num(sch.amount) : 0 };
        if (sch.anchor) out.anchor = String(sch.anchor);
        if (sch.freq === 'monthly') {
            out.days = [...new Set((sch.days || []).map(Number).filter(d => d >= 1 && d <= 31))].sort((a, b) => a - b);
            out.weekend = ['before', 'after'].includes(sch.weekend) ? sch.weekend : 'same';
            if (!out.days.length) return null;
        } else if (sch.freq === 'weekly' || sch.freq === 'nth') {
            if (!(wd >= 0 && wd <= 6)) return null;
            out.weekday = wd;
            if (sch.freq === 'nth') {
                out.nths = [...new Set((sch.nths || []).map(Number).filter(n => n === -1 || (n >= 1 && n <= 5)))].sort((a, b) => (a === -1) - (b === -1) || a - b);
                if (!out.nths.length) return null;
            }
        } else if (sch.freq === 'daily') out.businessDays = !!sch.businessDays;
        else return null;
        return out;
    }

    const mod = (a, n) => ((a % n) + n) % n;

    // Every payday between two ISO dates (inclusive), in order.
    function payDates(schedule, fromISO, toISO) {
        const sch = normalizeSchedule(schedule);
        if (!sch || !fromISO || !toISO || fromISO > toISO) return [];
        const from = parseISO(fromISO), to = parseISO(toISO);
        const out = new Set();
        const add = (d) => { const x = isoDate(d); if (x >= fromISO && x <= toISO) out.add(x); };
        const anchor = sch.anchor ? parseISO(sch.anchor) : null;
        // Every-2-weeks counts from the payday weekday on or after the date given.
        if (anchor && sch.freq === 'weekly') anchor.setDate(anchor.getDate() + mod(sch.weekday - anchor.getDay(), 7));
        if (sch.freq === 'monthly') {
            const a = anchor ? anchor.getFullYear() * 12 + anchor.getMonth() : null;
            // Start a month early: a payday moved "after" a weekend can land in the next month.
            for (let d = new Date(from.getFullYear(), from.getMonth() - 1, 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
                if (sch.interval > 1 && a !== null && mod(d.getFullYear() * 12 + d.getMonth() - a, sch.interval) !== 0) continue;
                const last = daysIn(d.getFullYear(), d.getMonth() + 1);
                sch.days.forEach(day => {
                    const p = new Date(d.getFullYear(), d.getMonth(), Math.min(day, last));
                    const w = p.getDay();
                    if (sch.weekend === 'before' && (w === 6 || w === 0)) p.setDate(p.getDate() - (w === 6 ? 1 : 2));
                    if (sch.weekend === 'after' && (w === 6 || w === 0)) p.setDate(p.getDate() + (w === 6 ? 2 : 1));
                    add(p);
                });
            }
        } else if (sch.freq === 'weekly') {
            const d = new Date(from);
            d.setDate(d.getDate() + mod(sch.weekday - d.getDay(), 7));
            for (; d <= to; d.setDate(d.getDate() + 7)) {
                if (sch.interval > 1 && anchor && mod(Math.round((d - anchor) / (7 * 86400000)), sch.interval) !== 0) continue;
                add(d);
            }
        } else if (sch.freq === 'nth') {
            for (let d = new Date(from.getFullYear(), from.getMonth(), 1); d <= to; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
                const first = 1 + mod(sch.weekday - d.getDay(), 7);
                const last = daysIn(d.getFullYear(), d.getMonth() + 1);
                const count = Math.floor((last - first) / 7) + 1;
                sch.nths.forEach(n => {
                    const k = n === -1 ? count : n;
                    if (k >= 1 && k <= count) add(new Date(d.getFullYear(), d.getMonth(), first + 7 * (k - 1)));
                });
            }
        } else if (sch.freq === 'daily') {
            for (const d = new Date(from); d <= to; d.setDate(d.getDate() + 1)) {
                if (!sch.businessDays || (d.getDay() !== 0 && d.getDay() !== 6)) add(d);
            }
        }
        return [...out].sort();
    }

    // Weekly / every-2-weeks pay: the months with more paychecks than usual. Every 2 weeks is 2 a
    // month, so 2 months a year (3 in some years) bring a 3rd; weekly is 4, so 4 months bring a 5th.
    function extraPaycheckMonths(schedule, year) {
        const sch = normalizeSchedule(schedule);
        if (!sch || sch.freq !== 'weekly' || sch.interval > 2) return null;
        const usual = sch.interval === 2 ? 2 : 4;
        const byMonth = {};
        payDates(sch, `${year}-01-01`, `${year}-12-31`).forEach(d => { const m = Number(d.slice(5, 7)); (byMonth[m] = byMonth[m] || []).push(d); });
        const months = Object.keys(byMonth).map(Number).filter(m => byMonth[m].length > usual)
            .map(m => ({ month: m, count: byMonth[m].length, extra: byMonth[m].length - usual, dates: byMonth[m] }));
        return { usual, perYear: 52 / sch.interval, months };
    }

    // The take-home pay a month's budget counts. Normally the year's pay spread over 12 months.
    // Budgeting on paychecks (Ramsey, for weekly / every-2-weeks pay): each month counts its usual
    // paychecks (2 or 4), and a month with an extra one counts it as extra income to give a job.
    function paycheckSalary(yd, month, pay) {
        const plan = yd.budgetOnPaychecks ? extraPaycheckMonths(yd.paySchedule, yd.calYear) : null;
        if (!plan) return pay.netoM;
        const each = pay.netoM * 12 / plan.perYear;
        const extra = month === 'base' ? 0 : ((plan.months.find(x => x.month === Number(month)) || {}).extra || 0);
        return each * (plan.usual + extra);
    }

    const paymentsPerYear = (schedule, year) => payDates(schedule, `${year}-01-01`, `${year}-12-31`).length;

    // The usual number of paychecks in a year for a rhythm (every 2 weeks = 26, even in a
    // year that happens to have 27 Fridays): what a yearly salary is divided by.
    function nominalPaymentsPerYear(schedule) {
        const sch = normalizeSchedule(schedule);
        if (!sch) return 0;
        if (sch.freq === 'monthly') return sch.days.length * 12 / sch.interval;
        if (sch.freq === 'weekly') return 52 / sch.interval;
        if (sch.freq === 'nth') return sch.nths.length * 12;
        return sch.businessDays ? 261 : 365;
    }

    // Next payday on or after `today` (a schedule, or the old array of days of the month).
    function nextPayday(schedule, today) {
        const t = new Date(today);
        const base = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        const next = payDates(schedule, isoDate(base), isoDate(new Date(base.getFullYear() + 1, base.getMonth(), base.getDate() + 1)))[0];
        if (!next) return null;
        const date = parseISO(next);
        return { date, days: Math.round((date - base) / 86400000) };
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

    // Where a transaction came from: 'imported' (a statement or invoice file), 'scheduled' (a
    // repeating transaction posted on its day) or 'typed' (by hand). A typed one is reconciled once
    // an imported statement row matched it (it then keeps the row's reference).
    function txnOrigin(t) {
        if (['csv', 'ofx', 'sri', 'xml'].includes(t.source)) return 'imported';
        if (t.recurringId) return 'scheduled';
        return 'typed';
    }
    const isReconciled = (t) => txnOrigin(t) === 'typed' && !!t.importRef;

    // "Household (shared)": a transaction for everyone (utilities, rent…), as opposed to one
    // person's or not set. Saved as memberId -1.
    const HOUSEHOLD = -1;
    // Bills that belong to the whole household: imports put them there when no person is chosen.
    const HOUSEHOLD_CATEGORIES = ['Vivienda', 'Servicios Básicos y Comunicación', 'Seguros y Protección'];

    // Income and expenses per household member for a month; shared ones go to "Household";
    // transactions with no member go to "Sin asignar".
    function memberTotals(transactions, members, y, m) {
        const rows = (members || []).map(p => ({ id: p.id, name: p.name, color: p.color, income: 0, expense: 0 }));
        if ((transactions || []).some(x => x.memberId === HOUSEHOLD)) rows.push({ id: HOUSEHOLD, name: 'Household', color: '#64748b', income: 0, expense: 0 });
        const none = { id: null, name: 'Sin asignar', income: 0, expense: 0 };
        (transactions || []).forEach(x => {
            if (!inMonth(x, y, m)) return;
            if (isTransfer(x)) return;
            const r = rows.find(p => p.id === x.memberId) || none;
            if (txnType(x) === 'Ingreso') r.income += num(x.amount); else r.expense += amt(x);
        });
        const all = rows.concat(none.income || none.expense ? [none] : []);
        const ti = sum(all, r => r.income), te = sum(all, r => r.expense);
        return { income: ti, expense: te, rows: all.map(r => Object.assign(r, { incomeShare: ti ? r.income / ti : 0, expenseShare: te ? r.expense / te : 0 })) };
    }

    // Spending by category between two ISO dates, biggest first, for the Spending donut.
    // who: undefined = everyone, HOUSEHOLD, or a member id. The smallest categories fold into one
    // "other" row so the donut never needs more than `max` colors. Refunds lower their category.
    // category: one category's subcategories instead (the wheel's second ring).
    // type 'Ingreso': the same for income (the Spending tool's Income tab).
    function spendingBreakdown(transactions, { from, to, who, max = 7, category = null, type = 'Gasto' } = {}) {
        const by = {};
        (transactions || []).forEach(t => {
            if (txnType(t) !== type || isTransfer(t) || !t.date || (from && t.date < from) || (to && t.date > to)) return;
            if (who !== undefined && who !== null && who !== '' && t.memberId !== who) return;
            if (category && (t.parentCategory || 'Otros') !== category) return;
            const k = category ? (t.category || category) : (t.parentCategory || 'Otros');
            const r = by[k] || (by[k] = { key: k, total: 0, count: 0 });
            r.total += type === 'Gasto' ? amt(t) : num(t.amount); r.count++;
        });
        let rows = Object.values(by).filter(r => r.total > 0.005).sort((a, b) => b.total - a.total);
        if (rows.length > max) {
            const rest = rows.slice(max - 1);
            rows = rows.slice(0, max - 1).concat([{ key: null, other: rest.map(r => r.key), total: sum(rest, r => r.total), count: sum(rest, r => r.count) }]);
        }
        const total = sum(rows, r => r.total);
        return { total, rows: rows.map(r => Object.assign(r, { share: total ? r.total / total : 0 })) };
    }

    // Spending per month by category (or, for one category, by subcategory) for the last `months`
    // months up to `end`, plus income, for the Trends chart. account: '' = all, 'none' = without
    // an account, else an account id. The smallest series fold into one "other" (key null).
    function categoryTrend(transactions, { end, months = 6, account = '', category = '', max = 7 } = {}) {
        const e = end instanceof Date ? end : new Date(end);
        const keys = Array.from({ length: months }, (_, i) => { const d = new Date(e.getFullYear(), e.getMonth() - months + 1 + i, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; });
        const at = {}; keys.forEach((k, i) => { at[k] = i; });
        const zeros = () => new Array(months).fill(0);
        const by = {}, income = zeros();
        (transactions || []).forEach(t => {
            const i = t.date ? at[t.date.slice(0, 7)] : undefined;
            if (i === undefined || isTransfer(t)) return;
            if (account === 'none' ? t.accountId : account !== '' && account !== null && account !== undefined && String(t.accountId) !== String(account)) return;
            if (txnType(t) === 'Ingreso') { if (!category) income[i] += num(t.amount); return; }
            if (category && (t.parentCategory || 'Otros') !== category) return;
            const k = category ? (t.category || category) : (t.parentCategory || 'Otros');
            (by[k] || (by[k] = zeros()))[i] += amt(t);
        });
        let series = Object.keys(by).map(k => ({ key: k, values: by[k], total: by[k].reduce((a, v) => a + v, 0) })).filter(x => x.total > 0.005).sort((a, b) => b.total - a.total);
        if (series.length > max) {
            const rest = series.slice(max - 1);
            const values = zeros(); rest.forEach(x => x.values.forEach((v, i) => { values[i] += v; }));
            series = series.slice(0, max - 1).concat([{ key: null, other: rest.map(x => x.key), values, total: sum(rest, x => x.total) }]);
        }
        const spend = keys.map((_, i) => sum(series, x => x.values[i]));
        return { months: keys, series, income: category ? null : income, spend };
    }

    // Trends drill-down: one month of a categoryTrend() vs the period's monthly average, per
    // series, biggest first (only series with spending that month or on average).
    function monthVsAverage(trend, index) {
        const n = Math.max(1, (trend && trend.months || []).length);
        return ((trend && trend.series) || []).map(x => {
            const value = num(x.values[index]), avg = num(x.total) / n;
            return { key: x.key, other: x.other, value, avg, diff: value - avg };
        }).filter(r => r.value > 0.005 || r.avg > 0.005).sort((a, b) => b.value - a.value || b.avg - a.avg);
    }

    // Which band of a stacked chart a tap landed in: series (bottom first) values at one month, and
    // the amount at the tap's height. null above the stack (or below zero).
    function bandAt(seriesValues, index, value) {
        const v = num(value);
        if (v < 0) return null;
        let top = 0;
        for (let k = 0; k < (seriesValues || []).length; k++) {
            const h = Math.max(0, num((seriesValues[k] || [])[index]));
            if (h > 0 && v <= top + h) return k;
            top += h;
        }
        return null;
    }

    // The household person by person: each one's paycheck (a month: before taxes, taxes, take-home;
    // the first person is the main earner, the others' come from their paycheck lines; income lines
    // that say whose and were typed as take-home add to it; `retirement` = what each puts into a
    // 401(k)/403(b) from their pay, [{ memberId, own }]) and, for a period, what each received
    // and spent (transactions that say whose; shared or unassigned ones go to the household row)
    // and where most of their spending went.
    function personSummary({ members = [], pay = null, incomes = [], retirement = [], transactions = [], from = '0000-01-01', to = '9999-12-31' } = {}) {
        const row = (memberId, name) => ({ memberId, name, gross: 0, taxes: 0, net: 0, saved: 0, received: 0, spent: 0, byCat: {}, top: null });
        const rows = members.map(m => row(m.id, m.name)).concat(row(HOUSEHOLD, ''));
        const shared = rows[rows.length - 1];
        const find = (id) => rows.find(r => r.memberId === id && r !== shared) || shared;
        if (pay && members.length) {
            const main = rows[0];
            main.gross += num(pay.sueldo); main.taxes += num(pay.isrM) + num(pay.iessM); main.net += num(pay.netoM);
            (pay.earners || []).forEach(e => { const r = find(e.memberId); r.gross += num(e.sueldo); r.taxes += num(e.isrM) + num(e.ficaM); r.net += num(e.netoM); });
        }
        (incomes || []).forEach(l => { if (l && !l.pay && l.memberId) find(l.memberId).net += Math.max(0, num(l.amount)); });
        (retirement || []).forEach(x => { if (x && x.memberId) find(x.memberId).saved += Math.max(0, num(x.own)); });
        (transactions || []).forEach(t => {
            if (!t.date || t.date < from || t.date > to || isTransfer(t)) return;
            const r = find(t.memberId);
            if (txnType(t) === 'Ingreso') { r.received += amt(t); return; }
            r.spent += amt(t);
            const c = t.parentCategory || 'Otros';
            r.byCat[c] = (r.byCat[c] || 0) + amt(t);
        });
        rows.forEach(r => {
            const top = Object.keys(r.byCat).sort((a, b) => r.byCat[b] - r.byCat[a])[0];
            r.top = top ? { category: top, amount: cents(r.byCat[top]) } : null;
            ['gross', 'taxes', 'net', 'saved', 'received', 'spent'].forEach(k => { r[k] = cents(r[k]); });
            delete r.byCat;
        });
        return rows.filter(r => r !== shared || r.received || r.spent || r.net || r.saved);
    }

    // A chart zoomed in: the visible value range when it's `zoom` times closer, centered on `center`
    // and kept inside 0…top. zoom 1 (or nothing to show) = the whole chart.
    const ZOOM_MAX = 32;
    function zoomRange(top, zoom, center) {
        const z = Math.min(ZOOM_MAX, Math.max(1, num(zoom) || 1));
        if (!(top > 0) || z === 1) return { min: 0, max: Math.max(0, num(top)), zoom: 1 };
        const h = top / z;
        const c = Number.isFinite(center) ? center : top / 2;
        const min = Math.min(Math.max(0, c - h / 2), top - h);
        return { min, max: min + h, zoom: z };
    }
    // The middle of a band of a stacked chart at one month (where zooming in on it should center).
    function bandMiddle(seriesValues, index, band) {
        let below = 0;
        for (let k = 0; k < band; k++) below += Math.max(0, num(((seriesValues || [])[k] || [])[index]));
        return below + Math.max(0, num(((seriesValues || [])[band] || [])[index])) / 2;
    }

    // "Suggest from my last 90 days": each everyday line's average spending over the given months
    // (each { spend: lineSpend(...) }), rounded to $5 (or $10 from $100 up). Debt, goal and savings
    // lines are decisions, not habits: they're left out.
    function suggestBudget(months, items) {
        const n = Math.max(1, (months || []).length);
        return (items || []).filter(i => !i.link && !i.sweep && i.type !== 'Ingreso' && !isSavingsItem(i)).map(i => {
            const avg = sum(months || [], m => num((((m.spend || {}).byLine || {})[String(i.id)] || {}).spent)) / n;
            const step = avg >= 100 ? 10 : 5;
            return { id: i.id, name: i.name, planned: num(i.real), avg, suggested: Math.round(avg / step) * step };
        });
    }

    // "Auto-generate budgets" (the bank's first Budgets screen): one line per category you spent on
    // in the last 3 full months before `today`, at its monthly average (rounded to $5, or $10 from
    // $100). Debts and transfers are left out: debt lines come from the debts list.
    function autoBudget(transactions, today, { months = 3, skip = ['Deudas'] } = {}) {
        const t = today instanceof Date ? today : new Date(today);
        const from = isoDate(new Date(t.getFullYear(), t.getMonth() - months, 1)), to = isoDate(new Date(t.getFullYear(), t.getMonth(), 0));
        return spendingBreakdown(transactions, { from, to, max: 999 }).rows.filter(r => !skip.includes(r.key)).map(r => {
            const avg = r.total / months, step = avg >= 100 ? 10 : 5;
            return { category: r.key, avg, suggested: Math.max(step, Math.round(avg / step) * step) };
        });
    }

    // One budget category over the last `months` months up to `end`: what was spent each month
    // (transactions of that category) and what was budgeted (budgetOf(year, month) → amount).
    function categoryMonths(transactions, { category, end, months = 12, budgetOf = () => 0 } = {}) {
        const e = end instanceof Date ? end : new Date(end);
        return Array.from({ length: months }, (_, i) => {
            const d = new Date(e.getFullYear(), e.getMonth() - months + 1 + i, 1), y = d.getFullYear(), m = d.getMonth() + 1;
            const key = `${y}-${pad2(m)}`, from = `${key}-01`, to = isoDate(new Date(y, m, 0));
            const spent = sum((transactions || []).filter(x => txnType(x) === 'Gasto' && !isTransfer(x) && x.date >= from && x.date <= to && (x.parentCategory || 'Otros') === category), amt);
            return { key, year: y, month: m, spent, budget: num(budgetOf(y, m)) };
        });
    }

    // How a line's month is going: where spending "should" be by today if spread evenly, and
    // what's left per day for the days left (today included).
    function spendPace({ planned, spent, day, daysInMonth }) {
        const p = Math.max(0, num(planned)), s = num(spent), left = Math.max(0, daysInMonth - day + 1);
        const expected = p * Math.min(1, day / daysInMonth);
        return { expected, ahead: s - expected, perDay: left ? Math.max(0, p - s) / left : 0, daysLeft: left, state: s > p + 0.005 ? 'over' : s > expected * 1.1 + 0.005 ? 'fast' : 'ok' };
    }

    // Budget bubbles: a month's expense lines grouped by category (linkedCategory), with what's
    // planned and spent and a state: 'ok' under 80% spent, 'warn' 80–100%, 'over' past the plan.
    // spentOf(id) → amount spent on that line. Biggest plan first.
    function budgetBubbles(items, spentOf) {
        const by = {};
        (items || []).forEach(it => {
            const planned = num(it.real), spent = num(spentOf(it.id));
            if (planned <= 0.005 && spent <= 0.005) return;
            const k = it.linkedCategory && it.linkedCategory !== 'none' ? it.linkedCategory : 'Otros';
            const b = by[k] || (by[k] = { category: k, planned: 0, spent: 0, lines: [] });
            b.planned += planned; b.spent += spent;
            b.lines.push({ id: it.id, name: it.name, planned, spent });
        });
        return Object.values(by).map(b => Object.assign(b, {
            share: b.planned > 0 ? b.spent / b.planned : null,
            state: b.spent > b.planned + 0.005 ? 'over' : b.planned > 0 && b.spent / b.planned >= 0.8 ? 'warn' : 'ok'
        })).sort((a, b) => b.planned - a.planned || b.spent - a.spent);
    }

    // Packs circles in a box, like soap bubbles: overlapping ones push apart (half each, or all of
    // it onto the one that isn't held), and every one drifts toward the middle. Pure: returns new
    // positions; run it a few rounds per frame to animate, or many to settle. `fixed` is the index of
    // a bubble being dragged (it stays where the finger is).
    function packCircles(circles, { width, height, rounds = 120, gap = 4, pull = 0.02, fixed = -1 } = {}) {
        const c = circles.map(x => ({ x: num(x.x), y: num(x.y), r: num(x.r) }));
        const cx = width / 2, cy = height / 2;
        for (let k = 0; k < rounds; k++) {
            // The pull fades out so the last rounds only separate (they end apart, not squeezed).
            const p = pull * Math.max(0, 1 - k / (rounds * 0.7));
            c.forEach((a, i) => { if (i !== fixed) { a.x += (cx - a.x) * p; a.y += (cy - a.y) * p; } });
            for (let i = 0; i < c.length; i++) {
                for (let j = i + 1; j < c.length; j++) {
                    const a = c[i], b = c[j];
                    let dx = b.x - a.x, dy = b.y - a.y, d = Math.hypot(dx, dy);
                    const min = a.r + b.r + gap;
                    if (d >= min) continue;
                    if (d < 1e-6) { dx = 1; dy = 0; d = 1; }    // same spot: split sideways
                    const push = min - d, ux = dx / d, uy = dy / d;
                    const wa = i === fixed ? 0 : j === fixed ? 1 : 0.5, wb = 1 - wa;
                    a.x -= ux * push * wa; a.y -= uy * push * wa;
                    b.x += ux * push * wb; b.y += uy * push * wb;
                }
            }
            c.forEach((a, i) => { if (i !== fixed) { a.x = Math.min(width - a.r, Math.max(a.r, a.x)); a.y = Math.min(height - a.r, Math.max(a.r, a.y)); } });
        }
        return c;
    }
    // Where bubbles start: biggest in the middle, the rest on a spiral around it.
    function spiralStart(radii, width, height) {
        return radii.map((r, i) => {
            const t = i * 2.39996, d = i === 0 ? 0 : 18 * Math.sqrt(i) * 3;
            return { x: width / 2 + Math.cos(t) * d, y: height / 2 + Math.sin(t) * d, r };
        });
    }

    // ------------------------------------------------------------ recurring
    // A repeating transaction: { frequency: 'weekly'|'biweekly'|'monthly'|'monthlyNth'|'quarterly'|
    // 'semiannual'|'yearly'|'once', startDate, endDate?, lastPosted? }. Monthly/yearly keep the
    // start's day of month (clamped to short months: the 31st becomes the 30th/28th); monthlyNth
    // keeps its weekday and which one it is in the month (the 1st Friday; a 5th that doesn't exist
    // becomes the last).
    const MONTH_STEP = { monthly: 1, quarterly: 3, semiannual: 6 };
    const parseISO = (s) => { const [y, m, d] = String(s).split('-').map(Number); return new Date(y, m - 1, d); };
    function occurrences(rec, fromISO, toISO) {
        if (!rec || !rec.startDate) return [];
        const start = parseISO(rec.startDate), from = parseISO(fromISO), to = parseISO(toISO);
        const end = rec.endDate ? parseISO(rec.endDate) : null;
        const out = [];
        const day = start.getDate();
        for (let i = 0; i < 1000; i++) {
            let d;
            if (rec.frequency === 'once') { if (i) break; d = start; }
            else if (rec.frequency === 'weekly') { d = new Date(start); d.setDate(start.getDate() + 7 * i); }
            else if (rec.frequency === 'monthlyNth') {
                const nth = Math.ceil(day / 7), wd = start.getDay(), first = new Date(start.getFullYear(), start.getMonth() + i, 1);
                const firstWd = 1 + ((wd - first.getDay() + 7) % 7), dim = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
                let dd = firstWd + 7 * (nth - 1);
                if (dd > dim) dd -= 7;
                d = new Date(first.getFullYear(), first.getMonth(), dd);
            }
            else if (rec.frequency === 'biweekly') { d = new Date(start); d.setDate(start.getDate() + 14 * i); }
            else if (rec.frequency === 'yearly') { const y = start.getFullYear() + i; d = new Date(y, start.getMonth(), Math.min(day, new Date(y, start.getMonth() + 1, 0).getDate())); }
            else { const mm = start.getMonth() + i * (MONTH_STEP[rec.frequency] || 1); d = new Date(start.getFullYear(), mm, Math.min(day, new Date(start.getFullYear(), mm + 1, 0).getDate())); }
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
    const PER_MONTH = { weekly: 52 / 12, biweekly: 26 / 12, monthly: 1, quarterly: 1 / 3, semiannual: 1 / 6, yearly: 1 / 12 };
    const monthlyCost = (rec) => num(rec.amount) * (PER_MONTH[rec.frequency] || 1);

    // ------------------------------------------------------------ tags
    // Free labels on transactions ("vacaciones-2026", "boda", "reembolsable"): lowercase, no '#',
    // spaces as dashes. "Playa, #Boda  Ana" → ['playa', 'boda-ana'].
    const normTag = (s) => String(s || '').trim().replace(/^#+/, '').toLowerCase().replace(/\s+/g, '-').replace(/[^\p{L}\p{N}_-]/gu, '').slice(0, 30);
    const parseTags = (s) => [...new Set(String(s || '').split(/[,;]+/).map(normTag).filter(Boolean))].slice(0, 10);
    const allTags = (transactions) => {
        const n = {};
        (transactions || []).forEach(t => (t.tags || []).forEach(g => { n[g] = (n[g] || 0) + 1; }));
        return Object.keys(n).sort((a, b) => n[b] - n[a] || a.localeCompare(b));
    };

    // ------------------------------------------------------------ subscription finder
    // Charges that keep coming back at a steady rhythm and (nearly) the same amount — Netflix, the
    // gym, an app you forgot — and that aren't tracked as repeating yet. Groceries or gas repeat
    // too, but their amounts vary, so they're left out. `dismissed` holds keys the user said no to.
    const repeatKey = (t) => String(t.store || t.description || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '')
        .replace(/[^a-z ]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 24);
    const RHYTHMS = [['weekly', 7, 2], ['biweekly', 14, 3], ['monthly', 30.4, 5], ['quarterly', 91, 10], ['semiannual', 182, 15], ['yearly', 365, 20]];
    const median = (xs) => { const v = xs.slice().sort((a, b) => a - b); const m = v.length >> 1; return v.length % 2 ? v[m] : (v[m - 1] + v[m]) / 2; };
    const NOT_SUBS = new Set(['Deudas', 'Ahorro e Inversión']);
    const SUB_CATS = new Set(['Suscripciones y Entretenimiento Digital', 'Seguros y Protección', 'Negocio Propio / Freelance']);
    const SERVICE = /netflix|spotify|disney|hbo|max\b|prime|youtube|icloud|apple\.com|apple (?:music|tv|one|arcade)|google (?:one|play|storage)|adobe|microsoft|office|dropbox|squarespace|wix|godaddy|patreon|audible|kindle|duolingo|gym|fitness|club|membership|membres|suscrip|subscription|costco|sam'?s|chewy|hulu|paramount|peacock|canva|chatgpt|openai/i;
    function findRepeating(transactions, { recurring = [], dismissed = [], today = new Date(), billLines = [] } = {}) {
        const bills = new Set((billLines || []).map(String));
        const tracked = new Set((recurring || []).flatMap(r => [repeatKey({ store: r.store }), repeatKey({ description: r.description })]).filter(Boolean));
        const skip = new Set(dismissed || []);
        const groups = {};
        (transactions || []).forEach(t => {
            if (txnType(t) !== 'Gasto' || t.refund || t.fromGoal || t.recurringId || !t.date || NOT_SUBS.has(t.parentCategory)) return;
            // Loan payments, savings goals and bills with a due day are already in the plan.
            const line = String(t.budgetLine || '');
            if (/^(debt|goal)-/.test(line) || bills.has(line)) return;
            const k = repeatKey(t);
            if (k.length < 3 || skip.has(k) || tracked.has(k) || tracked.has(repeatKey({ description: t.description }))) return;
            (groups[k] = groups[k] || []).push(t);
        });
        const now = new Date(today).getTime();
        const out = [];
        Object.keys(groups).forEach(k => {
            const list = groups[k].slice().sort((a, b) => a.date.localeCompare(b.date));
            const days = list.map(t => parseISO(t.date).getTime() / 86400000);
            const gaps = days.slice(1).map((d, i) => d - days[i]).filter(g => g > 0);
            if (gaps.length < 2 && !(gaps.length === 1 && gaps[0] > 300)) return;
            const g = median(gaps);
            const rhythm = RHYTHMS.find(([, n, tol]) => Math.abs(g - n) <= tol);
            if (!rhythm) return;
            const [freq, n, tol] = rhythm;
            if (gaps.filter(x => Math.abs(x - n) <= tol * 1.5).length < gaps.length * 0.75) return;
            const amounts = list.map(t => num(t.amount));
            const mid = median(amounts);
            if (amounts.filter(a => Math.abs(a - mid) <= Math.max(2, mid * 0.1)).length < amounts.length * 0.8) return;
            const last = list[list.length - 1];
            // Every few months / once a year: only what looks like a membership or service.
            if (n > 40 && !(SUB_CATS.has(last.parentCategory) || SERVICE.test(`${last.description} ${last.store}`))) return;
            const lastDay = days[days.length - 1];
            if (now / 86400000 - lastDay > n * 1.6 + 3) return;     // stopped: probably canceled
            const amount = num(last.amount);
            out.push({ key: k, name: last.description || last.store, store: last.store || '', amount, frequency: freq, count: list.length,
                first: list[0].date, last: last.date, next: isoDate(new Date((lastDay + n) * 86400000 + 12 * 3600000)),
                monthly: cents(amount * (PER_MONTH[freq] || 1)), yearly: cents(amount * (PER_MONTH[freq] || 1) * 12),
                parentCategory: last.parentCategory, category: last.category, budgetLine: last.budgetLine, paymentType: last.paymentType, ids: list.map(t => t.id) });
        });
        return out.sort((a, b) => b.yearly - a.yearly);
    }

    // ------------------------------------------------------------ investments
    // Market value of stock / ETF / fund holdings: shares × last known price.
    const holdingValue = (h) => Math.max(0, num(h.shares)) * Math.max(0, num(h.price));
    const holdingsValue = (holdings) => sum(holdings || [], holdingValue);

    // What each holding is, for the mix: U.S. stocks, international stocks, bonds, cash, other.
    // Set by hand (h.asset), or guessed from common index-fund tickers and the kind.
    const ASSET_CLASSES = ['us', 'intl', 'bonds', 'cash', 'other'];
    const TICKER_CLASS = {};
    [['us', 'VTI VOO SPY IVV ITOT SCHB SCHX SPLG VTSAX VFIAX FXAIX FSKAX SWPPX SWTSX QQQ QQQM VUG VTV VO VB VXF IWM IJH IJR SCHD SCHG DIA RSP VIG VYM VGT XLK SPTM'],
     ['intl', 'VXUS VEA VWO IXUS IEFA IEMG EFA EEM VTIAX FTIHX SWISX SCHF SCHE VEU VSS ACWX SPDW SPEM'],
     ['bonds', 'BND AGG BNDX VBTLX FXNAX SCHZ TIP VTIP SCHP BIV BSV BLV VGIT VGSH VGLT IEF TLT SHY IUSB GOVT MUB VTEB LQD'],
     ['cash', 'SGOV BIL SHV VMFXX SPAXX SWVXX FDRXX VUSXX USFR TFLO']]
        .forEach(([k, list]) => list.split(' ').forEach(t => { TICKER_CLASS[t] = k; }));
    function assetClassOf(h) {
        if (ASSET_CLASSES.includes(h.asset)) return h.asset;
        const t = String(h.ticker || '').trim().toUpperCase();
        if (TICKER_CLASS[t]) return TICKER_CLASS[t];
        return h.kind === 'Cripto' || h.kind === 'Otro' ? 'other' : 'us';
    }

    // Your investments: what you paid (h.cost, the total), what they're worth and the gain; the mix
    // by asset class against a target (% per class); and how to get back to it — selling and
    // buying (diff per class), or putting `newMoney` only where you're short (no sales, no taxes).
    function portfolioMix(holdings, target, { newMoney = 0, driftLimit = 5 } = {}) {
        const list = (holdings || []).map(h => {
            const value = holdingValue(h), cost = Math.max(0, num(h.cost));
            return { id: h.id, ticker: h.ticker, value: cents(value), cost: cents(cost), gain: cost > 0 ? cents(value - cost) : null, gainPct: cost > 0 ? (value - cost) / cost : null, asset: assetClassOf(h) };
        });
        const total = sum(list, x => x.value);
        const withCost = list.filter(x => x.cost > 0);
        const cost = sum(withCost, x => x.cost), costValue = sum(withCost, x => x.value);
        const tSum = target ? sum(ASSET_CLASSES, k => Math.max(0, num(target[k]))) : 0;
        const hasTarget = tSum > 0;
        const N = Math.max(0, num(newMoney));
        const classes = ASSET_CLASSES.map(k => {
            const value = sum(list.filter(x => x.asset === k), x => x.value);
            const tp = hasTarget ? Math.max(0, num(target[k])) / tSum * 100 : null;
            return { key: k, value: cents(value), pct: total > 0 ? value / total * 100 : 0, target: tp, diff: hasTarget ? cents(total * tp / 100 - value) : null };
        });
        const drift = hasTarget && total > 0 ? Math.max(...classes.map(c => Math.abs(c.pct - c.target))) : 0;
        // New money only: each class short of its target share (counting the new money) gets a part
        // proportional to how short it is.
        let split = [];
        if (hasTarget && N > 0) {
            const short = classes.map(c => ({ key: c.key, s: Math.max(0, (total + N) * c.target / 100 - c.value) }));
            const S = sum(short, x => x.s);
            split = short.filter(x => x.s > 0).map(x => ({ key: x.key, amount: cents(N * x.s / S) }));
        }
        return { list, total: cents(total), cost: cents(cost), gain: withCost.length ? cents(costValue - cost) : null, gainPct: cost > 0 ? (costValue - cost) / cost : null,
            classes, hasTarget, drift, rebalance: hasTarget && drift >= driftLimit, split };
    }

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

    // Date ranges for the transactions list: a preset → { from, to } (ISO; null = no limit), and
    // stepping a range back or forward: whole months move by months, anything else by its length.
    const RANGE_PRESETS = ['all', 'today', 'this-month', 'last-month', '7d', '30d', '90d', 'this-year'];
    function rangeFor(key, today) {
        const t = today instanceof Date ? today : new Date(today), y = t.getFullYear(), m = t.getMonth(), d = t.getDate();
        const iso = (yy, mm, dd) => isoDate(new Date(yy, mm, dd));
        switch (key) {
            case 'today': return { from: iso(y, m, d), to: iso(y, m, d) };
            case 'this-month': return { from: iso(y, m, 1), to: iso(y, m + 1, 0) };
            case 'last-month': return { from: iso(y, m - 1, 1), to: iso(y, m, 0) };
            case '7d': return { from: iso(y, m, d - 6), to: iso(y, m, d) };
            case '30d': return { from: iso(y, m, d - 29), to: iso(y, m, d) };
            case '90d': return { from: iso(y, m, d - 89), to: iso(y, m, d) };
            case 'this-year': return { from: `${y}-01-01`, to: `${y}-12-31` };
            default: return { from: null, to: null };
        }
    }
    function shiftRange(from, to, dir) {
        if (!from || !to) return { from, to };
        const a = parseISO(from), b = parseISO(to), step = dir < 0 ? -1 : 1;
        const lastOf = (x) => new Date(x.getFullYear(), x.getMonth() + 1, 0).getDate();
        if (a.getDate() === 1 && b.getDate() === lastOf(b)) {
            const months = (b.getFullYear() - a.getFullYear()) * 12 + b.getMonth() - a.getMonth() + 1;
            return { from: isoDate(new Date(a.getFullYear(), a.getMonth() + step * months, 1)), to: isoDate(new Date(b.getFullYear(), b.getMonth() + step * months + 1, 0)) };
        }
        const days = Math.round((b - a) / 86400000) + 1;
        return { from: isoDate(new Date(a.getFullYear(), a.getMonth(), a.getDate() + step * days)), to: isoDate(new Date(b.getFullYear(), b.getMonth(), b.getDate() + step * days)) };
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
            if (isTransfer(t)) return;
            const k = key(txnDate(t), yearly);
            const bucket = txnType(t) === 'Ingreso' ? income : expense;
            bucket[k] = (bucket[k] || 0) + (bucket === income ? num(t.amount) : amt(t));
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
        { id: 'otra', label: 'Other Debt', netWorthField: 'otherDebts' }
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
    // ------------------------------------------------- net worth month by month & milestones
    // One entry per month (the latest figure of that month), oldest first, at most 20 years.
    // items (optional): each account's value that month, [key, name, value] with what's owed
    // negative (from hubItems), so a month's gains and losses can be listed later.
    function recordNetWorthMonth(history, key, { assets, liabilities }, items) {
        const row = { month: key, assets: cents(num(assets)), liabilities: cents(num(liabilities)), value: cents(num(assets) - num(liabilities)) };
        if (Array.isArray(items) && items.length) row.items = items.map(x => [String(x[0]), String(x[1]), cents(num(x[2]))]);
        return (history || []).filter(h => h.month !== key).concat([row]).sort((a, b) => a.month.localeCompare(b.month)).slice(-240);
    }

    // Every account, property and debt in the hub as [key, name, value]: what's owed is negative.
    function hubItems(hub) {
        const out = [];
        (hub.groups || []).forEach(g => g.rows.forEach(r => out.push([`${r.ref.type}:${r.ref.id}`, r.name, cents((g.owed ? -1 : 1) * num(r.balance))])));
        return out;
    }
    // A month vs the month before, account by account (the bank's "Gains & losses"): a gain is an
    // account that grew or a debt that shrank. Accounts only in one of the two months count from 0.
    function gainsLosses(prevItems, curItems) {
        const prev = {}, cur = {}, names = {};
        (prevItems || []).forEach(([k, n, v]) => { prev[k] = num(v); names[k] = n; });
        (curItems || []).forEach(([k, n, v]) => { cur[k] = num(v); names[k] = n; });
        const rows = [...new Set(Object.keys(prev).concat(Object.keys(cur)))].map(k => ({ key: k, name: names[k], change: cents((cur[k] || 0) - (prev[k] || 0)) })).filter(r => Math.abs(r.change) >= 0.005);
        const gains = rows.filter(r => r.change > 0).sort((a, b) => b.change - a.change), losses = rows.filter(r => r.change < 0).sort((a, b) => a.change - b.change);
        return { gains, losses, gainTotal: cents(sum(gains, r => r.change)), lossTotal: cents(sum(losses, r => r.change)) };
    }
    // One account's value at the end of each saved month (from the history's items); null where
    // the month has no details for it.
    function itemHistory(history, key, months = 6) {
        return (history || []).slice(-months).map(h => { const it = (h.items || []).find(x => x[0] === key); return { month: h.month, value: it ? Math.abs(num(it[2])) : null }; });
    }

    // The moments worth celebrating on the way, each with how close you are (0–1).
    const NW_STEPS = [0, 10000, 25000, 50000, 100000, 250000, 500000, 1000000];
    function milestones({ netWorth = 0, liquid = 0, monthsCovered = 0, debts = [], money = (v) => '$' + Math.round(v).toLocaleString('en-US') }) {
        const clamp = (v) => Math.max(0, Math.min(1, v));
        const out = [
            { key: 'ef1000', group: 'ahorro', label: `Starter emergency fund: ${money(1000)}`, done: liquid >= 1000, progress: clamp(liquid / 1000) },
            { key: 'ef3', group: 'ahorro', label: '3 months of expenses saved', done: monthsCovered >= 3, progress: clamp(monthsCovered / 3) },
            { key: 'ef6', group: 'ahorro', label: '6 months of expenses saved', done: monthsCovered >= 6, progress: clamp(monthsCovered / 6) }
        ];
        const consumer = (debts || []).filter(d => num(d.originalBalance) > 0 || num(d.balance) > 0);
        consumer.forEach(d => {
            const orig = Math.max(num(d.originalBalance), num(d.balance));
            out.push({ key: 'debt-' + d.id, group: 'deudas', label: `«${d.name}» paid off`, done: num(d.balance) <= 0.005, progress: clamp(orig > 0 ? 1 - num(d.balance) / orig : 1) });
        });
        if (consumer.length > 1) {
            const owed = sum(consumer, d => Math.max(0, num(d.balance))), orig = sum(consumer, d => Math.max(num(d.originalBalance), num(d.balance)));
            out.push({ key: 'debtfree', group: 'deudas', label: 'Debt-free (except the house)', done: owed <= 0.005, progress: clamp(orig > 0 ? 1 - owed / orig : 1) });
        }
        NW_STEPS.forEach(v => out.push({ key: 'nw' + v, group: 'patrimonio', label: v === 0 ? 'Positive net worth' : `Net worth of ${money(v)}`, done: v === 0 ? netWorth > 0 : netWorth >= v, progress: v === 0 ? (netWorth > 0 ? 1 : 0) : clamp(netWorth / v) }));
        return out;
    }

    // ------------------------------------------------------------ retirement: need vs. have
    // What you need saved (in today's dollars) to live on `desiredMonthly`: what the pension doesn't
    // cover, divided by the safe withdrawal rate (4% → ×25), plus the years before the pension
    // starts lived on savings alone. Compared with what you're on track to have; the gap becomes
    // an extra monthly saving at the real (after-inflation) return.
    function retirementGap({ desiredMonthly, pensionMonthly = 0, withdrawalPct = 4, haveToday = 0, months = 0, returnPct = 0, inflationPct = 0, bridgeYears = 0 }) {
        const w = Math.max(0.1, num(withdrawalPct)) / 100;
        const fromSavings = Math.max(0, num(desiredMonthly) - num(pensionMonthly));
        const bridge = Math.max(0, Math.min(num(pensionMonthly), num(desiredMonthly))) * 12 * Math.max(0, num(bridgeYears));
        const need = fromSavings * 12 / w + bridge;
        const gap = Math.max(0, need - num(haveToday));
        const r = Math.pow((1 + num(returnPct) / 100) / (1 + num(inflationPct) / 100), 1 / 12) - 1;
        const n = Math.max(0, Math.round(num(months)));
        const extra = gap <= 0 ? 0 : n <= 0 ? null : Math.abs(r) < 1e-9 ? gap / n : gap * r / (Math.pow(1 + r, n) - 1);
        return { need: cents(need), have: cents(num(haveToday)), gap: cents(gap), pct: need > 0 ? Math.min(9.99, num(haveToday) / need) : 1, extraMonthly: extra === null ? null : cents(extra), bridge: cents(bridge) };
    }

    // ------------------------------------------------------------ college estimator
    // One child's studies: the total cost when they start (each year's cost grown by college-cost
    // inflation), what the savings will have grown to, the gap and the monthly saving that closes it.
    function collegePlan({ age = 0, startAge = 18, years = 4, annualCost = 0, costInflation = 5, saved = 0, monthly = 0, returnPct = 6 }) {
        // Kept to what a school can be (a typo of 99999999999 years mustn't hang the page).
        const toStart = Math.min(30, Math.max(0, num(startAge) - num(age)));
        const n = Math.min(10, Math.max(1, Math.round(num(years))));
        const g = 1 + Math.min(50, Math.max(0, num(costInflation))) / 100;
        returnPct = Math.min(50, Math.max(0, num(returnPct)));
        const total = sum(Array.from({ length: n }, (_, k) => k), k => num(annualCost) * Math.pow(g, toStart + k));
        const projected = growthValue(saved, monthly, returnPct, toStart, 0).value;
        const gap = Math.max(0, total - projected);
        const months = Math.round(toStart * 12);
        return { yearsToStart: toStart, startYearOffset: toStart, total: cents(total), todayCost: cents(num(annualCost) * n), projected: cents(projected), gap: cents(gap),
            monthlyNeeded: months > 0 ? monthlyToReach(total, saved, returnPct, months) : null, pct: total > 0 ? Math.min(1, projected / total) : 1 };
    }

    // ------------------------------------------------------------ insurance check
    // The coverage a household should have (Dave Ramsey's guidance): term life ~10× the yearly
    // income of each earner someone depends on, health, long-term disability (~60% of income),
    // home or renter's, auto when there's a car, umbrella liability from $500k net worth, and
    // long-term care from 60. `seen` is text from budget lines and recent transactions, used to
    // guess what's already there; `answers` (key → 'si' | 'no') override the guess.
    const INSURANCE_SEEN = {
        life: /seguro de vida|life insurance|term life|\blife\b/i,
        health: /seguro m[eé]dico|medicina prepagada|health insurance|salud prepagada|\bhsa\b|iess/i,
        disability: /disabilit|incapacidad|invalidez|\b[ls]td\b/i,
        home: /seguro de hogar|homeowner|home insurance|seguro de inquilino|renter/i,
        auto: /seguro vehicular|seguro del carro|car insurance|auto insurance|auto-owners|geico|progressive|state farm/i,
        umbrella: /umbrella|responsabilidad civil/i,
        ltc: /long[- ]term care|cuidado a largo plazo/i
    };
    function insuranceCheck({ income = 0, dependents = true, lifeCoverage = 0, ownsHome = false, hasCar = false, netWorth = 0, age = 0, seen = [], answers = {}, money = (v) => '$' + Math.round(v).toLocaleString('en-US') }) {
        const text = (seen || []).join(' · ');
        const has = (k) => answers[k] === 'si' ? true : answers[k] === 'no' ? false : INSURANCE_SEEN[k].test(text);
        const guessed = (k) => !(answers[k] === 'si' || answers[k] === 'no') && INSURANCE_SEEN[k].test(text);
        const item = (key, label, needed, why, extra = {}) => Object.assign({ key, label, needed, has: has(key), guessed: guessed(key), why, status: !needed ? 'na' : has(key) ? 'ok' : 'falta' }, extra);
        const lifeNeed = dependents ? Math.round(num(income) * 10) : 0;
        const life = item('life', 'Term life insurance', dependents && num(income) > 0, dependents ? `About 10 times your yearly income (${money(lifeNeed)}), for 15–20 years. Term, not "whole life".` : 'If no one depends on your income, you don\'t need it yet.', { need: lifeNeed, coverage: num(lifeCoverage) });
        if (life.status === 'ok' && life.coverage > 0 && life.coverage < lifeNeed * 0.9) life.status = 'revisar';
        const out = [
            life,
            item('health', 'Health insurance', true, 'A health problem is the most common cause of family bankruptcy.'),
            item('disability', 'Disability insurance', num(income) > 0, 'Replaces ~60% of your income if illness or injury keeps you from working.'),
            item('home', ownsHome ? 'Homeowner\'s insurance' : 'Renter\'s insurance', true, ownsHome ? 'Protects your home (your lender requires it with a mortgage).' : 'Cheap, and it covers your things and your liability if something happens at home.'),
            item('auto', 'Seguro del carro', !!hasCar, 'Enough liability coverage; with an emergency fund you can raise the deductible and pay less.'),
            item('umbrella', 'Umbrella liability insurance', num(netWorth) >= 500000, `From ${money(500000)} of net worth, it protects what you've built from a lawsuit.`),
            item('ltc', 'Long-term care insurance', num(age) >= 60, 'From age 60: a nursing home or in-home care can wipe out your savings.')
        ];
        const needed = out.filter(i => i.needed);
        return { items: out, missing: needed.filter(i => i.status === 'falta').length, review: needed.filter(i => i.status === 'revisar').length, lifeNeed, lifeGap: Math.max(0, lifeNeed - num(lifeCoverage)) };
    }

    // ------------------------------------------------------------ budget coaching
    // Common guidelines for a household budget, as a share of take-home pay (adapted from Dave
    // Ramsey's recommended percentages). 'lo'/'hi' bound the healthy range; null = no bound.
    const COACH_RANGES = { dar: [5, 15], ahorro: [10, null], vivienda: [null, 35], comida: [null, 15], transporte: [null, 15], deudas: [null, null], otros: [null, null] };
    // `itemsFor(y, m)` gives that month's budget lines; the last `months` whole months are checked.
    function budgetCoach({ buckets = [], income = 0, itemsFor, transactions = [], today = new Date(), months = 4 }) {
        const ranges = buckets.map(b => {
            const pct = income > 0 ? b.amount / income * 100 : 0;
            const [lo, hi] = COACH_RANGES[b.key] || [null, null];
            const status = income <= 0 ? null : hi !== null && pct > hi + 0.5 ? 'alto' : lo !== null && pct < lo - 0.5 ? 'bajo' : 'ok';
            return { key: b.key, label: b.label, amount: b.amount, pct: Math.round(pct * 10) / 10, lo, hi, status };
        });
        // A year back, so seasonal lines (Christmas, school) aren't "barely used" in July.
        const t = new Date(today), per = {};
        for (let k = 1; k <= Math.max(months, 12); k++) {
            const d = new Date(t.getFullYear(), t.getMonth() - k, 1), y = d.getFullYear(), m = String(d.getMonth() + 1);
            const items = itemsFor ? itemsFor(y, m) : [];
            const spend = lineSpend(items, transactions, y, m);
            items.filter(i => i.type !== 'Ingreso' && !isSavingsItem(i) && i.type !== 'Deuda' && !/^(debt|goal)-/.test(String(i.id))).forEach(i => {
                const id = String(i.id), plan = num(i.real), spent = spend.byLine[id] ? spend.byLine[id].spent : 0;
                const p = per[id] || (per[id] = { id: i.id, name: i.name, rows: [] });
                p.rows.push({ plan, spent });
            });
        }
        const lines = Object.values(per);
        const chronicOver = lines.map(l => {
            const over = l.rows.slice(0, months).filter(r => r.spent > r.plan * 1.05 + 1);
            const recent = l.rows.slice(0, months);
            return { id: l.id, name: l.name, months: over.length, avgOver: cents(over.length ? sum(over, r => r.spent - r.plan) / over.length : 0), avgSpent: cents(sum(recent, r => r.spent) / recent.length) };
        }).filter(l => l.months >= 3).sort((a, b) => b.avgOver - a.avgOver);
        const underUsed = lines.map(l => {
            const recent = l.rows.slice(0, 3), plan = recent.length ? sum(recent, r => r.plan) / recent.length : 0, spent = recent.length ? sum(recent, r => r.spent) / recent.length : 0;
            const yearPlan = sum(l.rows, r => r.plan), yearSpent = sum(l.rows, r => r.spent);
            return { id: l.id, name: l.name, plan: cents(plan), spent: cents(spent), left: cents(plan - spent), yearUse: yearPlan > 0 ? yearSpent / yearPlan : 1 };
        }).filter(l => l.plan >= 20 && l.spent < l.plan * 0.5 && l.spent > 0 && l.yearUse < 0.5).sort((a, b) => b.left - a.left);
        return { ranges, chronicOver, underUsed };
    }

    // ------------------------------------------------------------ financial health score
    // Eight indicators in four pillars (spend, save, borrow, plan), each 0–100, inspired by the
    // FinHealth Score. Indicators without data (null) are left out rather than counted as 0.
    // Bands: 80+ healthy, 40–79 getting there, under 40 vulnerable.
    const lin = (v, lo, hi) => Math.round(Math.max(0, Math.min(1, (v - lo) / (hi - lo))) * 100);
    function healthScore(f) {
        const ind = (key, label, score, note) => ({ key, label, score, note });
        const has = (v) => v !== null && v !== undefined && Number.isFinite(Number(v));
        const pillars = [
            { key: 'spend', label: 'Spending', items: [
                has(f.spendRatio) ? ind('spendLess', 'You spend less than you earn', lin(-f.spendRatio, -1.1, -0.9), 'Last 3 months: spending ÷ income.') : null,
                has(f.overdue) ? ind('onTime', 'You pay your bills on time', f.overdue <= 0 ? 100 : f.overdue === 1 ? 50 : 0, 'Overdue payments this month.') : null
            ] },
            { key: 'save', label: 'Saving', items: [
                has(f.monthsCovered) ? ind('cushion', 'You have a cushion for surprises', lin(f.monthsCovered, 0, 3), 'Months of essential expenses saved (3 or more = 100).') : null,
                has(f.savingsRate) ? ind('longTerm', 'You save for the long term', lin(f.savingsRate, 0, 0.15), 'Share of your pay going to retirement (15% = 100).') : null
            ] },
            { key: 'borrow', label: 'Borrowing', items: [
                has(f.debtToIncome) ? ind('dti', 'Your debts don\'t swamp your income', lin(-f.debtToIncome, -0.36, -0.10), 'Consumer debt payments ÷ income (10% or less = 100).') : null,
                has(f.costlyDebtRatio) ? ind('costly', 'No expensive debt', lin(-f.costlyDebtRatio, -0.15, 0), 'Debts at 10% or more, against your yearly income.') : null
            ] },
            { key: 'plan', label: 'Planning', items: [
                has(f.unassignedRatio) ? ind('budget', 'Every dollar has a job', Math.abs(f.unassignedRatio) <= 0.01 ? 100 : Math.abs(f.unassignedRatio) <= 0.05 ? 60 : 20, 'Your budget assigns all your income, no more, no less.') : null,
                has(f.retirePct) ? ind('retire', 'On track for retirement', lin(f.retirePct, 0, 1), 'What you\'re on track to have ÷ what you\'d need.') : null
            ] }
        ].map(p => { const items = p.items.filter(Boolean); return Object.assign(p, { items, score: items.length ? Math.round(sum(items, i => i.score) / items.length) : null }); });
        const all = pillars.flatMap(p => p.items);
        const score = all.length ? Math.round(sum(all, i => i.score) / all.length) : null;
        return { score, band: score === null ? null : score >= 80 ? 'sano' : score >= 40 ? 'camino' : 'vulnerable', pillars, weakest: all.slice().sort((a, b) => a.score - b.score)[0] || null };
    }

    // ------------------------------------------------------------ next moves
    // The three things worth doing next, ranked by what matters most for this household right
    // now (urgent first, then the current Baby Step, then housekeeping). `facts` are plain numbers
    // gathered by the Overview; `snoozed` maps a move to the date it may come back.
    function nextMoves(f, { snoozed = {}, today = new Date(), money = (v) => '$' + Math.round(v).toLocaleString('en-US'), limit = 3 } = {}) {
        const t = isoDate(new Date(today));
        const out = [];
        const add = (score, key, icon, title, text, go = {}) => out.push(Object.assign({ score, key, icon, title, text }, go));
        if (!f.hasIncome) add(100, 'setup', 'fa-flag-checkered', 'Build your budget', 'Start with your pay, then give every dollar a line: everything else comes from there.', { goto: 'presupuesto/ingresos' });
        if ((f.overdueBills || []).length) add(96, 'overdue', 'fa-calendar-xmark', 'Pay what\'s overdue', `${f.overdueBills.slice(0, 3).join(', ')} is past due. Pay it or mark it to avoid late fees.`, { goto: 'resumen', focus: 'dash-bills-card' });
        if (f.unassigned < -1) add(92, 'overbudget', 'fa-scale-unbalanced', 'Balance your budget', `Your plan spends ${money(-f.unassigned)} a month more than you earn. Trim lines until it's at $0.`, { goto: 'presupuesto/plan' });
        if (f.step === 1 && f.hasIncome) add(88, 'ef1000', 'fa-shield-heart', `Save ${money(Math.max(0, 1000 - f.liquid))} for your starter fund`, `With $1,000 on hand, a surprise doesn't become debt. Today you have ${money(f.liquid)}.`, { goto: 'futuro/metas', focus: 'metas-ef' });
        if (f.unassigned > 1) {
            const where = f.step === 2 ? 'to the snowball' : f.step === 1 || f.step === 3 ? 'to your emergency fund' : 'to retirement or your goals';
            add(84, 'unassigned', 'fa-coins', `Give ${money(f.unassigned)} a job`, `It's unassigned in your budget. Send it ${where} before it gets spent on its own.`, { goto: 'presupuesto/plan' });
        }
        if (f.step === 2 && f.target) add(80, 'snowball', 'fa-snowflake', `Attack «${f.target.name}»`, `It's next in your snowball: ${money(f.target.balance)} at ${f.target.rate}%. Every extra dollar goes there; the others get just the minimum.`, { goto: 'futuro/metas', focus: 'metas-debts' });
        if (f.monthToClose) add(72, 'close', 'fa-calendar-check', `Close out ${f.monthToClose.label}`, 'See where you went over and give what\'s left a job.', { action: 'close.open', data: { y: f.monthToClose.y, m: f.monthToClose.m } });
        if (f.extraPaycheck) {
            const where = f.step === 2 ? 'the snowball' : f.step === 1 || f.step === 3 ? 'your emergency fund' : 'retirement or your goals';
            add(70, 'extraPay', 'fa-gift', `${f.extraPaycheck.label} brings an extra paycheck`, f.extraPaycheck.onChecks
                ? `About ${money(f.extraPaycheck.amount)} on top of your usual pay. Give it a job before it arrives: ${where}.`
                : `About ${money(f.extraPaycheck.amount)}. Budget on your usual paychecks so it's real extra money, then send it to ${where}.`, { goto: 'presupuesto/ingresos', focus: 'pay-schedule' });
        }
        if (f.uncategorized >= 3) add(62, 'uncategorized', 'fa-tags', `Assign ${f.uncategorized} expenses with no line`, 'Until they have a line, your budget doesn\'t know you spent them.', { goto: 'transacciones/lista' });
        if (f.annualShort) add(60, 'annual', 'fa-calendar-days', 'Set aside for your annual bills', f.annualShort.noFund
            ? `You're not setting money aside for them yet: ${money(f.annualShort.yearly)} a year, ${money(f.annualShort.monthly)} a month.`
            : `In ${f.annualShort.label} you'd be ${money(f.annualShort.needed)} short. Deposit the difference or raise the set-aside.`, { goto: 'presupuesto/plan', focus: 'bud-annual-card' });
        if ((f.maturing || []).length) add(58, 'maturing', 'fa-file-contract', 'Decide what to do with your CD', `${f.maturing.join(', ')} matures soon: renew it or move it according to your current step.`, { goto: 'futuro/polizas' });
        if (f.step === 3) add(56, 'ef6', 'fa-shield-heart', 'Finish your emergency fund', `You have ${f.monthsCovered.toFixed(1)} months; the goal is 3 to 6 (${money(f.essential * 3)}–${money(f.essential * 6)}).`, { goto: 'futuro/metas', focus: 'metas-ef' });
        if (f.step >= 4 && f.savingsRate < 0.15 && f.income > 0) add(52, 'retire15', 'fa-person-cane', 'Invest 15% for retirement', `Today you save ${Math.round(f.savingsRate * 100)}%. Reaching 15% is ${money((0.15 - f.savingsRate) * f.income)} more a month.`, { goto: 'futuro/jubilacion' });
        if (f.needsWill) add(50, 'will', 'fa-file-signature', 'Make your will', 'You have children who depend on you: name their guardian and decide who inherits. It\'s among the most important things, and the most put off.', { goto: 'patrimonio', focus: 'nw-checklists' });
        if (f.reviewDue) add(44, 'review', 'fa-calendar-check', 'Do your yearly review', 'A new year: insurance, retirement, credit, taxes and your emergency fund, in one list.', { goto: 'patrimonio', focus: 'nw-checklists' });
        if (f.subsYearly >= 100) add(46, 'subs', 'fa-magnifying-glass-dollar', 'Review your subscriptions', `We found repeating charges worth ${money(f.subsYearly)} a year. Do you still use them?`, { goto: 'transacciones/lista' });
        if (f.hasData && (f.backupDays === null || f.backupDays > 30)) add(40, 'backup', 'fa-download', 'Guarda una copia de respaldo', f.backupDays === null ? 'You\'ve never saved one. If the browser data is cleared, you lose your plan.' : `The last one was ${f.backupDays} days ago.`, { goto: 'config', focus: 'cfg-data' });
        return out.filter(m => !(snoozed[m.key] && snoozed[m.key] > t)).sort((a, b) => b.score - a.score).slice(0, limit);
    }

    // ------------------------------------------------------------ calculators
    // A fixed-payment loan (car, personal, mortgage): the monthly payment and what it costs.
    function loanPayment(principal, ratePct, months) {
        const P = num(principal), n = Math.max(1, Math.round(num(months))), r = num(ratePct) / 1200;
        const pay = r > 0 ? P * r / (1 - Math.pow(1 + r, -n)) : P / n;
        return { payment: cents(pay), total: cents(pay * n), interest: cents(pay * n - P), months: n };
    }
    // Rate sensitivity. A loan at its rate ± `deltas` points (the first payment and the total
    // interest), for adjustable-rate loans and refinancing; savings certificates' yearly interest
    // today and if each renews `drop` points lower (rates never below 0).
    function loanRateScenarios(system, principal, ratePct, months, deltas = [-1, 0, 1]) {
        return deltas.map(d => {
            const rate = Math.max(0, num(ratePct) + d);
            const a = amortization(system, principal, rate, months, 0);
            return { delta: d, rate, payment: cents(a.firstPayment), totalInterest: cents(a.totalInterest) };
        });
    }
    function cdRenewalRisk(polizas, country, { drop = 1, today = new Date() } = {}) {
        const yearOf = (p, rate) => polizaInterest(Object.assign({}, p, { rate, days: country === 'US' ? 365 : 360 }), country);
        const list = (polizas || []).filter(p => num(p.amount) > 0);
        const yearly = sum(list, p => yearOf(p, num(p.rate)));
        const lower = sum(list, p => yearOf(p, Math.max(0, num(p.rate) - drop)));
        const t = isoDate(today);
        const next = list.map(p => p.maturityDate).filter(d => d && d >= t).sort()[0] || null;
        return { yearly: cents(yearly), lower: cents(lower), loss: cents(yearly - lower), nextRenewal: next, count: list.length };
    }

    // Pay the mortgage off early, or invest the difference? Over the loan's remaining life, path
    // "prepay" puts `extra` toward principal each month and, once the house is paid, invests the
    // whole payment + extra; path "invest" pays as scheduled and invests `extra` from the start.
    // Both end with no mortgage; what's compared is the investments then, after tax on the gains
    // (`gainsTaxPct`). `deductPct` is the tax saved per dollar of mortgage interest (only when you
    // itemize), reinvested in both paths. `breakEven`: the return at which both come out even.
    function prepayOrInvest({ balance, ratePct, payment, extra, returnPct, gainsTaxPct = 0, deductPct = 0, maxMonths = 600 }) {
        const B0 = Math.max(0, num(balance)), r = num(ratePct) / 1200, P = Math.max(0, num(payment)), X = Math.max(0, num(extra));
        const run = (ret) => {
            const g = num(ret) / 1200, d = num(deductPct) / 100;
            const path = (extraToLoan) => {
                let bal = B0, inv = 0, put = 0, interest = 0, paidOff = null, m = 0;
                for (m = 1; m <= horizon; m++) {
                    let toInvest = extraToLoan ? 0 : X;
                    if (bal > 0.005) {
                        const it = bal * r, due = P + (extraToLoan ? X : 0), pay = Math.min(bal + it, due);
                        bal = bal + it - pay; interest += it; toInvest += due - pay + it * d;
                        if (bal <= 0.005 && paidOff === null) paidOff = m;
                    } else toInvest += P + (extraToLoan ? X : 0);
                    inv = inv * (1 + g) + toInvest; put += toInvest;
                }
                const after = inv - Math.max(0, inv - put) * num(gainsTaxPct) / 100;
                return { wealth: after, interest, paidOff: paidOff === null ? horizon : paidOff };
            };
            return { a: path(true), b: path(false) };
        };
        // The horizon: when the loan would be paid as scheduled.
        let horizon = 0;
        for (let bal = B0; bal > 0.005 && horizon < maxMonths; horizon++) bal = bal * (1 + r) - P;
        if (!B0 || !horizon || P <= B0 * r) return { horizon, never: P <= B0 * r && B0 > 0 };
        const x = run(returnPct);
        // Break-even return: invest wins above it (bisection; invest − prepay grows with the return).
        let lo = 0, hi = 40;
        const diffAt = (ret) => { const y = run(ret); return y.b.wealth - y.a.wealth; };
        let breakEven = null;
        if (X > 0 && diffAt(lo) < 0 && diffAt(hi) > 0) {
            for (let i = 0; i < 50; i++) { const mid = (lo + hi) / 2; if (diffAt(mid) > 0) hi = mid; else lo = mid; }
            breakEven = (lo + hi) / 2;
        }
        return { horizon, prepayMonths: x.a.paidOff, monthsSooner: horizon - x.a.paidOff, interestPrepay: cents(x.a.interest), interestInvest: cents(x.b.interest),
            interestSaved: cents(x.b.interest - x.a.interest), wealthPrepay: cents(x.a.wealth), wealthInvest: cents(x.b.wealth),
            diff: cents(x.b.wealth - x.a.wealth), winner: x.b.wealth > x.a.wealth + 0.5 ? 'invest' : x.a.wealth > x.b.wealth + 0.5 ? 'prepay' : 'tie', breakEven };
    }

    // Paying a credit card: months and interest at a fixed payment, and at the card's minimum
    // (a common formula: 1% of the balance plus that month's interest, at least $25).
    function cardPayoff(balance, aprPct, payment, { minPct = 1, minFloor = 25, maxMonths = 600 } = {}) {
        const run = (payFor) => {
            let bal = num(balance), interest = 0, n = 0;
            while (bal > 0.005 && n < maxMonths) {
                const i = bal * num(aprPct) / 1200, p = payFor(bal, i);
                if (p <= i + 0.005) return { never: true, months: null, interest: null };
                interest += i; bal = bal + i - Math.min(p, bal + i); n++;
            }
            return { never: n >= maxMonths && bal > 0.005, months: n, interest: cents(interest) };
        };
        return { fixed: run(() => num(payment)), minimum: run((bal, i) => Math.max(minFloor, bal * minPct / 100 + i)) };
    }
    // Money growing with monthly deposits, compounded monthly; also in today's dollars.
    function growthValue(initial, monthly, ratePct, years, inflationPct = 0) {
        const n = Math.max(0, Math.round(num(years) * 12)), r = num(ratePct) / 1200;
        const g = Math.pow(1 + r, n);
        const fv = num(initial) * g + (r > 0 ? num(monthly) * (g - 1) / r : num(monthly) * n);
        const contributed = num(initial) + num(monthly) * n;
        return { value: cents(fv), contributed: cents(contributed), growth: cents(fv - contributed), today: cents(fv / Math.pow(1 + num(inflationPct) / 100, num(years))) };
    }
    // Saving for something: how much each month to get there in `months`.
    function monthlyToReach(target, have, ratePct, months) {
        const n = Math.max(1, Math.round(num(months))), r = num(ratePct) / 1200, g = Math.pow(1 + r, n);
        const left = num(target) - num(have) * g;
        if (left <= 0) return 0;
        return cents(r > 0 ? left * r / (g - 1) : left / n);
    }

    // ------------------------------------------------------------ job-loss runway
    // If the paycheck stopped today: the money you can reach, minus what you'd still have to pay
    // each month, plus what keeps coming in (other income, unemployment benefit for its months, a
    // one-time severance). How many months it lasts (fractional), and the balance month by month.
    function jobLossRunway({ cash = 0, monthlyNeeds = 0, otherIncome = 0, benefits = [], lumpSum = 0, maxMonths = 60 }) {
        let bal = num(cash) + num(lumpSum);
        const path = [cents(bal)];
        const needs = num(monthlyNeeds);
        for (let i = 0; i < maxMonths; i++) {
            const net = needs - num(otherIncome) - num(benefits[i]);
            if (net > 0 && bal - net < 0) return { months: cents(i + (net > 0 ? Math.max(0, bal) / net : 0)), path, forever: false, gap: cents(net) };
            bal -= net;
            path.push(cents(bal));
        }
        return { months: maxMonths, path, forever: needs <= num(otherIncome), gap: cents(Math.max(0, needs - num(otherIncome))) };
    }
    // Ecuador's IESS unemployment insurance: five monthly payments of 70%, 65%, 60%, 55% and 50%
    // of the average salary of the last 12 months (estimate; the IESS confirms the amount).
    const iessUnemployment = (salary) => [70, 65, 60, 55, 50].map(p => cents(num(salary) * p / 100));

    // ------------------------------------------------------------ month close
    // How a month went, line by line: what you planned, what you spent, where you went over or
    // had money left, the expenses that never got a line, and what was left of what came in.
    function monthReview({ items = [], transactions = [], year, month }) {
        const m = String(Number(month));
        const spend = lineSpend(items, transactions, year, m);
        const lines = items.filter(i => i.type !== 'Ingreso').map(i => {
            const planned = num(i.real), spent = cents(spend.byLine[String(i.id)] ? spend.byLine[String(i.id)].spent : 0);
            return { id: i.id, name: i.name, planned, spent, left: cents(planned - spent), savings: isSavingsItem(i) || /^(goal|debt)-/.test(String(i.id)) };
        });
        const cf = cashFlow(transactions, Number(year), Number(m));
        return {
            key: `${year}-${pad2(Number(m))}`,
            planned: cents(sum(lines, l => l.planned)),
            spent: cents(cf.expense), income: cents(cf.income), leftover: cents(cf.income - cf.expense),
            over: lines.filter(l => l.left < -0.5).sort((a, b) => a.left - b.left),
            under: lines.filter(l => !l.savings && l.left > 0.5 && l.planned > 0).sort((a, b) => b.left - a.left),
            unassigned: { count: spend.unassigned.length, total: cents(spend.unassignedTotal) },
            count: (transactions || []).filter(t => inMonth(t, Number(year), Number(m))).length
        };
    }

    // ------------------------------------------------- annual & irregular bills
    // A bill that comes once a year (or every 6 / 3 months): car registration, insurance,
    // property tax, school supplies… { name, amount, every: 12 | 6 | 3, month: 1–12 (a month it's due) }.
    const billEvery = (b) => [1, 2, 3, 4, 6, 12].includes(Number(b.every)) ? Number(b.every) : 12;
    const billDueIn = (b, m) => { const e = billEvery(b); return ((m - num(b.month)) % e + e) % e === 0; };
    // Set aside each month so the money is there when each bill comes: its yearly cost ÷ 12.
    const annualSetAside = (bills) => cents(sum(bills || [], b => num(b.amount) / billEvery(b)));
    // Month by month from this one: the set-aside comes in, then that month's bills go out.
    // `needed` is what the fund is short at its lowest point (bills due before enough was saved).
    function annualBillsPlan(bills, { start = 0, monthly = null, today = new Date(), months = 12 } = {}) {
        const t = new Date(today);
        const each = monthly === null ? annualSetAside(bills) : num(monthly);
        let fund = num(start), low = fund;
        const rows = [];
        for (let i = 0; i < months; i++) {
            const d = new Date(t.getFullYear(), t.getMonth() + i, 1);
            const m = d.getMonth() + 1;
            const due = (bills || []).filter(b => num(b.amount) > 0 && billDueIn(b, m));
            const paid = sum(due, b => num(b.amount));
            fund = cents(fund + each - paid);
            low = Math.min(low, fund);
            rows.push({ key: `${d.getFullYear()}-${pad2(m)}`, month: m, year: d.getFullYear(), bills: due, paid: cents(paid), fund, short: fund < -0.005 });
        }
        return { monthly: each, yearly: cents(sum(bills || [], b => num(b.amount) * 12 / billEvery(b))), rows, needed: cents(Math.max(0, -low)), firstShort: rows.find(r => r.short) || null };
    }

    // A debt payment: this month's interest is paid first and the rest lowers the balance.
    // The interest is an estimate (balance × rate / 12) unless the statement says otherwise.
    const cents = (v) => Math.round(v * 100) / 100;
    const debtMonthlyInterest = (d) => cents(Math.max(0, num(d.balance)) * Math.max(0, num(d.rate)) / 1200);
    // What you owed at the end of each of the last `count` months (today for this month), from the
    // payments logged with "Pagar": today's balance plus what those later payments took off.
    function debtBalanceHistory(debts, today, count = 6) {
        const t = new Date(today);
        const out = [];
        for (let i = count - 1; i >= 0; i--) {
            const cut = i === 0 ? isoDate(t) : isoDate(new Date(t.getFullYear(), t.getMonth() - i + 1, 0));
            out.push({ month: cut.slice(0, 7), total: cents(sum(debts || [], d => Math.max(0, num(d.balance)) + sum((d.payments || []).filter(p => p.date > cut), p => num(p.principal)))) });
        }
        return out;
    }
    function applyDebtPayment(balance, amount, interest) {
        const bal = Math.max(0, num(balance));
        const toInterest = Math.min(Math.max(0, num(amount)), Math.max(0, num(interest)));
        const principal = Math.min(bal, Math.max(0, num(amount) - toInterest));
        return { interest: cents(toInterest), principal: cents(principal), balance: cents(bal - principal), overpaid: cents(Math.max(0, num(amount) - toInterest - bal)) };
    }

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
                payoffMonth: null,
                // First month the debt gets more than its own line (the snowball reaches it).
                attackMonth: null
            }));
            // The order the extra goes in (the bank's "In progress" menu): snowball = lowest balance
            // first (Dave Ramsey's), avalanche = highest interest, fastest payoff = fewest months at
            // its own payment, or highest balance first.
            if (strategy === 'avalanche') items.sort((a, b) => b.rate - a.rate || a.balance - b.balance);
            else if (strategy === 'highest-balance') items.sort((a, b) => b.balance - a.balance);
            else if (strategy === 'fastest') items.sort((a, b) => a.balance / Math.max(1, a.line) - b.balance / Math.max(1, b.line) || a.balance - b.balance);
            else items.sort((a, b) => a.balance - b.balance);

            let month = 0, totalInterest = 0;
            const history = [];   // total owed after each month
            const byDebt = {};    // each debt's balance after each month: { id: [..] }
            const schedule = {};  // each debt's month by month: { id: [{ payment, interest, balance }] }
            while (items.some(d => d.balance > 0.01) && month < MAX) {
                month++;
                items.forEach(d => {
                    d.paidThis = 0; d.interestThis = 0;
                    if (d.balance <= 0) return;
                    // Lenders charge interest to the cent each month (a standard amortization table).
                    const interest = Math.round(d.balance * d.rate / 1200 * 100) / 100;
                    d.balance += interest;
                    d.interestThis = interest;
                    totalInterest += interest;
                });
                let pool = mode === 'minimums' ? 0 : extra0;
                items.forEach(d => {
                    if (d.balance <= 0) { if (mode !== 'minimums') pool += d.line; return; }
                    const own = Math.min(d.line, d.minPayment);
                    const pay = Math.min(own, d.balance);
                    d.balance -= pay;
                    d.paidThis += pay;
                    if (mode !== 'minimums') pool += (d.line - own) + (own - pay);
                });
                for (const d of items) {
                    if (pool <= 0) break;
                    const pay = Math.min(pool, d.balance);
                    d.balance -= pay;
                    d.paidThis += pay;
                    pool -= pay;
                    if (pay > 0.005 && d.attackMonth === null) d.attackMonth = month;
                }
                items.forEach(d => {
                    if (d.balance <= 0.01) {
                        d.balance = 0;
                        if (d.payoffMonth === null) d.payoffMonth = month;
                    }
                });
                history.push(sum(items, d => d.balance));
                items.forEach(d => {
                    (byDebt[d.id] || (byDebt[d.id] = [])).push(d.balance);
                    // Each debt's month: what was paid and how much of it was interest (its schedule).
                    (schedule[d.id] || (schedule[d.id] = [])).push({ payment: d.paidThis, interest: d.interestThis, balance: d.balance });
                });
            }
            items.forEach((d, idx) => { d.order = idx + 1; });
            return { items, months: month, totalInterest, history, byDebt, schedule, never: month >= MAX && items.some(d => d.balance > 0.01) };
        }
        const plan = run('plan');
        const minimums = run('minimums');
        const pool = extra0 + sum(open, line);
        return {
            items: plan.items,
            history: plan.history,
            byDebt: plan.byDebt,
            schedule: plan.schedule,
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
            interestSaved: minimums.never ? 0 : Math.max(0, minimums.totalInterest - plan.totalInterest),
            // Total owed after each month paying only the minimums (to compare with `history`).
            minimumsHistory: minimums.history,
            minimumsMonths: minimums.months
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
        // With nothing going in each month, interest alone isn't a plan (it would say "2077").
        if (monthly <= 0) return { status: 'never', months: null };
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

    // A goal's card: reached / on track / behind (for its date) / no date / never (nothing going
    // in), how far along (0–1) and in how many months it's ready at today's monthly amount.
    function goalStatus(goal, today) {
        const target = num(goal.target), current = num(goal.current);
        const pct = target > 0 ? Math.min(1, Math.max(0, current / target)) : 0;
        const m = goalMonths(goal), sch = goalSchedule(goal, today);
        if (m.status === 'reached') return { state: 'reached', months: 0, pct: 1 };
        if (m.status === 'never') return { state: 'never', months: null, pct, required: sch ? sch.required : null };
        if (!sch) return { state: 'no-date', months: m.months, pct };
        return { state: sch.onTrack ? 'on-track' : 'behind', months: m.months, pct, required: sch.required, gap: sch.gap };
    }

    // Goals on one timeline (the bank's Goals screen): savings goals (when they're reached), debts
    // (when they're paid off, in the plan's order) and retirement, each with its months from today,
    // what goes in each month and whether it needs attention. Also the total a month and how much
    // of it the budget can't cover (overBy, from the budget's still-to-assign: below 0 = over).
    function goalTimeline({ goals = [], debts = [], debtPlan, retirement = null, today = new Date(), toAssign = 0 } = {}) {
        const out = [];
        (goals || []).forEach(g => {
            const st = goalStatus(g, today);
            out.push({ type: 'savings', id: g.id, name: g.name, kind: g.kind || 'other', months: st.months, monthly: num(g.monthly), saved: num(g.current), target: num(g.target), state: st.state, attention: st.state === 'behind' || st.state === 'never' });
        });
        const plan = debtPlan || { items: [] };
        (plan.items || []).forEach((it, i) => {
            const d = (debts || []).find(x => x.id === it.id);
            if (!d || d.track === false || !(num(d.balance) > 0)) return;
            out.push({ type: 'debt', id: d.id, name: d.name, kind: d.kind, months: it.payoffMonth, order: i + 1, monthly: Math.max(num(d.monthly), num(d.minPayment)), extra: Math.max(0, num(d.monthly) - num(d.minPayment)), minPayment: num(d.minPayment), rate: num(d.rate), balance: num(d.balance), original: Math.max(num(d.originalBalance), num(d.balance)), attention: !it.payoffMonth });
        });
        if (retirement && retirement.goalOn) {
            const m = goalMonths({ target: retirement.goalTarget, current: retirement.goalSaved, monthly: retirement.aporteMensual, rate: retirement.goalRate === undefined ? 6 : retirement.goalRate });
            const left = retirement.birthday ? Math.max(0, Math.round(((parseISO(retirement.birthday).getFullYear() + num(retirement.edadJubilacion || 65)) - new Date(today).getFullYear()) * 12)) : null;
            out.push({ type: 'retirement', id: 'retirement', name: 'Retirement', kind: 'retirement', months: m.months, monthly: num(retirement.aporteMensual), saved: num(retirement.goalSaved), target: num(retirement.goalTarget), retireIn: left,
                attention: m.status === 'never' || (left !== null && m.months !== null && m.months > left) });
        }
        const total = cents(sum(out.filter(x => x.type !== 'debt'), x => x.monthly) + sum(out.filter(x => x.type === 'debt'), x => x.extra));
        return { items: out, total, overBy: cents(Math.max(0, -num(toAssign))), attention: out.filter(x => x.attention).length };
    }

    // What went into a goal each month (deposits logged on its budget line, "goal-<id>"), for the
    // last `months` months up to `end`, and the average.
    function goalVelocity(transactions, goalId, { end, months = 6 } = {}) {
        const e = end instanceof Date ? end : new Date(end);
        const keys = Array.from({ length: months }, (_, i) => { const d = new Date(e.getFullYear(), e.getMonth() - months + 1 + i, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; });
        const values = keys.map(k => sum((transactions || []).filter(t => String(t.budgetLine) === 'goal-' + goalId && t.date && t.date.slice(0, 7) === k), t => amt(t)));
        return { months: keys, values, average: sum(values, v => v) / months };
    }

    // Alerts (an inbox in the app, no push): the balance going below $0 or the cushion in the
    // forecast, bills due within 3 days, budget lines over plan this month, and unusually large
    // purchases of the last 2 weeks (3× the usual in its category, $100 or more). Each has a stable
    // key so it can be dismissed. forecast: cashForecast() days; bills: cash events of kind 'bill';
    // lines: [{ id, name, planned, spent }] for this month.
    function buildAlerts({ today, forecast = [], buffer = 0, bills = [], lines = [], transactions = [] }) {
        const t = isoDate(new Date(today)), month = t.slice(0, 7), out = [];
        const short = forecast.find(d => d.balance < 0), low = !short && num(buffer) > 0 && forecast.find(d => d.balance < num(buffer));
        if (short) out.push({ key: 'short-' + short.date, kind: 'short', level: 'bad', date: short.date, amount: short.balance });
        else if (low) out.push({ key: 'low-' + low.date, kind: 'low', level: 'warn', date: low.date, amount: low.balance });
        const soon = isoDate(new Date(parseISO(t).getTime() + 3 * 86400000));
        bills.filter(b => b.kind === 'bill' && !b.paid && b.amount < 0 && b.date >= t && b.date <= soon)
            .forEach(b => out.push({ key: `bill-${b.lineId}-${b.date}`, kind: 'bill', level: 'warn', date: b.date, name: b.name, amount: -b.amount }));
        lines.filter(l => num(l.planned) > 0 && num(l.spent) > num(l.planned) + 0.5)
            .forEach(l => out.push({ key: `over-${l.id}-${month}`, kind: 'over', level: 'bad', name: l.name, amount: num(l.spent) - num(l.planned) }));
        const since = isoDate(new Date(parseISO(t).getTime() - 14 * 86400000)), before = isoDate(new Date(parseISO(t).getTime() - 180 * 86400000));
        const median = (xs) => { const a = xs.slice().sort((x, y) => x - y); const m = a.length >> 1; return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2; };
        const byCat = {}, seen = {};
        const payee = (x) => String(x.description || '').trim().toLowerCase();
        (transactions || []).forEach(x => {
            if (txnType(x) !== 'Gasto' || x.refund || x.date < before || x.date >= since) return;
            (byCat[x.parentCategory] = byCat[x.parentCategory] || []).push(num(x.amount));
            (seen[payee(x)] = seen[payee(x)] || []).push(num(x.amount));
        });
        (transactions || []).forEach(x => {
            if (txnType(x) !== 'Gasto' || x.refund || x.recurringId || !x.date || x.date < since || x.date > t) return;
            // A payee already paid about this much (a bill, the mortgage) isn't unusual.
            if ((seen[payee(x)] || []).some(v => v >= num(x.amount) * 0.7)) return;
            const hist = byCat[x.parentCategory] || [];
            if (hist.length >= 5 && num(x.amount) >= 100 && num(x.amount) >= 3 * median(hist)) out.push({ key: 'big-' + x.id, kind: 'big', level: 'info', date: x.date, name: x.description, amount: num(x.amount), usual: median(hist) });
        });
        const rank = { bad: 0, warn: 1, info: 2 };
        return out.sort((a, b) => rank[a.level] - rank[b.level]);
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
        months = Math.min(600, Math.max(1, Math.round(num(months))));      // at most 50 years
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
            return { yearly: true, marks, labels: marks.map(m => m % 12 === 0 ? `Year ${m / 12}` : `Year ${Math.floor(m / 12)}+${m % 12}m`), title: 'Loan Term (years)' };
        }
        const marks = Array.from({ length: scheduleLength }, (_, k) => k + 1);
        return { yearly: false, marks, labels: marks.map(m => `Month ${m}`), title: 'Loan Term (months)' };
    }

    // Value of `field` at each axis mark; undefined past the end of a shorter schedule.
    function sampleSchedule(schedule, axis, field, cumulative) {
        let running = 0;
        const series = schedule.map(s => (cumulative ? (running += s[field]) : s[field]));
        return axis.marks.map(m => (m > series.length ? undefined : series[m - 1]));
    }

    // Principal and interest paid in each loan year (the last year may be partial), and the
    // balance left at its end: [{ year, months, principal, interest, balance }].
    function amortizationByYear(schedule) {
        const out = [];
        (schedule || []).forEach((r, i) => {
            const y = Math.floor(i / 12);
            const row = out[y] || (out[y] = { year: y + 1, months: 0, principal: 0, interest: 0, balance: 0 });
            row.months++;
            row.principal += num(r.principal);
            row.interest += num(r.interest);
            row.balance = num(r.balance);
        });
        return out;
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

    // IESS old-age pension: the first age, from the retirement age on, at which the years paid in
    // qualify — 40 years at any age, or 60 with 30, 65 with 15, 70 with 10. null = never.
    function iessPensionAge(retireAge, years) {
        const y = num(years);
        if (y >= 40) return retireAge;
        for (const [age, need] of [[60, 30], [65, 15], [70, 10]]) if (y >= need) return Math.max(retireAge, age);
        return null;
    }

    // Long-run defaults (historical averages; the person can change them in Jubilación):
    // US CPI inflation ~3% a year since 1926 and US stocks ~10% a year (nominal); Ecuador's
    // inflation since dollarization ~2.5%.
    const DEFAULT_INFLATION = { US: 3, EC: 2.5 };
    const DEFAULT_RETURN = { US: 10 };

    // Retirement in TODAY's dollars: savings grow at the (nominal) return and are brought back to
    // today's money with inflation, so they add up with Social Security / the IESS pension, which
    // are estimated in today's money. A pension only counts from the age you can collect it.
    function retirement(inp) {
        const edadActual = Math.min(110, Math.max(0, Math.round(num(inp.edadActual))));
        const edadJubilacion = Math.min(110, Math.max(edadActual, Math.round(num(inp.edadJubilacion)) || 65));
        const anios = edadJubilacion - edadActual;
        const months = anios * 12;
        const rate = Math.max(0, num(inp.tasaRetorno));
        const infl = Math.max(0, num(inp.inflacion)) / 100;
        const deflate = (value, m) => value / Math.pow(1 + infl, m / 12);
        const schedule = (monthly, real) => {
            const out = [];
            for (let m = 0; m <= months; m += 12) { const v = futureValue(inp.ahorroActual, monthly, rate, m); out.push(real ? deflate(v, m) : v); }
            return out;
        };
        const aporte = Math.max(0, num(inp.aporteMensual));
        const extra = Math.max(0, num(inp.whatIfExtra));
        const withdraw = Math.max(0, num(inp.tasaRetiroSegura)) / 100;
        let pensionM, pensionDesde, pensions = [];
        if (inp.country === 'US') {
            // Social Security can't start before 62; claiming later raises it (up to 70). Every earner
            // in the household gets their own, from their own pay (inp.others: [{ name, sueldoPromedio }]).
            pensionDesde = Math.min(70, Math.max(62, edadJubilacion));
            const own = socialSecurity({ ...inp, aniosRestantes: anios, edadJubilacion: pensionDesde });
            pensions = [{ name: inp.name || '', amount: own }].concat((inp.others || []).map(o => ({ name: o.name || '', amount: socialSecurity({ ...inp, sueldoPromedio: num(o.sueldoPromedio), aniosRestantes: anios, edadJubilacion: pensionDesde }) })));
            pensionM = sum(pensions, x => x.amount);
        } else {
            pensionDesde = iessPensionAge(edadJubilacion, num(inp.aniosAportados) + anios);
            pensionM = pensionDesde === null ? 0 : pension({ ...inp, aniosRestantes: anios });
        }

        const base = schedule(aporte, true);
        const valorFuturoHoy = base[base.length - 1];
        const valorFuturo = futureValue(inp.ahorroActual, aporte, rate, months);
        // The 4% rule: a first-year withdrawal that then rises with inflation — in today's money.
        const ingresoAhorro = valorFuturoHoy * withdraw / 12;
        const result = {
            edadActual, edadJubilacion, aniosRestantes: anios, inflacion: infl * 100, tasaRetorno: rate,
            valorFuturo, valorFuturoHoy, ingresoAhorro, pension: pensionM, pensionDesde, pensions,
            // Years between retiring and the first pension check, lived on savings alone.
            aniosPuente: pensionDesde === null ? 0 : Math.max(0, pensionDesde - edadJubilacion),
            ingresoTotal: ingresoAhorro + pensionM,
            schedule: base, whatIf: null
        };
        if (extra > 0) {
            const alt = schedule(aporte + extra, true);
            const altFinal = alt[alt.length - 1];
            const altIngreso = altFinal * withdraw / 12 + pensionM;
            result.whatIf = { extra, schedule: alt, valorFuturo: altFinal, gain: altFinal - valorFuturoHoy, ingresoTotal: altIngreso, deltaIngreso: altIngreso - result.ingresoTotal };
        }
        return result;
    }

    // ---------------------------------------------------------------- net worth

    const NET_WORTH_FIELDS = ['checking', 'savings', 'investments', 'mortgage', 'autoLoans', 'creditCards', 'personalLoans', 'studentLoans', 'otherDebts'];
    const NW_ASSET_FIELDS = ['checking', 'savings', 'investments'];
    const NW_LIABILITY_FIELDS = ['mortgage', 'autoLoans', 'creditCards', 'personalLoans', 'studentLoans', 'otherDebts'];
    const ASSET_CATEGORIES = ['Bienes Raíces', 'Vehículo', 'Joyas', 'Otro'];

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

    // Years worth plotting in a net-worth history: from the first year with any figure (a typed
    // balance or an asset owned) up to the latest year that has passed or is running — never
    // years before the data started, nor future years that would only repeat the last value.
    function netWorthYears(years, assets, upTo) {
        const typed = Object.keys(years || {}).map(Number).filter(y => years[y] && years[y].netWorthTouched && Object.keys(years[y].netWorthTouched).some(f => years[y].netWorthTouched[f]));
        const bought = (assets || []).map(a => num(a.purchaseYear)).filter(y => y > 0);
        const first = Math.min(...typed, ...bought);
        if (!Number.isFinite(first) || first > upTo) return [upTo];
        const out = [];
        for (let y = first; y <= upTo; y++) out.push(y);
        return out;
    }

    // This year's net worth from what the app already knows, field by field — only fields with a
    // source: investments (CDs/DPF, holdings, retirement accounts), checking and savings (when
    // accounts are registered), and each consumer-debt kind (when debts are registered).
    function netWorthFromSources({ polizas = [], holdings = [], accounts = [], debts = [] }) {
        const out = {};
        if (polizas.length || holdings.length || accounts.some(a => a.kind === 'retiro')) out.investments = polizasCapital(polizas) + holdingsValue(holdings) + accountTotal(accounts, 'retiro');
        if (accounts.length) { out.checking = accountTotal(accounts, 'cash'); out.savings = accountTotal(accounts, 'ahorros'); }
        if (debts.length) {
            DEBT_KINDS.forEach(k => { out[k.netWorthField] = 0; });
            debts.forEach(d => { const k = DEBT_KINDS.find(x => x.id === d.kind) || DEBT_KINDS[4]; out[k.netWorthField] += Math.max(0, num(d.balance)); });
        }
        // Credit card accounts (balance below zero = owed) count once: through their debt when
        // linked to one, else here.
        // Mortgage accounts (balance below zero = owed) are the mortgage line.
        const mortgages = accounts.filter(a => a.kind === 'hipoteca');
        if (mortgages.length) out.mortgage = sum(mortgages, a => Math.max(0, -num(a.balance)));
        const cards = accounts.filter(a => a.kind === 'tarjeta' && !(a.debtId && debts.some(d => d.id === a.debtId)));
        if (cards.length) out.creditCards = (out.creditCards || 0) + sum(cards, a => Math.max(0, -num(a.balance)));
        return out;
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

    // Everything you have and owe, grouped like a bank's account list: checking, savings, cash,
    // investment, property, credit card, mortgage, loan. Each row says where it lives (ref) so the
    // app can open it. A card account linked to its debt shows once (as the debt, with the
    // account's name). Liabilities are positive amounts in `owed` groups.
    // Investment-type accounts (kind 'retiro') say what they are (subtype): retirement plans, health
    // accounts or other investments. Older accounts without one are guessed from the name.
    const ACCOUNT_SUBTYPES = [
        { id: '401k', label: 'Traditional 401(k)', group: 'retirement' }, { id: 'roth-401k', label: 'Roth 401(k)', group: 'retirement' },
        { id: 'after-tax-401k', label: 'After-tax 401(k)', group: 'retirement' }, { id: '403b', label: '403(b)', group: 'retirement' },
        { id: 'ira', label: 'Traditional IRA', group: 'retirement' }, { id: 'roth-ira', label: 'Roth IRA', group: 'retirement' },
        { id: 'sep-ira', label: 'SEP IRA', group: 'retirement' }, { id: 'pension', label: 'Pension', group: 'retirement' },
        { id: 'retirement', label: 'Other retirement', group: 'retirement' },
        { id: 'hsa', label: 'HSA', group: 'health' }, { id: 'fsa', label: 'FSA', group: 'health' },
        { id: 'brokerage', label: 'Brokerage', group: 'investment' }, { id: '529', label: '529 college', group: 'investment' },
        { id: 'other-invest', label: 'Other investment', group: 'investment' }
    ];
    function accountSubtype(a) {
        if (!a || a.kind !== 'retiro') return null;
        if (a.subtype && ACCOUNT_SUBTYPES.some(t => t.id === a.subtype)) return a.subtype;
        const n = String(a.name || '').toLowerCase();
        if (/\bhsa\b|health savings/.test(n)) return 'hsa';
        if (/\bfsa\b|flexible spending/.test(n)) return 'fsa';
        if (/after[- ]?tax/.test(n)) return 'after-tax-401k';
        if (/roth/.test(n) && /401/.test(n)) return 'roth-401k';
        if (/roth/.test(n)) return 'roth-ira';
        if (/sep/.test(n) && /ira/.test(n)) return 'sep-ira';
        if (/\bira\b/.test(n)) return 'ira';
        if (/403/.test(n)) return '403b';
        if (/401/.test(n)) return '401k';
        if (/pension/.test(n)) return 'pension';
        if (/529/.test(n)) return '529';
        if (/brokerage|invest|stock|etf|fund/.test(n)) return 'brokerage';
        return 'retirement';
    }
    // Retirement money for the retirement planner: not health spending (FSA) or college (529).
    const isRetirementMoney = (a) => a.kind === 'retiro' && !['fsa', '529'].includes(accountSubtype(a));

    // Everything you have and owe, grouped like a bank's account list, in four sections: cash and
    // bank, investments, property, debts. Each row says where it lives (ref) so the app can open it.
    // A card account linked to its debt shows once (as the debt, with the account's name).
    // Liabilities are positive amounts in `owed` groups.
    const HUB_GROUPS = [
        { key: 'checking', label: 'Checking', section: 'cash', owed: false }, { key: 'savings', label: 'Savings', section: 'cash', owed: false },
        { key: 'cash', label: 'Cash', section: 'cash', owed: false },
        { key: 'retirement', label: 'Retirement', section: 'invest', owed: false }, { key: 'health', label: 'Health (HSA, FSA)', section: 'invest', owed: false },
        { key: 'investment', label: 'Investments', section: 'invest', owed: false },
        { key: 'realestate', label: 'Real estate', section: 'property', owed: false }, { key: 'vehicle', label: 'Vehicles', section: 'property', owed: false },
        { key: 'valuables', label: 'Jewelry & other', section: 'property', owed: false },
        { key: 'card', label: 'Credit Cards', section: 'debt', owed: true }, { key: 'mortgage', label: 'Mortgages', section: 'debt', owed: true },
        { key: 'loan', label: 'Loans', section: 'debt', owed: true }
    ];
    const HUB_SECTIONS = [{ key: 'cash', label: 'Cash & bank' }, { key: 'invest', label: 'Investments & retirement' }, { key: 'property', label: 'Property' }, { key: 'debt', label: 'Debts' }];
    function accountsHub({ accounts = [], holdings = [], polizas = [], assets = [], debts = [], years = {}, year }) {
        const rows = {}; HUB_GROUPS.forEach(g => { rows[g.key] = []; });
        const linked = new Set();
        (accounts || []).forEach(a => {
            if (a.kind === 'tarjeta') {
                if (a.debtId && (debts || []).some(d => d.id === a.debtId)) { linked.add(a.debtId); return; }
                rows.card.push({ ref: { type: 'account', id: a.id }, name: a.name, kind: a.kind, balance: Math.max(0, -num(a.balance)) });
                return;
            }
            if (a.kind === 'hipoteca') { rows.mortgage.push({ ref: { type: 'account', id: a.id }, name: a.name, kind: a.kind, balance: Math.max(0, -num(a.balance)) }); return; }
            if (a.kind === 'retiro') {
                const st = accountSubtype(a), def = ACCOUNT_SUBTYPES.find(t => t.id === st);
                rows[def.group].push({ ref: { type: 'account', id: a.id }, name: a.name, kind: st, balance: num(a.balance) });
                return;
            }
            const g = a.kind === 'ahorros' ? 'savings' : a.kind === 'efectivo' ? 'cash' : 'checking';
            rows[g].push({ ref: { type: 'account', id: a.id }, name: a.name, kind: a.kind || 'corriente', balance: num(a.balance) });
        });
        (holdings || []).forEach(h => rows.investment.push({ ref: { type: 'holding', id: h.id }, name: h.name || h.ticker || '', sub: h.ticker || '', kind: 'holding', balance: holdingValue(h) }));
        (polizas || []).forEach(p => rows.investment.push({ ref: { type: 'poliza', id: p.id }, name: p.coopName || 'CD', sub: p.number || '', kind: 'poliza', balance: num(p.amount) }));
        (assets || []).forEach(a => {
            if (!assetOwned(a, year)) return;
            const g = a.category === 'Bienes Raíces' ? 'realestate' : a.category === 'Vehículo' ? 'vehicle' : 'valuables';
            rows[g].push({ ref: { type: 'asset', id: a.id }, name: a.name, kind: a.category, balance: assetValue(a, year) });
        });
        (debts || []).forEach(d => {
            if (!(num(d.balance) > 0)) return;
            const acct = linked.has(d.id) && (accounts || []).find(a => a.debtId === d.id && a.kind === 'tarjeta');
            rows[d.kind === 'tarjeta' ? 'card' : 'loan'].push({ ref: { type: 'debt', id: d.id }, name: acct ? acct.name : d.name, kind: d.kind, balance: num(d.balance), accountId: acct ? acct.id : null });
        });
        // The mortgage typed in Net Worth, unless it's kept as a mortgage account.
        const mortgage = netWorthField(years, year, 'mortgage');
        if (mortgage > 0 && !rows.mortgage.length) rows.mortgage.push({ ref: { type: 'field', id: 'mortgage' }, name: 'Mortgage', kind: 'mortgage', balance: mortgage });
        const groups = HUB_GROUPS.map(g => ({ ...g, rows: rows[g.key], total: sum(rows[g.key], r => r.balance) }));
        const sections = HUB_SECTIONS.map(x => ({ ...x, total: sum(groups.filter(g => g.section === x.key), g => g.total) }));
        const assetsTotal = sum(groups.filter(g => !g.owed), g => g.total), owedTotal = sum(groups.filter(g => g.owed), g => g.total);
        return { groups, sections, assets: assetsTotal, liabilities: owedTotal, net: assetsTotal - owedTotal };
    }

    // One account's money in and out per month (the last `months` up to `end`) and its
    // transactions, newest first: for the account details "Activity" tab. Income and refunds are
    // money in; spending is money out; a transfer goes by its sign (`signed`), if known.
    function accountActivity(transactions, accountId, { end, months = 12 } = {}) {
        const e = end instanceof Date ? end : new Date(end);
        const keys = Array.from({ length: months }, (_, i) => { const d = new Date(e.getFullYear(), e.getMonth() - months + 1 + i, 1); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}`; });
        const at = {}; keys.forEach((k, i) => { at[k] = i; });
        const inn = new Array(months).fill(0), out = new Array(months).fill(0);
        const list = (transactions || []).filter(t => accountId !== null && accountId !== undefined && String(t.accountId) === String(accountId));
        list.forEach(t => {
            const i = t.date ? at[t.date.slice(0, 7)] : undefined;
            if (i === undefined) return;
            const a = Math.abs(num(t.amount));
            const dir = txnType(t) === 'Ingreso' ? 1 : txnType(t) === 'Transferencia' ? Math.sign(num(t.signed)) : (t.refund ? 1 : -1);
            if (dir > 0) inn[i] += a; else if (dir < 0) out[i] += a;
        });
        return { months: keys, in: inn, out, txns: list.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))) };
    }

    // ---------------------------------------------------- emergency fund & steps

    // What a pot of savings is for: 'emergencia', 'jubilacion' or 'general'. The person can set
    // it; otherwise the name says it (an "Emergency Fund" line, a "401(k)", "Fondo de Reserva"…).
    const SAVINGS_PURPOSES = ['emergencia', 'jubilacion', 'general'];
    function savingsPurpose(x) {
        if (x && SAVINGS_PURPOSES.includes(x.purpose)) return x.purpose;
        const n = String((x && (x.name || x.coopName)) || '').toLowerCase();
        if (/emergenc|reserva|imprevist|colch[oó]n|rainy/.test(n)) return 'emergencia';
        if (/401|403\(?b|457|\bira\b|roth|jubil|retir|pensi[oó]n|voluntari/.test(n)) return 'jubilacion';
        return 'general';
    }

    // Each dollar of savings counts once. Emergency money first: savings accounts, CDs/DPF (not
    // the ones set aside for retirement) and emergency goals, up to 6 months of essential
    // expenses. What's beyond that, plus retirement accounts, CDs and investments, is what grows
    // for retirement.
    function savingsPools({ polizas = [], savingsBalance = 0, goals = [], retirementAccounts = 0, holdings = 0, monthlyEssential = 0 }) {
        const poolPolizas = sum(polizas.filter(p => savingsPurpose(p) !== 'jubilacion'), p => num(p.amount));
        const retirePolizas = sum(polizas.filter(p => savingsPurpose(p) === 'jubilacion'), p => num(p.amount));
        const emergencyGoals = sum(goals.filter(g => savingsPurpose(g) === 'emergencia'), g => num(g.current));
        const pool = poolPolizas + Math.max(0, num(savingsBalance));
        const target = Math.max(0, num(monthlyEssential)) * 6;
        const emergency = emergencyGoals + Math.min(pool, Math.max(0, target - emergencyGoals));
        const excess = pool - (emergency - emergencyGoals);
        return { emergency, invested: excess + retirePolizas + num(retirementAccounts) + num(holdings), excess, target };
    }

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
    // Consecutive days (up to today, or yesterday if today has nothing yet) with at least one
    // transaction logged, and which days of this week (Mon–Sun) had one.
    function loggingStreak(transactions, today) {
        const days = new Set((transactions || []).map(t => (t.createdAt ? isoDate(new Date(t.createdAt)) : t.date)));
        const t = new Date(today);
        const d = new Date(t.getFullYear(), t.getMonth(), t.getDate());
        const loggedToday = days.has(isoDate(d));
        if (!loggedToday) d.setDate(d.getDate() - 1);
        let n = 0;
        while (days.has(isoDate(d)) && n < 3660) { n++; d.setDate(d.getDate() - 1); }
        const start = periodStart(t, 'week');
        const week = Array.from({ length: 7 }, (_, i) => { const x = new Date(start); x.setDate(start.getDate() + i); return days.has(isoDate(x)); });
        return { days: n, week, today: loggedToday };
    }

    // Rough projection of net worth month by month (an estimate, explained as such in the UI).
    // Only invested money (`invested`: pólizas, investments) and new savings earn `rate`; the
    // rest of net worth (house, car, cash) is held flat. While debts are being paid, each
    // month's payment raises net worth by what goes to principal; once debt-free, that money
    // is saved and invested too.
    // Net worth month by month, in today's dollars when an inflation rate is given.
    function netWorthPath({ start, invested = 0, monthlySavings, rate, debtBalance = 0, debtMonths = 0, debtPayment = 0, months, inflation = 0 }) {
        const r = num(rate) / 1200;
        const real = (v, m) => v / Math.pow(1 + Math.max(0, num(inflation)) / 100, m / 12);
        const flat = num(start) - Math.max(0, num(invested));
        let pot = Math.max(0, num(invested));
        let paid = 0;
        const principalPerMonth = debtMonths > 0 ? num(debtBalance) / debtMonths : 0;
        const out = [Math.round(flat + pot)];
        for (let m = 1; m <= months; m++) {
            pot += pot * r + num(monthlySavings) + (m > debtMonths ? num(debtPayment) : 0);
            if (m <= debtMonths) paid += principalPerMonth;
            out.push(Math.round(real(flat + pot + paid, m)));
        }
        return out;
    }

    function babySteps({ liquid, consumerDebt, monthsCovered, savingsRate, mortgageBalance, ownsHome = mortgageBalance > 0.01, money = (v) => '$' + Math.round(v).toLocaleString('en-US') }) {
        const steps = [
            { n: 1, title: 'Starter Emergency Fund', done: liquid >= 1000, detail: `${Math.min(100, liquid / 10).toFixed(0)}% of ${money(1000)}` },
            { n: 2, title: 'Pay Off Consumer Debt', done: consumerDebt <= 0.01, detail: consumerDebt > 0.01 ? `${money(consumerDebt)} left` : 'No debt' },
            { n: 3, title: 'Full Emergency Fund', done: monthsCovered >= 3, detail: `${monthsCovered.toFixed(1)} of 3-6 months` },
            { n: 4, title: 'Invest 15% for Retirement', done: savingsRate >= 0.15, detail: `You save ${(savingsRate * 100).toFixed(0)}% of your salary` },
            { n: 5, title: 'Kids\' Education', done: null, detail: 'Optional — use a savings Goal' },
            // A renter hasn't "paid off the home": the step is about saving for one (or not wanting one).
            { n: 6, title: 'Pay Off the Home', done: ownsHome ? mortgageBalance <= 0.01 : null, detail: mortgageBalance > 0.01 ? `Balance ${money(mortgageBalance)}` : (ownsHome ? 'Home paid off' : 'No home of your own — save the down payment with a Goal') },
            { n: 7, title: 'Build Wealth and Give', done: null, detail: 'Financial freedom' }
        ];
        let current;
        if (!steps[0].done) current = 1;
        else if (!steps[1].done) current = 2;
        else if (!steps[2].done) current = 3;
        else if (!steps[3].done || steps[5].done === false) current = 4;
        else current = 7;
        steps.forEach(s => {
            // Steps are done in order: while one is current, the later ones wait (an emergency
            // fund isn't "full" while consumer debt is open — that money goes to the snowball).
            const reached = s.n < current || (current === 4 && s.n <= 6) || current === 7;
            s.state = s.done === true && reached ? 'done' : (s.n === current || (current === 4 && s.n >= 4 && s.n <= 6) ? 'current' : 'pending');
        });
        return { steps, current };
    }

    // ------------------------------------------------------------------ cash on hand & ahead
    // Cash you can reach today: checking + cash accounts (savings stay out), moved by what you
    // logged after the balance date. Credit-card purchases don't leave the account until the
    // card is paid, so they're not subtracted.
    // US mortgage: principal & interest + property tax + home insurance + PMI + HOA, per month.
    // PMI is charged only while you owe more than 80% of the home's value, and the lender must drop
    // it when the balance reaches 78% of the original value (Homeowners Protection Act). With the
    // home value: PMI is 0 from the start at ≤ 80%, and pmiMonths says how long it lasts.
    function pitiMonthly({ payment, amount, propertyTax = 0, homeInsurance = 0, pmiRate = 0, hoa = 0, homeValue = 0, schedule = null }) {
        const value = num(homeValue);
        const needsPmi = num(pmiRate) > 0 && !(value > 0 && num(amount) <= value * 0.8);
        const parts = { pi: num(payment), tax: num(propertyTax) / 12, ins: num(homeInsurance) / 12, pmi: needsPmi ? num(amount) * num(pmiRate) / 1200 : 0, hoa: num(hoa) };
        let pmiMonths = null;
        if (needsPmi && value > 0 && schedule) {
            const i = schedule.findIndex(r => r.balance <= value * 0.78);
            pmiMonths = i < 0 ? schedule.length : i + 1;
        }
        return Object.assign(parts, { total: parts.pi + parts.tax + parts.ins + parts.pmi + parts.hoa, pmiMonths, pmiTotal: pmiMonths !== null ? pmiMonths * (needsPmi ? num(amount) * num(pmiRate) / 1200 : 0) : null });
    }

    // Account kinds: cash you can spend (checking, cash), savings, retirement (401(k)/IRA).
    const isCashAccount = (a) => !a.kind || a.kind === 'corriente' || a.kind === 'efectivo';
    // An account's balance after importing rows into it (no balance column in the file): money in
    // adds, money out subtracts; transfers keep the file's sign (a card payment lowers what's owed).
    function balanceAfterRows(balance, rows) {
        return Math.round((num(balance) + sum(rows || [], r => {
            const a = Math.abs(num(r.amount));
            if (r.type === 'Ingreso') return a;
            if (r.type === 'Transferencia') return r.signed !== undefined && r.signed !== null && num(r.signed) !== 0 ? Math.sign(num(r.signed)) * a : 0;
            return -a;
        })) * 100) / 100;
    }
    const accountTotal = (accounts, kinds) => sum((accounts || []).filter(a => (kinds === 'cash' ? isCashAccount(a) : a.kind === kinds)), a => num(a.balance));
    function cashNow(accounts, transactions, today) {
        const cash = (accounts || []).filter(isCashAccount);
        if (!cash.length) return null;
        const t = isoDate(new Date(today));
        const asOf = cash.map(a => a.updatedAt || '').sort().pop() || t;
        const base = sum(cash, a => num(a.balance));
        let adjust = 0;
        const isCash = (ref) => cash.some(a => 'acc-' + a.id === ref);
        (transactions || []).forEach(x => {
            if (!x.date || x.date <= asOf || x.date > t) return;
            // A transfer leaves your cash unless it came from savings, and arrives if it went
            // to a checking/cash account (paying a card or moving money to savings lowers it).
            if (isTransfer(x)) { adjust += num(x.amount) * ((isCash(x.to) ? 1 : 0) - (!x.from || isCash(x.from) ? 1 : 0)); return; }
            // Card purchases leave the account when the card is paid; purchases paid from a
            // savings fund (a goal) come out of savings.
            if (x.paymentType === 'Tarjeta de Crédito' || x.fromGoal) return;
            adjust += txnType(x) === 'Ingreso' ? num(x.amount) : -amt(x);
        });
        return { base, adjust, total: base + adjust, asOf, accounts: cash.length };
    }

    // Money that will leave or arrive on known dates between `from` and `to` (ISO):
    // bills (budget lines with a due day: what's still unpaid), repeating/scheduled
    // transactions, and paydays (net salary split between them).
    // months: [{ year, month, items, spend }] covering the range (current month may include
    // overdue unpaid bills, dated before `from`).
    function cashEvents({ from, to, months, recurring, paydays, schedule, payPerMonth = 0, payBase, oneOff = [] }) {
        const out = [];
        const billLines = new Set();
        const billCats = new Set();
        (months || []).forEach(({ year, month, items, spend }) => {
            billsDue({ items, spend, year, month, today: parseISO(from) }).forEach(b => {
                const date = `${year}-${pad2(month)}-${pad2(b.day)}`;
                billLines.add(String(b.item.id));
                if (b.item.linkedCategory && b.item.linkedCategory !== 'none') billCats.add(b.item.linkedCategory);
                if (date > to) return;
                out.push({ date, kind: 'bill', name: b.item.name, amount: -b.remaining, planned: b.planned, paid: b.paid, lineId: String(b.item.id) });
            });
        });
        const sch = normalizeSchedule(schedule || paydays);
        (recurring || []).forEach(r => {
            if (r.auto === false) return;
            const inc = (r.type || 'Gasto') === 'Ingreso';
            // Already counted: a bill's line, or the salary when paydays are set.
            if (!inc && ((r.budgetLine && billLines.has(String(r.budgetLine))) || (!r.budgetLine && billCats.has(r.parentCategory)))) return;
            if (inc && sch && isPayrollTxn(r)) return;
            const after = r.lastPosted && r.lastPosted >= from ? isoDate(new Date(parseISO(r.lastPosted).getTime() + 86400000)) : from;
            occurrences(r, after, to).forEach(date => out.push({ date, kind: inc ? 'income' : 'scheduled', name: r.description, amount: (inc ? 1 : -1) * num(r.amount) }));
        });
        // payPerMonth: the month's net pay, one amount or { 'YYYY-MM': amount } (months with a
        // décimo pay more); payBase: the same without bonuses (defaults to payPerMonth).
        const pick = (v, key) => (v && typeof v === 'object' ? num(v[key]) : num(v));
        if (sch) {
            const byMonth = {};
            payDates(sch, from, to).forEach(date => { (byMonth[date.slice(0, 7)] = byMonth[date.slice(0, 7)] || []).push(date); });
            // Fixed days every month: that month's pay split between them (as before). Any other
            // rhythm: each payment is the stated amount, or the yearly net pay over the payments
            // of the year; bonuses (décimos) arrive with the month's first payment.
            const split = sch.freq === 'monthly' && sch.interval === 1 && !sch.amount;
            const nominal = nominalPaymentsPerYear(sch);
            Object.keys(byMonth).forEach(key => {
                const dates = byMonth[key];
                const total = pick(payPerMonth, key);
                const base = payBase === undefined ? total : pick(payBase, key);
                if (split) {
                    // Split by all of the month's paydays, even when the range ends mid-month.
                    const all = payDates(sch, `${key}-01`, `${key}-${pad2(daysIn(Number(key.slice(0, 4)), Number(key.slice(5))))}`).filter(d => d.startsWith(key)).length || dates.length;
                    if (total > 0) dates.forEach(date => out.push({ date, kind: 'payday', name: 'Día de pago', amount: total / all }));
                    return;
                }
                const n = nominal;
                const each = sch.amount || (n ? base * 12 / n : 0);
                if (each > 0) dates.forEach(date => out.push({ date, kind: 'payday', name: 'Día de pago', amount: each }));
                if (total - base > 0.004) out.push({ date: dates[0], kind: 'payday', name: 'Décimo / bono', amount: total - base });
            });
        }
        // Cash events you added by hand (a tax refund, a car repair…).
        // Cash events you added (a tax refund, a car repair…), once or repeating (forecast only:
        // they never create transactions).
        (oneOff || []).forEach(e => {
            if (!num(e.amount)) return;
            const dates = e.frequency && e.frequency !== 'once' ? occurrences({ startDate: e.date, frequency: e.frequency, endDate: e.endDate }, from, to) : (e.date >= from && e.date <= to ? [e.date] : []);
            dates.forEach(date => out.push({ date, kind: 'oneoff', name: e.name || '', amount: num(e.amount), id: e.id, key: e.key || repeatKey({ description: e.name }) }));
        });
        return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
    }

    // "Add a cash event" → Suggested: payees and payers that came up at least twice in the last
    // `days` days (money in or out), with how often they seem to repeat, newest first. Skips
    // transfers, what already has an event (keys) and what was dismissed.
    function suggestCashEvents(transactions, { today = new Date(), days = 100, skip = [] } = {}) {
        const t = new Date(today), from = isoDate(new Date(t.getFullYear(), t.getMonth(), t.getDate() - days)), to = isoDate(t);
        const no = new Set(skip || []), groups = {};
        (transactions || []).forEach(x => {
            if (!x.date || x.date < from || x.date > to || isTransfer(x) || x.refund) return;
            const k = repeatKey(x);
            if (k.length < 3 || no.has(k)) return;
            (groups[k] = groups[k] || []).push(x);
        });
        return Object.keys(groups).filter(k => groups[k].length >= 2).map(k => {
            const list = groups[k].slice().sort((a, b) => a.date.localeCompare(b.date)), last = list[list.length - 1];
            const gaps = list.slice(1).map((x, i) => (parseISO(x.date) - parseISO(list[i].date)) / 86400000).filter(g => g > 0);
            const g = gaps.length ? median(gaps) : 30;
            const frequency = g <= 10 ? 'weekly' : g <= 20 ? 'biweekly' : g <= 50 ? 'monthly' : g <= 120 ? 'quarterly' : 'yearly';
            const inc = txnType(last) === 'Ingreso';
            return { key: k, name: last.description || last.store || '', category: last.category || last.parentCategory || '', parentCategory: last.parentCategory || '', last: last.date, count: list.length,
                amount: cents((inc ? 1 : -1) * (inc ? num(last.amount) : amt(last))), frequency, accountId: last.accountId || null };
        }).sort((a, b) => b.last.localeCompare(a.last) || a.name.localeCompare(b.name));
    }

    // Where a cash event stands (the bank's ✓ / ! / ○): paid when a transaction like it (same payee,
    // about the same amount, within 4 days) is there, or a bill is covered, or pay day is past;
    // past due when its date passed without that; else upcoming, with how many days to go.
    function cashEventStatus(e, today, transactions) {
        const t = isoDate(new Date(today)), days = Math.round((parseISO(e.date) - parseISO(t)) / 86400000);
        const near = (x) => Math.abs((parseISO(x.date) - parseISO(e.date)) / 86400000) <= 4;
        const amount = Math.abs(num(e.amount));
        const match = (transactions || []).filter(x => x.date && near(x) && !isTransfer(x) && repeatKey(x) && repeatKey(x) === (e.key || repeatKey({ description: e.name }))
            && Math.abs((txnType(x) === 'Ingreso' ? num(x.amount) : amt(x)) - amount) <= Math.max(1, amount * 0.15)).sort((a, b) => a.date.localeCompare(b.date))[0];
        if (match) return { state: 'paid', on: match.date, days };
        if (e.kind === 'bill' && amount < 0.005) return { state: 'paid', on: null, days };
        if (days < 0) return (e.kind === 'payday' || e.kind === 'income' || e.kind === 'scheduled') ? { state: 'paid', on: e.date, days } : { state: 'due', on: null, days };
        return { state: 'upcoming', on: null, days };
    }

    // How much of today's cash is free to spend: minus what must go out before the next payday
    // (unpaid bills, overdue ones included, and scheduled payments), minus what this month's
    // savings/goal lines still need, minus the cushion you want to keep.
    function safeToSpend({ cash, today, until, events, setAside = 0, buffer = 0 }) {
        const t = isoDate(new Date(today));
        const out = (events || []).filter(e => e.amount < 0 && e.date <= until && (e.date >= t || e.kind === 'bill'));
        const bills = -sum(out.filter(e => e.kind === 'bill'), e => e.amount);
        const scheduled = -sum(out.filter(e => e.kind !== 'bill'), e => e.amount);
        const safe = num(cash) - bills - scheduled - num(setAside) - num(buffer);
        const daysLeft = Math.max(1, Math.round((parseISO(until) - parseISO(t)) / 86400000));
        return { cash: num(cash), bills, scheduled, setAside: num(setAside), buffer: num(buffer), safe, perDay: safe > 0 ? safe / daysLeft : 0, daysLeft, items: out };
    }

    // Day-by-day projected balance: today's cash, the known events, and an even daily amount
    // for everyday spending (dailyByMonth: { 'YYYY-MM': amount }). Days under `buffer` are
    // flagged low; under 0, short.
    function cashForecast({ from, to, start, events, dailyByMonth = {}, buffer = 0 }) {
        const days = [];
        let bal = num(start);
        const byDate = {};
        (events || []).forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(e); });
        // Overdue unpaid bills are still owed: they leave on the first day.
        const overdue = (events || []).filter(e => e.date < from && e.amount < 0);
        for (let d = parseISO(from), end = parseISO(to), first = true; d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), first = false) {
            const iso = isoDate(d);
            const ev = byDate[iso] || [];
            const everyday = num(dailyByMonth[iso.slice(0, 7)]);
            bal += sum(ev, e => e.amount) - everyday + (first ? sum(overdue, e => e.amount) : 0);
            days.push({ date: iso, events: ev, everyday, balance: bal, status: bal < 0 ? 'short' : bal < num(buffer) ? 'low' : 'ok' });
        }
        return days;
    }

    // "What if I buy this now, from this month's budget?" Where the money would come from:
    // money not yet assigned, then the purchase's own line, then everyday (variable) lines with
    // the most left, then savings and goal lines (the sweep "Sobrante del mes" first). Fixed
    // bills and debt payments are never touched. Returns what each line would lose and any
    // amount the month can't cover.
    function starveLines({ items, spend, amount, lineId, free = 0, sweep = 0 }) {
        let need = Math.max(0, num(amount));
        const takes = [];
        const left = (i) => Math.max(0, num(i.real) - ((spend && spend.byLine[String(i.id)]) || { spent: 0 }).spent);
        const take = (id, name, kind, available) => {
            const t = Math.min(need, Math.max(0, available));
            if (t > 0.004) { takes.push({ id, name, kind, available, take: t }); need -= t; }
        };
        take('free', 'Unassigned money', 'free', num(free));
        const own = (items || []).find(i => String(i.id) === String(lineId));
        if (own && !isSavingsItem(own)) take(String(own.id), own.name, 'own', left(own));
        (items || []).filter(i => i.type === 'Gasto Variable' && i !== own).sort((a, b) => left(b) - left(a))
            .forEach(i => take(String(i.id), i.name, 'variable', left(i)));
        take('sweep', 'Monthly leftover (savings)', 'savings', num(sweep));
        (items || []).filter(i => isSavingsItem(i)).sort((a, b) => left(b) - left(a))
            .forEach(i => take(String(i.id), i.name, i.link === 'goal' ? 'goal' : 'savings', left(i)));
        return { takes, short: need > 0.004 ? need : 0 };
    }

    // ------------------------------------------------------------------ forecast
    // Future money by period (week / month / year): dated income events (paydays, repeating
    // income) land on their day; everything planned per month without a date (expenses,
    // savings, debt payments, other income) is spread evenly over the month's days.
    // monthly: { 'YYYY-MM': { income, expense, savings, debt } }.
    function projectFlows({ from, to, period = 'month', events = [], monthly = {} }) {
        const rows = new Map();
        const row = (iso) => {
            const k = isoDate(periodStart(parseISO(iso), period));
            if (!rows.has(k)) rows.set(k, { start: k, income: 0, expense: 0, savings: 0, debt: 0 });
            return rows.get(k);
        };
        for (let d = parseISO(from), end = parseISO(to); d <= end; d = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1)) {
            const iso = isoDate(d);
            const m = monthly[iso.slice(0, 7)];
            if (!m) { row(iso); continue; }
            const n = daysIn(d.getFullYear(), d.getMonth() + 1);
            const r = row(iso);
            r.income += num(m.income) / n; r.expense += num(m.expense) / n; r.savings += num(m.savings) / n; r.debt += num(m.debt) / n;
        }
        (events || []).forEach(e => { if (e.date >= from && e.date <= to && e.amount > 0) row(e.date).income += e.amount; });
        return [...rows.values()].sort((a, b) => a.start.localeCompare(b.start));
    }

    // Month-end balances ahead: cash moves with income − spending − savings − debt payments;
    // savings grow with deposits and interest (annual %); debts follow the payoff plan
    // (debtHistory: total owed after each month). Once debts are gone, their payments go to
    // savings (the snowball keeps rolling).
    function projectBalances({ start = {}, months = [], rate = 0, debtHistory = [] }) {
        let cash = num(start.cash), savings = num(start.savings), debts = num(start.debts);
        const r = num(rate) / 1200;
        return months.map((m, i) => {
            const nextDebt = debtHistory.length ? (i < debtHistory.length ? debtHistory[i] : 0) : debts;
            const free = debts <= 0.01;
            // The month a debt is paid off, only what was owed goes to it; the rest of that
            // month's debt money rolls into savings (as it does every month after).
            const paid = free ? 0 : (nextDebt <= 0.01 ? Math.min(num(m.debt), debts) : num(m.debt));
            savings = savings * (1 + r) + num(m.savings) + (num(m.debt) - paid);
            cash += num(m.income) - num(m.expense) - num(m.savings) - num(m.debt);
            debts = Math.max(0, nextDebt);
            return { key: m.key, cash, savings, debts, net: cash + savings - debts };
        });
    }

    const Engine = {
        MONTHS, MODALITIES, DEBT_KINDS, NET_WORTH_FIELDS, NW_ASSET_FIELDS, NW_LIABILITY_FIELDS, ASSET_CATEGORIES,
        num, monthItems, isSavingsItem, isEssentialItem, annualDeductibles,
        occurrences, dueOccurrences, nextOccurrence, monthlyCost, normalizeSchedule, payDates, paymentsPerYear, nominalPaymentsPerYear, extraPaycheckMonths, paycheckSalary,
        savingsPurpose, savingsPools, SAVINGS_PURPOSES, pitiMonthly, isCashAccount, accountTotal, balanceAfterRows, cashNow, cashEvents, safeToSpend, cashForecast, starveLines, projectFlows, projectBalances,
        loggingStreak, netWorthPath, goalSchedule, monthSpendCurve, categoryBreakdown, cashFlow, nextPayday, dailyAllowance, monthInsights, memberTotals,
        holdingValue, holdingsValue, lineSpend, periodStart, shiftPeriod, periodSeries, billsDue, overspendRisk, isoDate,
        DEDUCTION_GROUPS, COMPUTED_KINDS, payDeductionsSummary, bracketTax, usGrossPay, payrollUS, usFederalTax, usItemizeCheck, jointWagesUS, sideIncomeTaxes, loanInterestAhead, ASSET_CLASSES, assetClassOf, portfolioMix, prepayOrInvest, loanRateScenarios, cdRenewalRisk, usRefundEstimate, sideIncomeTax, sriPersonalExpenses, localTax, CARGAS_CANASTAS, socialSecurity, incomeTax, sriCap, payroll, d4Month, bonusForMonth, PAYROLL_SUBCATEGORIES, txnOrigin, isReconciled, spendingBreakdown, categoryTrend, budgetBubbles, autoBudget, categoryMonths, packCircles, spiralStart, suggestBudget, spendPace, monthVsAverage, personSummary, otherEarners, paycheckLines, usWages, bandAt, zoomRange, bandMiddle, ZOOM_MAX, goalStatus, goalTimeline, goalVelocity, buildAlerts, suggestCashEvents, cashEventStatus, accountsHub, HUB_GROUPS, HUB_SECTIONS, ACCOUNT_SUBTYPES, accountSubtype, isRetirementMoney, accountActivity, RANGE_PRESETS, rangeFor, shiftRange, HOUSEHOLD, HOUSEHOLD_CATEGORIES, renameCategory, renamedCategory, isPayrollTxn, isTransfer, spendAmount: amt, debtMonthlyInterest, applyDebtPayment, debtBalanceHistory, annualSetAside, annualBillsPlan, billDueIn, findRepeating, repeatKey, monthReview, recordNetWorthMonth, hubItems, gainsLosses, itemHistory, milestones, normTag, parseTags, allTags, jobLossRunway, iessUnemployment, loanPayment, cardPayoff, growthValue, monthlyToReach, nextMoves, retirementGap, healthScore, budgetCoach, insuranceCheck, collegePlan, receivedIncome, otherIncome, monthBudget, annualBudget,
        polizaInterest, polizasCapital, maturityStatus, cosedeCheck, projectDPF, balanceAtYear, incomeExpenseSeries,
        monthsElapsed, categorySpend, categoryTarget, spendStatus, budgetVsActualByMonth, filterTransactions, transactionTrend,
        guessDebtKind, debtPayoff, addMonths, goalMonths,
        frenchPayment, amortization, amortizationByYear, yearMarks, chartAxis, sampleSchedule,
        BUCKETS, bucketOf, budgetBuckets, dailySpend, monthlyByKey,
        futureValue, pension, iessPensionAge, retirement, DEFAULT_INFLATION, DEFAULT_RETURN,
        netWorthSource, netWorthYears, netWorthFromSources, netWorthField, netWorthSnapshot, assetValue, assetOwned, assetsByCategory, netWorth,
        emergencyFund, babySteps
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    else root.Engine = Engine;
})(this);
