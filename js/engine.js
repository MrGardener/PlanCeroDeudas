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
    function payrollUS(yd, states) {
        const t = yd.usTax || {};
        const status = ['single', 'mfj', 'hoh'].includes(yd.filingStatus) ? yd.filingStatus : 'single';
        const sueldo = Math.max(0, num(yd.sueldo));
        const gross = sueldo * 12;
        const ded = (yd.payDeductions || []).filter(d => d.pretax && d.group !== 'employer');
        const pretaxRetire = sum(ded.filter(d => d.group === 'retirement' && d.kind !== 'hsa'), d => num(d.monthly)) * 12;
        const pretax125 = sum(ded.filter(d => !(d.group === 'retirement' && d.kind !== 'hsa')), d => num(d.monthly)) * 12;
        const incomeWages = Math.max(0, gross - pretaxRetire - pretax125);
        const ficaWages = Math.max(0, gross - pretax125);
        // Federal income tax
        const std = num((t.stdDeduction || {})[status]);
        const dedApplied = Math.max(std, num(yd.itemized));
        const taxable = Math.max(0, incomeWages - dedApplied);
        // Child / other-dependent credits phase out: $50 less per $1,000 (or part) of income above
        // $200,000 ($400,000 married filing jointly) — IRC §24(b).
        const baseCredits = num(yd.dependents) * num(t.childCredit) + num(yd.otherDependents) * num(t.otherDependentCredit);
        const phaseStart = num((t.ctcPhaseoutStart || { single: 200000, mfj: 400000, hoh: 200000 })[status]);
        const credits = Math.max(0, baseCredits - Math.ceil(Math.max(0, incomeWages - phaseStart) / 1000) * (num(t.ctcPhaseoutStep) || 50));
        const fedAnnual = Math.max(0, bracketTax(taxable, (t.brackets || {})[status]) - credits);
        // FICA
        const ssAnnual = Math.min(ficaWages, num(t.ssWageBase) || Infinity) * num(t.ssRate) / 100;
        // Employers withhold the extra 0.9% Medicare on wages above $200,000 whatever the filing
        // status (the yearly liability threshold differs; it's settled on the tax return).
        const medAnnual = ficaWages * num(t.medicareRate) / 100 + Math.max(0, ficaWages - (num(t.addlMedicareWithholding) || 200000)) * num(t.addlMedicareRate) / 100;
        // State (flat or a rate you enter) and city
        const st = Object.assign({}, US_STATE_DEFAULT, (states || []).find(x => x.code === yd.state) || {});
        const people = 1 + (status === 'mfj' ? 1 : 0) + num(yd.dependents) + num(yd.otherDependents);
        const stateRate = yd.stateRate !== null && yd.stateRate !== undefined && yd.stateRate !== '' ? num(yd.stateRate) : (st.type === 'none' ? 0 : num(st.rate));
        // Some states (Pennsylvania) tax 401(k) deferrals.
        const stateWages = st.taxes401k ? incomeWages + pretaxRetire : incomeWages;
        const stateAnnual = st.type === 'none' && (yd.stateRate === null || yd.stateRate === undefined || yd.stateRate === '') ? 0 : Math.max(0, stateWages - num(st.exemption) * people) * stateRate / 100;
        // City tax (Michigan's Uniform City Income Tax): on Medicare wages (401(k) deferrals
        // included, section-125 benefits not), after the city's exemption per person; people who
        // only work in the city pay the non-resident rate (half).
        const local = localTax(yd, people);
        const localAnnual = Math.max(0, ficaWages - local.exemption * people) * local.rate / 100;
        const incomeTaxAnnual = fedAnnual + stateAnnual + localAnnual;
        const ficaM = (ssAnnual + medAnnual) / 12;
        const netoAntesM = Math.max(0, sueldo - ficaM - incomeTaxAnnual / 12);
        const otros = payDeductionsSummary(yd).taken;
        return {
            country: 'US', sueldo, sueldoAnual: gross, status,
            iessM: ficaM, iessAnual: ssAnnual + medAnnual, ssM: ssAnnual / 12, medM: medAnnual / 12,
            fedM: fedAnnual / 12, stateM: stateAnnual / 12, localM: localAnnual / 12, localRate: local.rate, localResident: local.resident, stateRate, stateType: st.type,
            pretaxM: (pretaxRetire + pretax125) / 12, stdDeduction: std, credits,
            sriCap: 0, deductibles: { prep: 0, real: 0 }, dedApplied, baseImponible: taxable,
            isrAnual: incomeTaxAnnual, isrM: incomeTaxAnnual / 12,
            netoAntesM, otrosDescuentosM: otros, netoM: Math.max(0, netoAntesM - otros)
        };
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
            // A split transaction puts parts of its amount on several lines; whatever isn't
            // split follows the usual rule below.
            let rest = num(t.amount);
            (Array.isArray(t.splits) ? t.splits : []).forEach(sp => {
                const k = sp && byLine[String(sp.line)] ? String(sp.line) : null;
                const a = Math.min(rest, Math.max(0, num(sp && sp.amount)));
                if (!k || a <= 0) return;
                byLine[k].spent += a;
                if (!byLine[k].txns.includes(t)) byLine[k].txns.push(t);
                rest -= a;
            });
            if (rest <= 0.005) return;
            const explicit = t.budgetLine !== undefined && t.budgetLine !== null && t.budgetLine !== '' && byLine[String(t.budgetLine)] ? String(t.budgetLine) : null;
            const key = explicit || firstByCat[t.parentCategory] || null;
            if (!key) { unassigned.push(rest === num(t.amount) ? t : Object.assign({}, t, { amount: rest })); return; }
            byLine[key].spent += rest;
            if (!byLine[key].txns.includes(t)) byLine[key].txns.push(t);
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
            if (rec.frequency === 'weekly') { d = new Date(start); d.setDate(start.getDate() + 7 * i); }
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
            const history = [];   // total owed after each month
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
                history.push(sum(items, d => d.balance));
            }
            items.forEach((d, idx) => { d.order = idx + 1; });
            return { items, months: month, totalInterest, history, never: month >= MAX && items.some(d => d.balance > 0.01) };
        }
        const plan = run('plan');
        const minimums = run('minimums');
        const pool = extra0 + sum(open, line);
        return {
            items: plan.items,
            history: plan.history,
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
        const edadActual = Math.max(0, Math.round(num(inp.edadActual)));
        const edadJubilacion = Math.max(edadActual, Math.round(num(inp.edadJubilacion)) || 65);
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
        let pensionM, pensionDesde;
        if (inp.country === 'US') {
            // Social Security can't start before 62; claiming later raises it (up to 70).
            pensionDesde = Math.min(70, Math.max(62, edadJubilacion));
            pensionM = socialSecurity({ ...inp, aniosRestantes: anios, edadJubilacion: pensionDesde });
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
            valorFuturo, valorFuturoHoy, ingresoAhorro, pension: pensionM, pensionDesde,
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
            { n: 1, title: 'Fondo de Emergencia Inicial', done: liquid >= 1000, detail: `${Math.min(100, liquid / 10).toFixed(0)}% de ${money(1000)}` },
            { n: 2, title: 'Pagar Deudas de Consumo', done: consumerDebt <= 0.01, detail: consumerDebt > 0.01 ? `Quedan ${money(consumerDebt)}` : 'Sin deudas' },
            { n: 3, title: 'Fondo de Emergencia Pleno', done: monthsCovered >= 3, detail: `${monthsCovered.toFixed(1)} de 3-6 meses` },
            { n: 4, title: 'Invertir 15% para el Retiro', done: savingsRate >= 0.15, detail: `Ahorras ${(savingsRate * 100).toFixed(0)}% de tu sueldo` },
            { n: 5, title: 'Educación de los Hijos', done: null, detail: 'Opcional — usa una Meta de ahorro' },
            // A renter hasn't "paid off the home": the step is about saving for one (or not wanting one).
            { n: 6, title: 'Pagar la Hipoteca', done: ownsHome ? mortgageBalance <= 0.01 : null, detail: mortgageBalance > 0.01 ? `Saldo ${money(mortgageBalance)}` : (ownsHome ? 'Casa pagada' : 'Sin casa propia — ahorra la entrada con una Meta') },
            { n: 7, title: 'Construir Riqueza y Dar', done: null, detail: 'Libertad financiera' }
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
    const accountTotal = (accounts, kinds) => sum((accounts || []).filter(a => (kinds === 'cash' ? isCashAccount(a) : a.kind === kinds)), a => num(a.balance));
    function cashNow(accounts, transactions, today) {
        const cash = (accounts || []).filter(isCashAccount);
        if (!cash.length) return null;
        const t = isoDate(new Date(today));
        const asOf = cash.map(a => a.updatedAt || '').sort().pop() || t;
        const base = sum(cash, a => num(a.balance));
        let adjust = 0;
        (transactions || []).forEach(x => {
            if (!x.date || x.date <= asOf || x.date > t || x.paymentType === 'Tarjeta de Crédito') return;
            adjust += (txnType(x) === 'Ingreso' ? 1 : -1) * num(x.amount);
        });
        return { base, adjust, total: base + adjust, asOf, accounts: cash.length };
    }

    // Money that will leave or arrive on known dates between `from` and `to` (ISO):
    // bills (budget lines with a due day: what's still unpaid), repeating/scheduled
    // transactions, and paydays (net salary split between them).
    // months: [{ year, month, items, spend }] covering the range (current month may include
    // overdue unpaid bills, dated before `from`).
    function cashEvents({ from, to, months, recurring, paydays, schedule, payPerMonth = 0, payBase }) {
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
        return out.sort((a, b) => a.date.localeCompare(b.date) || a.amount - b.amount);
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
        take('free', 'Dinero sin asignar', 'free', num(free));
        const own = (items || []).find(i => String(i.id) === String(lineId));
        if (own && !isSavingsItem(own)) take(String(own.id), own.name, 'own', left(own));
        (items || []).filter(i => i.type === 'Gasto Variable' && i !== own).sort((a, b) => left(b) - left(a))
            .forEach(i => take(String(i.id), i.name, 'variable', left(i)));
        take('sweep', 'Sobrante del mes (ahorro)', 'savings', num(sweep));
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
        occurrences, dueOccurrences, nextOccurrence, monthlyCost, normalizeSchedule, payDates, paymentsPerYear, nominalPaymentsPerYear,
        savingsPurpose, savingsPools, SAVINGS_PURPOSES, pitiMonthly, isCashAccount, accountTotal, cashNow, cashEvents, safeToSpend, cashForecast, starveLines, projectFlows, projectBalances,
        loggingStreak, netWorthPath, goalSchedule, monthSpendCurve, categoryBreakdown, cashFlow, nextPayday, dailyAllowance, monthInsights, memberTotals,
        holdingValue, holdingsValue, lineSpend, periodStart, shiftPeriod, periodSeries, billsDue, overspendRisk, isoDate,
        DEDUCTION_GROUPS, COMPUTED_KINDS, payDeductionsSummary, bracketTax, payrollUS, localTax, CARGAS_CANASTAS, socialSecurity, incomeTax, sriCap, payroll, d4Month, bonusForMonth, PAYROLL_SUBCATEGORIES, isPayrollTxn, receivedIncome, otherIncome, monthBudget, annualBudget,
        polizaInterest, polizasCapital, maturityStatus, cosedeCheck, projectDPF, balanceAtYear, incomeExpenseSeries,
        monthsElapsed, categorySpend, categoryTarget, spendStatus, budgetVsActualByMonth, filterTransactions, transactionTrend,
        guessDebtKind, debtPayoff, addMonths, goalMonths,
        frenchPayment, amortization, yearMarks, chartAxis, sampleSchedule,
        futureValue, pension, iessPensionAge, retirement, DEFAULT_INFLATION, DEFAULT_RETURN,
        netWorthSource, netWorthYears, netWorthFromSources, netWorthField, netWorthSnapshot, assetValue, assetOwned, assetsByCategory, netWorth,
        emergencyFund, babySteps
    };

    if (typeof module !== 'undefined' && module.exports) module.exports = Engine;
    else root.Engine = Engine;
})(this);
