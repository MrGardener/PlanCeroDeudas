/*
 * Sample — the "Explore the example" household: a complete, realistic saved state for each
 * edition, so every feature shows real-looking numbers before the person types anything.
 *
 *   Sample.build('US' | 'EC', today) → a full version-8 state (the same shape as newState()).
 *
 * This file is DATA: names, stores, descriptions and budget line names are the example
 * family's own words (English for the US family, Spanish for the Ecuador family); category
 * and type names are the app's internal codes. Nothing here is UI text.
 *
 * The output is deterministic: a small seeded random generator (mulberry32) seeded with the
 * edition and `today`'s date, so the same day always gives the same family.
 *
 * How the numbers fit together
 *  - Each configured year has a zero-based budget: the net pay (Engine.payroll) plus the
 *    spouse's planned income, minus every line, minus the debt and goal lines the app derives
 *    (Store.linkedRows), leaves less than a dollar; whatever is left over after the household's
 *    lines goes to a "debt snowball (extra)" line.
 *  - Money that arrives outside the plan (a tax refund, a side gig, the Ecuadorian décimos) gets
 *    "a job" in that month's own budget (yd.monthOverrides), so every month still balances.
 *  - Transactions cover January of last year (at least 13 whole months) up to `today`. Each budget line produces spending
 *    near its amount (with noise), on top of a seasonal model per edition: heating and AC bills,
 *    holidays, birthdays, school start, a summer trip, car repairs… so some months run over
 *    (December, the vacation month) and others under, never wildly off.
 *  - Accounts, CDs/DPF, holdings and debts are as of `today`, and this year's net worth is
 *    exactly what they add up to; earlier years carry a plausible trajectory for the chart.
 */
(function (root) {
    'use strict';

    const lib = (name, file) => root[name] || (typeof require !== 'undefined' ? require(file) : null);

    // ------------------------------------------------------------------ helpers
    // Seeded PRNG (mulberry32) with a string hash for the seed.
    function prng(seedText) {
        let h = 1779033703 ^ seedText.length;
        for (let i = 0; i < seedText.length; i++) { h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
        let a = h >>> 0;
        const next = () => {
            a = (a + 0x6D2B79F5) | 0;
            let t = Math.imul(a ^ (a >>> 15), 1 | a);
            t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
            return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
        };
        return {
            next,
            between: (lo, hi) => lo + (hi - lo) * next(),
            int: (lo, hi) => Math.floor(lo + (hi - lo + 1) * next()),
            pick: (list) => list[Math.floor(next() * list.length)],
            chance: (p) => next() < p,
            // Weighted pick: [[value, weight], …]
            weighted: (pairs) => { let r = next() * pairs.reduce((s, p) => s + p[1], 0); for (const [v, w] of pairs) { if ((r -= w) < 0) return v; } return pairs[pairs.length - 1][0]; }
        };
    }

    const round2 = (n) => Math.round(n * 100) / 100;
    const round5 = (n) => Math.round(n / 5) * 5;
    const pad2 = (n) => String(n).padStart(2, '0');
    const daysIn = (y, m) => new Date(y, m, 0).getDate();                 // m: 1–12
    const iso = (y, m, d) => `${y}-${pad2(m)}-${pad2(Math.min(d, daysIn(y, m)))}`;
    const isoOf = (d) => iso(d.getFullYear(), d.getMonth() + 1, d.getDate());
    const clone = (x) => JSON.parse(JSON.stringify(x));

    // The n-th weekday (0 = Sunday) of a month; n = -1 is the last one.
    function nthWeekday(y, m, weekday, n) {
        if (n === -1) { const last = daysIn(y, m); const d = new Date(y, m - 1, last); return last - ((d.getDay() - weekday + 7) % 7); }
        const first = new Date(y, m - 1, 1).getDay();
        return 1 + ((weekday - first + 7) % 7) + 7 * (n - 1);
    }
    const weekdaysOf = (y, m, weekday) => { const out = []; for (let d = nthWeekday(y, m, weekday, 1); d <= daysIn(y, m); d += 7) out.push(d); return out; };

    // Easter Sunday (Gregorian computus) → { m, d }. Carnaval and Semana Santa hang off it.
    function easter(y) {
        const a = y % 19, b = Math.floor(y / 100), c = y % 100, d = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
        const h = (19 * a + b - d - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, mm = Math.floor((a + 11 * h + 22 * l) / 451);
        const month = Math.floor((h + l - 7 * mm + 114) / 31), day = ((h + l - 7 * mm + 114) % 31) + 1;
        return { m: month, d: day };
    }
    const shiftDay = (y, md, days) => { const d = new Date(y, md.m - 1, md.d + days); return { m: d.getMonth() + 1, d: d.getDate() }; };

    // Balance of an amortizing loan after the payments made up to (y, m) included.
    function loanBalance(principal, ratePct, months, firstY, firstM, y, m) {
        const i = ratePct / 1200, pay = principal * i / (1 - Math.pow(1 + i, -months));
        const n = Math.max(0, Math.min(months, (y - firstY) * 12 + (m - firstM) + 1));
        let b = principal;
        for (let k = 0; k < n; k++) b = b * (1 + i) - pay;
        return Math.max(0, round2(b));
    }
    const loanPayment = (principal, ratePct, months) => round2(principal * (ratePct / 1200) / (1 - Math.pow(1 + ratePct / 1200, -months)));

    const TYPES = { F: 'Gasto Fijo', V: 'Gasto Variable', S: 'Ahorro', D: 'Deuda' };
    const DEBIT = 'Tarjeta de Débito', CREDIT = 'Tarjeta de Crédito', CASH = 'Efectivo', XFER = 'Transferencia';

    // A budget line of the household. amount: this year's; `past` (optional): the amount in the
    // years before (otherwise variable lines are ~3% cheaper per year back, fixed ones the same);
    // `from` / `until`: the years the line exists (a toddler's daycare didn't exist before the baby).
    const L = (key, name, type, amount, cat, opts = {}) => Object.assign({ key, name, type: TYPES[type], amount, cat }, opts);

    // ================================================================== US household
    // The Millers, Grand Rapids, Michigan: Mike (38, logistics analyst, paid every other Friday),
    // Sarah (36, part-time dental hygienist, plus a little photography on weekends), Emma (15)
    // and Leo (2). A home bought four years ago, a minivan loan, an old credit card balance,
    // student loans and a recent ER bill — working the debt snowball.
    function usProfile(env) {
        const { cur, prev, R } = env;
        const MIKE = 1, SARAH = 2, EMMA = 3;
        const adults = [MIKE, SARAH, SARAH, MIKE, null];
        const retail = () => R.weighted([[DEBIT, 45], [CREDIT, 42], [CASH, 8], [XFER, 5]]);
        const card = () => R.weighted([[DEBIT, 55], [CREDIT, 45]]);
        const houseYear = cur - 4;
        const loan = { amount: 272000, rate: 6.25, months: 360, firstY: houseYear, firstM: 9 };
        const pi = loanPayment(loan.amount, loan.rate, loan.months);
        const escrow = { tax: 4260, ins: 1380 };
        const piti = round2(pi + escrow.tax / 12 + escrow.ins / 12);
        // The ER visit that became a payment plan: four months before today.
        const er = new Date(env.T.getFullYear(), env.T.getMonth() - 4, 9);
        const erY = er.getFullYear(), erM = er.getMonth() + 1;

        const lines = [
            L('giving', 'Church giving', 'V', 220, 'Regalos, Celebraciones y Donaciones'),
            L('mortgage', 'Mortgage (PITI)', 'F', piti, 'Vivienda', { dueDay: 1, bill: { day: 1, store: 'Rocket Mortgage', desc: 'Mortgage payment', sub: 'Hipoteca', pay: XFER, member: MIKE, rec: 'mortgage' } }),
            L('home', 'Home maintenance', 'V', 80, 'Vivienda'),
            L('electric', 'Electric – Consumers Energy', 'F', 115, 'Servicios Básicos y Comunicación', { bill: { day: 18, store: 'Consumers Energy', desc: 'Electric bill', sub: 'Energía Eléctrica', pay: XFER, season: [0.9, 0.85, 0.85, 0.8, 0.9, 1.25, 1.45, 1.4, 1.05, 0.85, 0.9, 1.0], noise: 0.05 } }),
            L('heat', 'Gas heat – DTE', 'F', 80, 'Servicios Básicos y Comunicación', { bill: { day: 21, store: 'DTE Energy', desc: 'Natural gas bill', sub: 'Gas', pay: XFER, season: [2.0, 1.85, 1.45, 0.95, 0.55, 0.35, 0.3, 0.3, 0.4, 0.7, 1.25, 1.7], noise: 0.06 } }),
            L('water', 'Water & sewer', 'F', 70, 'Servicios Básicos y Comunicación', { bill: { day: 25, store: 'City of Grand Rapids', desc: 'Water & sewer bill', sub: 'Agua', pay: XFER, season: [0.9, 0.9, 0.9, 0.95, 1.0, 1.15, 1.25, 1.2, 1.0, 0.95, 0.9, 0.9], noise: 0.04 } }),
            L('internet', 'Internet – Xfinity', 'F', 80, 'Servicios Básicos y Comunicación', { dueDay: 9, bill: { day: 9, store: 'Xfinity', desc: 'Internet', sub: 'Internet', pay: CREDIT } }),
            L('phones', 'Phones – Verizon (3 lines)', 'F', 140, 'Servicios Básicos y Comunicación', { dueDay: 14, bill: { day: 14, store: 'Verizon', desc: 'Cell phones (3 lines)', sub: 'Plan Celular', pay: CREDIT } }),
            L('groceries', 'Groceries', 'V', 1000, 'Alimentación'),
            L('eatingOut', 'Restaurants & takeout', 'V', 170, 'Alimentación'),
            L('fuel', 'Gas & fuel', 'V', 240, 'Transporte'),
            L('carIns', 'Car insurance (2 cars)', 'F', 188, 'Transporte', { dueDay: 3, bill: { day: 3, store: 'Auto-Owners Insurance', desc: 'Car insurance', sub: 'Seguro Vehicular', pay: XFER } }),
            L('carCare', 'Car maintenance & registration', 'V', 60, 'Transporte'),
            L('daycare', 'Daycare – Leo (3 days/week)', 'F', 640, 'Familia e Hijos', { dueDay: 1, from: cur - 1, bill: { day: 1, store: 'Little Sprouts Learning Center', desc: 'Daycare tuition', sub: 'Guardería/Niñera', pay: XFER, member: SARAH } }),
            L('kids', 'Kids activities (piano, soccer)', 'V', 130, 'Familia e Hijos', { from: cur - 4 }),
            L('baby', 'Diapers & baby stuff', 'V', 60, 'Familia e Hijos', { from: cur - 2 }),
            L('school', 'School fees & lunches', 'V', 45, 'Educación'),
            L('health', 'Copays & prescriptions', 'V', 105, 'Salud'),
            L('life', 'Term life insurance', 'F', 45, 'Seguros y Protección', { dueDay: 15, bill: { day: 15, store: 'Northwestern Mutual', desc: 'Term life premium', sub: 'Seguro de Vida', pay: XFER, rec: 'life' } }),
            L('clothing', 'Clothing', 'V', 105, 'Vestimenta'),
            L('personal', 'Haircuts & personal care', 'V', 60, 'Cuidado Personal'),
            L('fun', 'Fun money & outings', 'V', 90, 'Entretenimiento y Ocio'),
            L('subs', 'Streaming & apps', 'V', 55, 'Suscripciones y Entretenimiento Digital'),
            L('pet', 'Biscuit (dog)', 'V', 60, 'Mascotas'),
            L('gifts', 'Gifts & Christmas', 'V', 100, 'Regalos, Celebraciones y Donaciones'),
            L('family', 'Help for Mom', 'F', 50, 'Remesas y Ayuda Familiar', { from: cur - 2 }),
            L('finance', 'Bank fees & tax prep', 'V', 25, 'Financiero y Legal'),
            L('sideGig', 'Photography gig costs', 'V', 30, 'Negocio Propio / Freelance', { from: cur - 2 }),
            L('travel', 'Travel & day trips', 'V', 60, 'Viajes y Vacaciones'),
            L('misc', 'Miscellaneous', 'V', 35, 'Otros'),
            L('roth', "Sarah's Roth IRA", 'S', 150, 'Ahorro e Inversión', { from: cur - 3 }),
            // Before the baby and the minivan, what was left went to savings (see `surplus`).
            L('savings', 'High-yield savings', 'S', 0, 'Ahorro e Inversión', { until: prev - 1 })
        ];

        const debts = [
            { key: 'car', name: 'Car loan – Honda Odyssey', kind: 'vehicular', balance: 17840, originalBalance: 27500, rate: 6.9, minPayment: 468, monthly: 468, dueDay: 12, createdYear: cur - 2, lender: 'Lake Michigan Credit Union', payDesc: 'Car loan payment', sub: 'Préstamo Vehicular' },
            { key: 'card', name: 'Credit card – Chase Freedom', kind: 'tarjeta', balance: 4795.62, originalBalance: 8900, rate: 23.9, minPayment: 145, monthly: 145, dueDay: 22, createdYear: cur - 3, lender: 'Chase', payDesc: 'Credit card payment', sub: 'Tarjeta de Crédito' },
            { key: 'student', name: 'Student loans (Mike)', kind: 'estudiantil', balance: 21960, originalBalance: 31000, rate: 5.5, minPayment: 240, monthly: 240, dueDay: 5, createdYear: cur - 4, lender: 'Nelnet', payDesc: 'Student loan payment', sub: 'Préstamo Estudiantil' },
            { key: 'medical', name: 'Spectrum Health ER bill', kind: 'otra', balance: 1100, originalBalance: 1400, rate: 0, minPayment: 75, monthly: 75, dueDay: 16, createdYear: erY, start: [erY, erM + 1], lender: 'Spectrum Health', payDesc: 'ER bill – payment plan', sub: 'Préstamo Personal' }
        ];
        // Snowball: the smallest balance first — the ER bill once it exists, the card before.
        const snowballTarget = (y, m) => ((y * 12 + m) > (erY * 12 + erM) ? 'medical' : 'card');

        const goals = [
            { key: 'ef', name: 'Emergency Fund (3–6 months)', target: 30000, current: 4000, monthly: 100, rate: 4.0, targetDate: `${cur + 3}-06`, sub: 'Fondo de Emergencia', store: 'Ally Bank', desc: 'Transfer to emergency fund' },
            { key: 'vacation', name: 'Family vacation – Traverse City', target: 2600, current: 1450, monthly: 125, rate: 4.0, targetDate: `${env.T.getMonth() + 1 >= 7 ? cur + 1 : cur}-07`, sub: 'Aporte a Metas', store: 'Ally Bank', desc: 'Vacation fund' },
            { key: 'car', name: 'Replace the Corolla', target: 12000, current: 2600, monthly: 75, rate: 4.0, targetDate: `${cur + 3}-09`, sub: 'Aporte a Metas', store: 'Ally Bank', desc: 'Car replacement fund' },
            { key: 'college', name: "Emma's college (MESP 529)", target: 40000, current: 9800, monthly: 100, rate: 4.0, targetDate: `${cur + 3}-08`, sub: 'Plan 529 (universidad)', store: 'Michigan Education Savings Program', desc: '529 contribution' }
        ];

        // Paycheck: gross salary per month and what the employer takes (per month).
        const salary = (y) => (y >= cur ? 8200 : round5(8200 * Math.pow(0.97, cur - y) / 5) * 5);
        const yearFields = (y) => {
            const s = salary(y);
            return {
                sueldo: s, tasa: 4.0, filingStatus: 'mfj', dependents: y >= cur - 2 ? 2 : 1, otherDependents: 0, state: 'MI', localName: 'Grand Rapids', localResident: true,
                otherIncomes: [{ id: 1, name: "Sarah's part-time job", amount: y >= cur ? 1900 : round5(1900 * Math.pow(0.975, cur - y)), category: 'Ingresos Laborales' }],
                payDeductions: [
                    { id: 1, name: '401(k) 6%', group: 'retirement', kind: 'retirement', pretax: true, monthly: round2(s * 0.06) },
                    { id: 2, name: 'Medical (family HDHP)', group: 'insurance', kind: 'health', pretax: true, monthly: y >= cur ? 465 : 440 },
                    { id: 3, name: 'Dental', group: 'insurance', kind: 'dental', pretax: true, monthly: 48 },
                    { id: 4, name: 'Vision', group: 'insurance', kind: 'vision', pretax: true, monthly: 12 },
                    { id: 5, name: 'HSA', group: 'retirement', kind: 'hsa', pretax: true, monthly: 150 },
                    { id: 6, name: '401(k) employer match 4%', group: 'employer', kind: 'retirement', pretax: false, monthly: round2(s * 0.04) }
                ]
            };
        };

        // Net worth at the end of each past year (this year comes from the accounts and debts).
        const pastNetWorth = (y) => {
            const k = cur - y;   // 1 = last year
            return {
                checking: [0, 2640, 2210, 1980, 1650][k] || 1500,
                savings: [0, 4100, 2600, 1200, 600][k] || 500,
                investments: [0, 141500, 112300, 87600, 71900][k] || 70000,
                mortgage: loanBalance(loan.amount, loan.rate, loan.months, loan.firstY, loan.firstM, y, 12),
                autoLoans: y >= cur - 2 ? round5(loanBalance(27500, 6.9, 72, cur - 2, 4, y, 12)) : 0,
                creditCards: [0, 6980, 8650, 8900, 3100][k] || 0,
                personalLoans: 0,
                studentLoans: [0, 24700, 27300, 29800, 32100][k] || 33000,
                otherDebts: y >= erY ? 1325 : 0
            };
        };

        const accounts = [
            { id: 1, name: 'LMCU Checking', kind: 'corriente', balance: 1846.55, plusBills: true },
            { id: 2, name: 'Ally High-Yield Savings', kind: 'ahorros', balance: 6520.18 },
            { id: 3, name: 'Cash (wallet)', kind: 'efectivo', balance: 86 },
            { id: 4, name: "Mike's 401(k) – Fidelity", kind: 'retiro', balance: 118240.77 },
            { id: 5, name: "Sarah's Roth IRA – Vanguard", kind: 'retiro', balance: 31085.4 },
            { id: 6, name: 'HSA – HealthEquity', kind: 'retiro', balance: 4210.32 }
        ];
        const holdings = [
            { id: 1, ticker: 'VTI', name: 'Vanguard Total Stock Market ETF', kind: 'ETF', shares: 24, price: 318.42 },
            { id: 2, ticker: 'VXUS', name: 'Vanguard Total International Stock ETF', kind: 'ETF', shares: 61, price: 71.15 },
            { id: 3, ticker: 'BND', name: 'Vanguard Total Bond Market ETF', kind: 'ETF', shares: 28, price: 73.86 }
        ];
        const polizas = [
            { coopName: 'Ally Bank', number: 'CD-40217', amount: 5000, rate: 4.0, days: 365, modality: 'Al Vencimiento (Simple)', matureIn: 152 },
            { coopName: 'Lake Michigan Credit Union', number: 'CD-11873', amount: 3000, rate: 3.8, days: 182, modality: 'Mensual (Compuesto)', matureIn: 47 }
        ];
        const assets = [
            { name: 'Home – Grand Rapids', category: 'Bienes Raíces', purchaseYear: houseYear, purchaseValue: 340000, values: { [prev]: 356000, [cur]: 365000 } },
            { name: '2019 Honda Odyssey', category: 'Vehículo', purchaseYear: cur - 2, purchaseValue: 29500, values: { [prev]: 25800, [cur]: 22900 } },
            { name: '2014 Toyota Corolla', category: 'Vehículo', purchaseYear: houseYear, purchaseValue: 9800, values: { [prev]: 7400, [cur]: 6500 } }
        ];

        const rules = [
            { contains: 'MEIJER', category: 'Alimentación', sub: 'Mercado/Supermercado', line: 'groceries' },
            { contains: 'SPEEDWAY', category: 'Transporte', sub: 'Gasolina/Diesel', line: 'fuel', rename: 'Gas – Speedway' },
            { contains: 'NETFLIX', category: 'Suscripciones y Entretenimiento Digital', sub: 'Streaming de Video', line: 'subs', rename: 'Netflix' },
            { contains: 'CONSUMERS ENERGY', category: 'Servicios Básicos y Comunicación', sub: 'Energía Eléctrica', line: 'electric', rename: 'Electric bill' }
        ];

        // ------------------------------------------------------------ one month of life
        function month(c) {
            const { y, m, dim } = c;
            const summer = m >= 6 && m <= 8, school = m <= 6 || m >= 9;

            // Paychecks every other Friday; Sarah's paycheck at the end of the month.
            c.paychecks({ store: 'Lakeshore Logistics', desc: 'Paycheck – direct deposit', member: MIKE });
            c.add({ day: 28, type: 'Ingreso', parent: 'Ingresos Laborales', sub: 'Sueldo/Salario', amount: c.plannedIncome(1), store: 'Lakeside Dental Care', desc: "Sarah's paycheck (part-time)", pay: XFER, member: SARAH, incomeId: 1, countAsExtra: true });

            // Giving: every Sunday, online; a Christmas offering in December.
            const sundays = weekdaysOf(y, m, 0);
            sundays.forEach(d => c.add({ day: d, key: 'giving', amount: round2(c.amt('giving') / sundays.length), store: 'Grace Community Church', desc: 'Sunday giving', sub: 'Diezmo/Donaciones Religiosas', pay: XFER }));
            if (m === 12) c.add({ day: 24, key: 'giving', amount: 100, store: 'Grace Community Church', desc: 'Christmas offering', sub: 'Diezmo/Donaciones Religiosas', pay: XFER });

            // Groceries: Meijer every week, a monthly Costco run, fill-ins elsewhere.
            const groc = [];
            const start = R.int(1, 4);
            for (let d = start; d <= dim; d += 7) groc.push({ day: d + R.int(0, 1), store: 'Meijer', desc: 'Weekly groceries', w: 1, member: R.pick([SARAH, SARAH, MIKE]) });
            groc.push({ store: 'Costco', desc: 'Costco stock-up', w: 2.3, member: R.pick([SARAH, MIKE]) });
            if (R.chance(0.7)) groc.push({ store: 'Kroger', desc: 'Groceries', w: 0.5, member: R.pick(adults) });
            if (R.chance(0.5)) groc.push({ store: 'Aldi', desc: 'Groceries', w: 0.45, member: SARAH });
            c.spread('groceries', c.vary('groceries', [1.0, 0.95, 0.97, 1.0, 1.0, 1.03, 1.0, 1.0, 0.98, 1.0, 1.02, 1.04]), groc, { sub: 'Mercado/Supermercado', pay: card });

            // Eating out: fast food, Panera, pizza night; Emma with her friends.
            const eat = [
                { store: 'Chick-fil-A', desc: 'Lunch', sub: 'Comida Rápida', w: 0.6, member: R.pick(adults) },
                { store: 'Panera Bread', desc: 'Lunch', sub: 'Restaurantes', w: 0.8, member: R.pick(adults) },
                { store: "Jet's Pizza", desc: 'Pizza night', sub: 'Delivery a Domicilio', w: 0.9 },
                { store: 'Chick-fil-A', desc: 'Chick-fil-A with friends', sub: 'Comida Rápida', w: 0.4, member: EMMA, pay: DEBIT }
            ];
            if (R.chance(0.6)) eat.push({ store: "Culver's", desc: 'Dinner out', sub: 'Restaurantes', w: 1.2 });
            if (R.chance(0.5)) eat.push({ store: 'Starbucks', desc: 'Coffee', sub: 'Cafetería', w: 0.25, member: SARAH });
            c.spread('eatingOut', c.vary('eatingOut', [0.9, 0.9, 1.0, 1.0, 1.05, 1.1, 1.0, 1.05, 1.0, 1.0, 0.95, 1.0]), eat, { pay: retail });

            // Fuel: five or six fill-ups; more driving in summer.
            const fills = R.int(5, 6);
            c.spread('fuel', c.vary('fuel', [0.95, 0.92, 0.97, 1.0, 1.03, 1.08, 1.08, 1.05, 1.0, 1.0, 0.97, 0.95]),
                Array.from({ length: fills }, (_, i) => ({ day: Math.max(1, Math.round((i + 0.5) * dim / fills) + R.int(-2, 2)), store: R.pick(['Speedway', 'Shell', 'Meijer Gas', 'Costco Gas']), desc: 'Gas', member: R.pick([MIKE, SARAH]) })),
                { sub: 'Gasolina/Diesel', pay: card });

            // Car care: oil changes every three months, a car wash, the plate renewal on Mike's
            // birthday month, and the bigger repairs below.
            if (m % 3 === 1) c.add({ day: R.int(5, 25), key: 'carCare', amount: R.pick([79.99, 84.99]), store: 'Valvoline Instant Oil Change', desc: 'Oil change', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: card(), member: MIKE });
            if (R.chance(0.4)) c.add({ day: R.int(1, dim), key: 'carCare', amount: 12, store: 'Moo Moo Car Wash', desc: 'Car wash', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CREDIT, member: MIKE });
            if (m === 1) c.add({ day: 27, key: 'carCare', amount: 168, store: 'Michigan Secretary of State', desc: 'Plate renewal (Odyssey)', sub: 'Matriculación/Revisión Vehicular', pay: DEBIT, member: MIKE });
            if (m === 9) c.add({ day: 22, key: 'carCare', amount: 103, store: 'Michigan Secretary of State', desc: 'Plate renewal (Corolla)', sub: 'Matriculación/Revisión Vehicular', pay: DEBIT, member: SARAH });
            if (y === cur && m === 3) c.add({ day: 17, key: 'carCare', amount: 418.6, store: 'Belle Tire', desc: 'Front brakes and rotors', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CREDIT, member: MIKE });
            if (y === prev && m === 11) c.add({ day: 8, key: 'carCare', amount: 642.35, store: 'Discount Tire', desc: 'Four new tires (Odyssey)', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CREDIT, member: MIKE });
            if (y === prev && m === 6) c.add({ day: 12, key: 'carCare', amount: 236.4, store: 'Belle Tire', desc: 'Battery and alignment', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: DEBIT, member: SARAH });
            if (R.chance(0.15)) c.add({ day: R.int(1, dim), key: 'carCare', amount: 6, store: 'Downtown parking meter', desc: 'Parking', sub: 'Parqueo', pay: CREDIT, member: MIKE });

            // Home: a hardware run most months; yard work in spring; furnace tune-up in October.
            c.spread('home', c.vary('home', [0.4, 0.4, 0.8, 1.7, 1.8, 1.3, 0.9, 0.8, 0.9, 0.7, 0.6, 0.5]),
                [{ store: R.pick(['Home Depot', "Lowe's", 'Home Depot']), desc: R.pick(['Home supplies', 'Light bulbs & filters', 'Hardware']), sub: 'Mantenimiento del Hogar', w: 1 }].concat(m >= 4 && m <= 6 ? [{ store: 'Home Depot', desc: R.pick(['Mulch & plants', 'Lawn fertilizer', 'Garden soil']), sub: 'Jardinería/Limpieza del Hogar', w: 1.4 }] : []),
                { pay: card, member: MIKE });
            if (m === 10) c.add({ day: 7, key: 'home', amount: 129, store: 'Grand Rapids Heating & Cooling', desc: 'Furnace tune-up', sub: 'Reparaciones (plomería, eléctrico, techo)', pay: DEBIT, member: MIKE });
            if (y === prev && m === 8) c.add({ day: 19, key: 'home', amount: 689, store: 'Best Buy', desc: 'Replacement washing machine', sub: 'Muebles y Electrodomésticos', pay: CREDIT, member: SARAH });

            // Kids: piano lessons during the school year, soccer season fees, swim lessons, diapers.
            if (c.line('kids')) {
                if (school) c.add({ day: 5, key: 'kids', amount: 100, store: 'Keys & Notes Piano Studio', desc: 'Piano lessons (Emma)', sub: 'Actividades Extracurriculares', pay: XFER, member: EMMA });
                if (m === 3 || m === 8) c.add({ day: 10, key: 'kids', amount: 165, store: 'Grand Rapids Crew Soccer Club', desc: m === 3 ? 'Spring soccer season' : 'Fall soccer season', sub: 'Actividades Extracurriculares', pay: CREDIT, member: EMMA });
                if (m === 6) c.add({ day: 14, key: 'kids', amount: 85, store: 'YMCA', desc: 'Swim lessons (Leo)', sub: 'Actividades Extracurriculares', pay: DEBIT, member: SARAH });
            }
            if (c.line('baby')) c.spread('baby', c.vary('baby'), [{ store: 'Target', desc: 'Diapers & wipes', w: 1 }, { store: 'Amazon', desc: 'Diapers (Subscribe & Save)', w: 1 }].concat(R.chance(0.35) ? [{ store: 'Target', desc: 'Toys', sub: 'Juguetes', w: 0.6 }] : []), { sub: 'Pañales y Artículos de Bebé', pay: card, member: SARAH });

            // School: lunch account during the school year; back-to-school in August.
            if (school && m !== 7) c.add({ day: R.int(2, 8), key: 'school', amount: R.pick([30, 35, 40]), store: 'MySchoolBucks', desc: 'School lunch account (Emma)', sub: 'Colegiatura/Pensión', pay: DEBIT, member: EMMA });
            if (school && R.chance(0.3)) c.add({ day: R.int(9, 25), key: 'school', amount: R.pick([12, 15, 20]), store: 'Grand Rapids Public Schools', desc: R.pick(['Field trip fee', 'Yearbook deposit', 'Club fee']), sub: 'Colegiatura/Pensión', pay: DEBIT, member: EMMA });
            if (m === 8) {
                c.add({ day: 12, key: 'school', amount: 138.42, store: 'Target', desc: 'Back-to-school supplies', sub: 'Útiles Escolares', pay: CREDIT, member: SARAH });
                c.add({ day: 20, key: 'school', amount: 85, store: 'Grand Rapids Public Schools', desc: 'Registration & activity fees', sub: 'Colegiatura/Pensión', pay: DEBIT, member: EMMA });
                c.add({ day: 16, key: 'clothing', amount: 182.6, store: 'Old Navy', desc: 'Back-to-school clothes (Emma)', sub: 'Ropa y Calzado', pay: CREDIT, member: EMMA });
                c.add({ day: 23, key: 'clothing', amount: 74.99, store: "Kohl's", desc: 'Sneakers (Emma)', sub: 'Ropa y Calzado', pay: CREDIT, member: EMMA });
                c.add({ day: 14, key: 'health', amount: 25, store: 'Spectrum Health', desc: 'Sports physical copay (Emma)', sub: 'Consultas Médicas', pay: DEBIT, member: SARAH });
            }

            // Health: prescriptions every month; doctor visits more often in winter.
            c.add({ day: R.int(3, 12), key: 'health', amount: round2(R.between(12, 36)), store: R.pick(['CVS Pharmacy', 'Walgreens']), desc: 'Prescription', sub: 'Medicinas', pay: card(), member: R.pick(adults) });
            if (R.chance(m <= 3 || m >= 11 ? 0.8 : 0.45)) c.add({ day: R.int(10, 27), key: 'health', amount: R.pick([30, 30, 40]), store: 'Spectrum Health', desc: R.pick(['Pediatrician copay (Leo)', 'Doctor visit copay', 'Urgent care copay']), sub: 'Copagos y Deducibles', pay: DEBIT, member: SARAH });
            if (m === 2 || m === 8) c.add({ day: 18, key: 'health', amount: 60, store: 'Cascade Family Dental', desc: 'Cleanings – copays', sub: 'Odontología', pay: DEBIT, member: SARAH });
            if (m === 5) c.add({ day: 9, key: 'health', amount: 89, store: 'Walmart Vision Center', desc: 'New glasses (Mike)', sub: 'Óptica', pay: CREDIT, member: MIKE });
            if (y === erY && m === erM) c.add({ day: 9, key: 'health', amount: 250, store: 'Spectrum Health', desc: 'ER visit copay (Leo, stitches)', sub: 'Copagos y Deducibles', pay: DEBIT, member: SARAH });

            // Clothing, personal care, fun.
            c.spread('clothing', c.vary('clothing', [0.8, 0.6, 0.9, 1.0, 1.0, 0.9, 0.8, 0.5, 0.9, 1.1, 1.2, 0.8]),
                [{ store: R.pick(["Kohl's", 'Old Navy', 'Target']), desc: R.pick(['Clothes', 'Kids clothes', 'Shoes']), member: R.pick([SARAH, SARAH, MIKE]) }].concat(R.chance(0.5) ? [{ store: 'Old Navy', desc: 'Clothes (Emma)', member: EMMA, w: 0.6 }] : []),
                { sub: 'Ropa y Calzado', pay: retail });
            c.spread('personal', c.vary('personal'), [
                { store: 'Great Clips', desc: 'Haircut (Mike)', sub: 'Peluquería/Barbería', member: MIKE, w: 0.5, pay: CREDIT },
                { store: R.pick(['Ulta Beauty', 'Target', 'CVS Pharmacy']), desc: R.pick(['Toiletries', 'Shampoo & skincare', 'Personal care']), sub: R.pick(['Higiene Personal', 'Cosméticos y Perfumería']), member: SARAH, w: 1 }
            ].concat(m % 2 === 0 ? [{ store: 'Salon 1 Twenty', desc: 'Haircut (Sarah)', sub: 'Peluquería/Barbería', member: SARAH, w: 1.2, pay: DEBIT }] : []), { pay: card });
            const fun = [{ store: R.pick(['Celebration Cinema', 'Celebration Cinema', 'Spare Time Bowling']), desc: R.pick(['Movie night', 'Family bowling', 'Movies']), sub: R.pick(['Cine', 'Salidas y Paseos']), w: 1 },
                { store: 'Celebration Cinema', desc: 'Movies with friends', sub: 'Cine', member: EMMA, w: 0.4, pay: DEBIT }];
            if (summer) fun.push({ store: 'John Ball Zoo', desc: 'Zoo day', sub: 'Salidas y Paseos', w: 1 });
            if (R.chance(0.4)) fun.push({ store: 'Schuler Books', desc: 'Books', sub: 'Libros', w: 0.5, member: SARAH });
            c.spread('fun', c.vary('fun', [0.8, 0.8, 0.9, 1.0, 1.0, 1.2, 1.3, 1.2, 1.0, 1.0, 0.9, 0.9]), fun, { pay: retail });

            // Subscriptions (Netflix and Spotify repeat on their own).
            c.add({ day: 7, key: 'subs', amount: 15.49, store: 'Netflix', desc: 'Netflix', sub: 'Streaming de Video', pay: CREDIT, rec: 'netflix' });
            c.add({ day: 11, key: 'subs', amount: 19.99, store: 'Spotify', desc: 'Spotify Family', sub: 'Streaming de Música', pay: CREDIT, rec: 'spotify' });
            c.add({ day: 19, key: 'subs', amount: 9.99, store: 'Disney+', desc: 'Disney+', sub: 'Streaming de Video', pay: CREDIT });
            c.add({ day: 2, key: 'subs', amount: 2.99, store: 'Apple', desc: 'iCloud+ storage', sub: 'Almacenamiento en la Nube', pay: CREDIT });
            if (m === 2) c.add({ day: 12, key: 'subs', amount: 139, store: 'Amazon', desc: 'Amazon Prime (yearly)', sub: 'Streaming de Video', pay: CREDIT });

            // The dog.
            c.add({ day: R.int(4, 9), key: 'pet', amount: round2(R.between(46, 54)), store: 'Chewy', desc: 'Dog food', sub: 'Alimento para Mascotas', pay: CREDIT });
            if (m % 2 === 1) c.add({ day: R.int(12, 24), key: 'pet', amount: 55, store: 'Muddy Paws Grooming', desc: 'Grooming (Biscuit)', sub: 'Peluquería Canina', pay: DEBIT, member: SARAH });
            if (m === 5) c.add({ day: 20, key: 'pet', amount: 234.5, store: 'Knapp Valley Veterinary', desc: 'Annual checkup & shots (Biscuit)', sub: 'Veterinario', pay: CREDIT, member: SARAH });

            // Help for Mom, bank fees, gig costs, odds and ends.
            if (c.line('family')) c.add({ day: 10, key: 'family', amount: 50, store: 'Zelle', desc: 'Help for Mom (groceries)', sub: 'Ayuda Económica a Familiares', pay: XFER, member: MIKE });
            if (R.chance(0.25)) c.add({ day: R.int(1, dim), key: 'finance', amount: 3, store: 'ATM', desc: 'Out-of-network ATM fee', sub: 'Comisiones Bancarias', pay: DEBIT, member: R.pick([MIKE, SARAH]) });
            if (m === 2) c.add({ day: 24, key: 'finance', amount: 289, store: 'H&R Block', desc: 'Tax preparation', sub: 'Preparación de Impuestos', pay: DEBIT, member: MIKE });
            if (c.line('sideGig')) {
                c.add({ day: 16, key: 'sideGig', amount: 11.99, store: 'Adobe', desc: 'Lightroom plan', sub: 'Software/Herramientas de Negocio', pay: CREDIT, member: SARAH });
                if (m === 3) c.add({ day: 3, key: 'sideGig', amount: 192, store: 'Squarespace', desc: 'Portfolio website (yearly)', sub: 'Publicidad/Marketing', pay: CREDIT, member: SARAH });
                if (R.chance(0.3)) c.add({ day: R.int(1, dim), key: 'sideGig', amount: round2(R.between(18, 45)), store: 'Amazon', desc: R.pick(['Photo backdrop', 'SD cards', 'Props for sessions']), sub: 'Insumos/Inventario', pay: CREDIT, member: SARAH });
            }
            if (R.chance(0.45)) c.add({ day: R.int(1, dim), key: 'misc', amount: round2(R.between(8, 30)), store: R.pick(['Dollar Tree', 'Amazon', 'Target']), desc: R.pick(['Odds and ends', 'Replacement charger', 'Batteries']), sub: 'Otros Gastos', pay: card() });
            if (y === prev && m === 10) c.add({ day: 14, key: 'misc', amount: 25, store: 'City of Grand Rapids', desc: 'Parking ticket', sub: 'Multas', pay: DEBIT, member: MIKE });

            // Travel: day trips in summer; the Traverse City week in July (booked in April).
            if (summer && R.chance(0.7)) c.add({ day: R.int(1, dim), key: 'fun', amount: round2(R.between(28, 55)), store: 'Holland State Park', desc: 'Beach day – parking & snacks', sub: 'Salidas y Paseos', pay: DEBIT });
            if (m === 4) c.add({ day: 8, key: 'travel', amount: 450, store: 'Vrbo', desc: 'Traverse City cabin – deposit', sub: 'Hospedaje', pay: CREDIT, member: SARAH });
            if (m === 7) {
                c.add({ day: 12, key: 'travel', amount: 780, store: 'Vrbo', desc: 'Traverse City cabin – balance', sub: 'Hospedaje', pay: CREDIT, member: SARAH });
                c.add({ day: 13, key: 'fun', amount: 25, store: 'Sleeping Bear Dunes', desc: 'National park pass', sub: 'Turismo Nacional', pay: DEBIT, member: MIKE });
                c.add({ day: 14, key: 'eatingOut', amount: 96.4, store: 'Mabel’s Restaurant', desc: 'Dinner on vacation', sub: 'Restaurantes', pay: CREDIT });
                c.add({ day: 16, key: 'eatingOut', amount: 58.75, store: 'Moomers Ice Cream', desc: 'Ice cream & lunch on vacation', sub: 'Comida Rápida', pay: DEBIT });
                c.add({ day: 15, key: 'fun', amount: 64, store: 'Grand Traverse Bay Kayaks', desc: 'Kayak rental', sub: 'Salidas y Paseos', pay: CREDIT, member: MIKE });
                c.add({ day: 13, key: 'fuel', amount: 61.2, store: 'Speedway', desc: 'Gas – drive up north', sub: 'Gasolina/Diesel', pay: CREDIT, member: MIKE });
                c.add({ day: 3, key: 'fun', amount: 42, store: 'Meijer', desc: 'Fourth of July fireworks & cookout', sub: 'Salidas y Paseos', pay: DEBIT, member: MIKE });
            }
            if (m === 9 && R.chance(0.8)) c.add({ day: 27, key: 'fun', amount: 38.5, store: "Robinette's Apple Haus", desc: 'Apple picking & donuts', sub: 'Salidas y Paseos', pay: DEBIT });

            // Celebrations: Valentine's, Easter, both kids' birthdays, Mother's and Father's Day,
            // Halloween, Thanksgiving, Black Friday and Christmas.
            const ea = easter(y), goodFriday = shiftDay(y, ea, -2);
            if (m === 2) { c.add({ day: 14, key: 'eatingOut', amount: 86.3, store: 'Olive Garden', desc: "Valentine's dinner", sub: 'Restaurantes', pay: CREDIT, member: MIKE }); c.add({ day: 13, key: 'gifts', amount: 29.99, store: 'Meijer', desc: "Valentine's flowers", sub: 'Fiestas/Celebraciones', pay: DEBIT, member: MIKE }); }
            if (m === ea.m) { c.add({ day: Math.max(1, ea.d - 3), key: 'gifts', amount: 46.2, store: 'Target', desc: 'Easter baskets', sub: 'Fiestas/Celebraciones', pay: CREDIT, member: SARAH }); c.add({ day: goodFriday.m === m ? goodFriday.d : ea.d, key: 'groceries', amount: 41.8, store: 'Meijer', desc: 'Easter ham & sides', sub: 'Mercado/Supermercado', pay: DEBIT, member: SARAH }); }
            if (m === 4) { c.add({ day: 12, key: 'gifts', amount: 79.99, store: 'Amazon', desc: "Emma's birthday present", sub: 'Regalos de Cumpleaños', pay: CREDIT, member: SARAH }); c.add({ day: 14, key: 'eatingOut', amount: 72.4, store: 'Olive Garden', desc: "Emma's birthday dinner", sub: 'Restaurantes', pay: CREDIT }); }
            if (m === 5) { const md = nthWeekday(y, 5, 0, 2); c.add({ day: md - 1, key: 'gifts', amount: 38.5, store: 'Eastern Floral', desc: "Mother's Day flowers", sub: 'Fiestas/Celebraciones', pay: CREDIT, member: MIKE }); c.add({ day: md, key: 'eatingOut', amount: 64.2, store: 'Wolfgang’s Restaurant', desc: "Mother's Day brunch", sub: 'Restaurantes', pay: CREDIT, member: MIKE }); }
            if (m === 6) {
                c.add({ day: 6, key: 'gifts', amount: 118.6, store: 'Meijer', desc: "Leo's birthday party (cake, balloons)", sub: 'Fiestas/Celebraciones', pay: DEBIT, member: SARAH });
                c.add({ day: 4, key: 'gifts', amount: 44.99, store: 'Target', desc: "Leo's birthday present", sub: 'Regalos de Cumpleaños', pay: CREDIT, member: SARAH });
                c.add({ day: nthWeekday(y, 6, 0, 3) - 2, key: 'gifts', amount: 59.99, store: 'Home Depot', desc: "Father's Day gift (drill set)", sub: 'Fiestas/Celebraciones', pay: CREDIT, member: SARAH });
            }
            if (m === 9) c.add({ day: 20, key: 'gifts', amount: 65, store: 'Amazon', desc: "Sarah's birthday present", sub: 'Regalos de Cumpleaños', pay: CREDIT, member: MIKE });
            if (m === 1) c.add({ day: 25, key: 'gifts', amount: 55, store: 'Amazon', desc: "Mike's birthday present", sub: 'Regalos de Cumpleaños', pay: CREDIT, member: SARAH });
            if (m === 10) { c.add({ day: 18, key: 'gifts', amount: 54.7, store: 'Target', desc: 'Halloween costumes', sub: 'Fiestas/Celebraciones', pay: CREDIT, member: SARAH }); c.add({ day: 28, key: 'gifts', amount: 31.96, store: 'Meijer', desc: 'Halloween candy', sub: 'Fiestas/Celebraciones', pay: DEBIT }); c.add({ day: 12, key: 'fun', amount: 30, store: 'Post Family Farm', desc: 'Pumpkin patch', sub: 'Salidas y Paseos', pay: DEBIT }); }
            if (m === 11) {
                const tg = nthWeekday(y, 11, 4, 4);
                c.add({ day: tg - 2, key: 'groceries', amount: 164.3, store: 'Meijer', desc: 'Thanksgiving groceries (turkey & sides)', sub: 'Mercado/Supermercado', pay: DEBIT, member: SARAH });
                c.add({ day: tg + 1, key: 'gifts', amount: 312.45, store: 'Target', desc: 'Black Friday – Christmas gifts', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: SARAH });
                c.add({ day: tg + 4, key: 'gifts', amount: 168.9, store: 'Amazon', desc: 'Cyber Monday – Christmas gifts', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: MIKE });
            }
            if (m === 12) {
                c.add({ day: 2, key: 'gifts', amount: 65, store: "Hillside Tree Farm", desc: 'Christmas tree', sub: 'Fiestas/Celebraciones', pay: CASH, member: MIKE });
                c.add({ day: 9, key: 'gifts', amount: 214.8, store: 'Amazon', desc: 'Christmas gifts', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: SARAH });
                c.add({ day: 14, key: 'gifts', amount: 126.4, store: "Kohl's", desc: 'Christmas gifts', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: SARAH });
                c.add({ day: 18, key: 'gifts', amount: 89.97, store: 'Target', desc: 'Stocking stuffers & wrapping', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: DEBIT, member: MIKE });
                c.add({ day: 23, key: 'groceries', amount: 118.6, store: 'Meijer', desc: 'Christmas dinner groceries', sub: 'Mercado/Supermercado', pay: DEBIT, member: SARAH });
                c.add({ day: 10, key: 'clothing', amount: 42, store: 'Old Navy', desc: 'Matching Christmas pajamas', sub: 'Ropa y Calzado', pay: CREDIT, member: SARAH });
            }

            // Income outside the plan: tax refunds, photography sessions, a CD that matured, a
            // birthday check, selling the crib. Each one is routed to a line (the month's own
            // budget gives it a job), by default the debt snowball.
            if (m === 3) {
                c.add({ day: 6, type: 'Ingreso', parent: 'Gobierno y Beneficios', sub: 'Reembolso de Impuestos (IRS)', amount: y === cur ? 1842 : 1516, store: 'IRS', desc: 'Federal tax refund', pay: XFER, member: MIKE, route: 'extra' });
                c.add({ day: 19, type: 'Ingreso', parent: 'Gobierno y Beneficios', sub: 'Reembolso de Impuestos (IRS)', amount: y === cur ? 214 : 187, store: 'Michigan Treasury', desc: 'Michigan tax refund', pay: XFER, member: MIKE, route: 'extra' });
            }
            const gig = { 5: 450, 6: 300, 9: 250, 10: 350, 12: 200 }[m];
            if (gig) c.add({ day: R.int(8, 20), type: 'Ingreso', parent: 'Ingresos Independientes', sub: 'Freelance/Consultoría', amount: gig - (y === prev ? 50 : 0), store: 'Venmo', desc: R.pick(['Photo session – family portraits', 'Photo session – senior pictures', 'Photo session – mini sessions']), pay: XFER, member: SARAH, route: 'extra' });
            if (y === prev && m === 6) c.add({ day: 20, type: 'Ingreso', parent: 'Ingresos Financieros', sub: 'Intereses', amount: 96.12, store: 'Capital One', desc: 'CD matured – interest', pay: XFER, route: 'extra' });
            if (m === 12) c.add({ day: 21, type: 'Ingreso', parent: 'Otros Ingresos', sub: 'Regalos Recibidos', amount: 200, store: 'Grandma & Grandpa', desc: 'Christmas check', pay: XFER, route: 'gifts' });
            if (y === cur && m === 1) c.add({ day: 9, key: 'clothing', refund: true, amount: 42.5, store: "Kohl's", desc: 'Return – winter boots', sub: 'Ropa y Calzado', pay: CREDIT, member: SARAH });
            if (y === prev && m === 9) c.add({ day: 13, type: 'Ingreso', parent: 'Otros Ingresos', sub: 'Venta de Artículos Usados', amount: 120, store: 'Facebook Marketplace', desc: 'Sold the crib', pay: CASH, member: SARAH, route: 'extra' });
        }

        return {
            firstYear: houseYear,
            members: [{ id: MIKE, name: 'Mike', color: '#2a78d6' }, { id: SARAH, name: 'Sarah', color: '#eb6834' }, { id: EMMA, name: 'Emma', color: '#1baf7a' }],
            lines, extraLine: { name: 'Debt snowball (extra)' }, surplus: { key: 'savings', keep: 250 }, debts, goals, snowballTarget, yearFields, pastNetWorth, accounts, holdings, polizas, assets, rules, month,
            goalDay: 3, extraDay: 26,
            payDay: { freq: 'weekly', interval: 2, weekday: 5 },
            mortgage: { amount: loan.amount, rate: loan.rate, years: 30, extraPayment: 0, propertyTax: escrow.tax, homeInsurance: escrow.ins, pmiRate: 0, hoa: 0, homeValue: 365000 },
            mortgageNow: loanBalance(loan.amount, loan.rate, loan.months, loan.firstY, loan.firstM, env.T.getFullYear(), env.T.getMonth() + 1),
            retirement: { edadActual: 38, edadJubilacion: 65, aporteMensual: 150, tasaRetiroSegura: 4, aniosAportados: 16, tasaReemplazo: 40 },
            settings: { cashBuffer: 500, retireWhatIfMax: 1000, mortgageWhatIfMax: 1500 },
            recurringDefs: { mortgage: 'monthly', life: 'monthly', netflix: 'monthly', spotify: 'monthly' }
        };
    }

    // ================================================================== Ecuador household
    // La familia Andrade Torres, Quito (Sierra): Andrés (40, jefe de logística, sueldo en dos
    // quincenas), Gabriela (37, diseñadora gráfica independiente), Mateo (15) y Sofía (2).
    // Departamento con crédito hipotecario del BIESS, préstamo del carro, tarjeta de crédito y un
    // quirografario del IESS descontado del rol.
    function ecProfile(env) {
        const { cur, prev, R } = env;
        const ANDRES = 1, GABY = 2, MATEO = 3;
        const adults = [ANDRES, GABY, GABY, ANDRES, null];
        const retail = () => R.weighted([[CASH, 30], [DEBIT, 35], [CREDIT, 25], [XFER, 10]]);
        const card = () => R.weighted([[DEBIT, 55], [CREDIT, 45]]);
        const flatYear = cur - 5;
        const loan = { amount: 75000, rate: 6, months: 240, firstY: flatYear, firstM: 3 };
        const dividendo = loanPayment(loan.amount, loan.rate, loan.months);

        const lines = [
            L('hipoteca', 'Dividendo hipotecario BIESS', 'F', dividendo, 'Vivienda', { deductible: true, dueDay: 5, bill: { day: 5, store: 'BIESS', desc: 'Dividendo hipotecario', sub: 'Hipoteca', pay: XFER, member: ANDRES, rec: 'hipoteca' } }),
            L('alicuota', 'Alícuota del conjunto', 'F', 85, 'Vivienda', { deductible: true, dueDay: 10, bill: { day: 10, store: 'Administración Conjunto Los Álamos', desc: 'Alícuota mensual', sub: 'Alícuotas/Condominio', pay: XFER } }),
            L('hogar', 'Mantenimiento del hogar', 'V', 40, 'Vivienda'),
            L('luz', 'Luz (EEQ)', 'F', 42, 'Servicios Básicos y Comunicación', { bill: { day: 12, store: 'Empresa Eléctrica Quito (EEQ)', desc: 'Planilla de luz', sub: 'Energía Eléctrica', pay: XFER, season: [1.08, 0.98, 0.97, 0.97, 0.96, 0.96, 0.98, 0.98, 0.97, 0.98, 1.0, 1.17], noise: 0.05 } }),
            L('agua', 'Agua (EPMAPS)', 'F', 22, 'Servicios Básicos y Comunicación', { bill: { day: 14, store: 'EPMAPS', desc: 'Planilla de agua', sub: 'Agua', pay: XFER, season: [1, 1, 1, 1, 1, 1, 1.05, 1.05, 1.02, 0.98, 0.95, 1], noise: 0.05 } }),
            L('internet', 'Internet (CNT fibra)', 'F', 32, 'Servicios Básicos y Comunicación', { dueDay: 8, bill: { day: 8, store: 'CNT', desc: 'Internet fibra óptica', sub: 'Internet', pay: DEBIT } }),
            L('celular', 'Planes celulares (Claro)', 'F', 40, 'Servicios Básicos y Comunicación', { dueDay: 20, bill: { day: 20, store: 'Claro', desc: 'Planes pospago (2 líneas)', sub: 'Plan Celular', pay: CREDIT } }),
            L('gas', 'Gas de cocina', 'V', 6, 'Servicios Básicos y Comunicación'),
            L('super', 'Supermercado y víveres', 'V', 640, 'Alimentación', { deductible: true }),
            L('comidas', 'Comidas fuera y delivery', 'V', 110, 'Alimentación'),
            L('gasolina', 'Gasolina', 'V', 110, 'Transporte'),
            L('seguroAuto', 'Seguro del carro', 'F', 55, 'Transporte', { dueDay: 20, bill: { day: 20, store: 'Aseguradora del Sur', desc: 'Seguro vehicular (cuota)', sub: 'Seguro Vehicular', pay: CREDIT } }),
            L('movilidad', 'Mantenimiento del carro, taxis y parqueo', 'V', 45, 'Transporte'),
            // Ten pensiones (September–June): no due day, so July and August don't show as unpaid.
            L('pension', 'Pensión del colegio (Mateo)', 'F', 280, 'Educación', { deductible: true }),
            L('utiles', 'Útiles, uniformes y matrícula', 'V', 30, 'Educación', { deductible: true }),
            L('guarderia', 'Guardería (Sofía)', 'F', 220, 'Familia e Hijos', { dueDay: 5, from: cur - 1, bill: { day: 5, store: 'Guardería Pequeños Pasos', desc: 'Pensión guardería', sub: 'Guardería/Niñera', pay: XFER, member: GABY } }),
            L('bebe', 'Pañales y cosas de Sofía', 'V', 45, 'Familia e Hijos', { from: cur - 2 }),
            L('chicos', 'Fútbol de Mateo', 'V', 40, 'Familia e Hijos'),
            L('salud', 'Salud (consultas y medicinas)', 'V', 80, 'Salud', { deductible: true }),
            L('seguroVida', 'Seguro de vida', 'F', 22, 'Seguros y Protección', { dueDay: 25, bill: { day: 25, store: 'BMI Seguros', desc: 'Seguro de vida (prima mensual)', sub: 'Seguro de Vida', pay: CREDIT } }),
            L('ropa', 'Ropa y calzado', 'V', 70, 'Vestimenta', { deductible: true }),
            L('cuidado', 'Cuidado personal', 'V', 35, 'Cuidado Personal'),
            L('paseos', 'Paseos y entretenimiento', 'V', 70, 'Entretenimiento y Ocio'),
            L('suscripciones', 'Suscripciones (Netflix, Spotify)', 'V', 25, 'Suscripciones y Entretenimiento Digital'),
            L('mascota', 'Rocky (perro)', 'V', 35, 'Mascotas'),
            L('regalos', 'Regalos y celebraciones', 'V', 60, 'Regalos, Celebraciones y Donaciones'),
            L('ofrenda', 'Ofrenda y donaciones', 'V', 20, 'Regalos, Celebraciones y Donaciones'),
            L('mama', 'Ayuda a mi mamá', 'F', 60, 'Remesas y Ayuda Familiar', { dueDay: 1, bill: { day: 1, store: 'Banco Pichincha', desc: 'Transferencia a mi mamá', sub: 'Ayuda Económica a Familiares', pay: XFER, member: ANDRES, rec: 'mama' } }),
            L('tramites', 'Impuestos y trámites (predial, matrícula)', 'V', 35, 'Financiero y Legal'),
            L('negocio', 'Herramientas de trabajo (Gabriela)', 'V', 40, 'Negocio Propio / Freelance', { from: cur - 3 }),
            L('turismo', 'Turismo nacional (feriados)', 'V', 90, 'Viajes y Vacaciones', { deductible: true }),
            L('imprevistos', 'Imprevistos', 'V', 30, 'Otros'),
            L('jubilacion', 'Aporte voluntario jubilación', 'S', 80, 'Ahorro e Inversión', { from: cur - 2 }),
            L('dpf', 'Ahorro para póliza DPF', 'S', 60, 'Ahorro e Inversión')
        ];

        const debts = [
            { key: 'tarjeta', name: 'Tarjeta de crédito Visa Pichincha', kind: 'tarjeta', balance: 2386.4, originalBalance: 4100, rate: 16.5, minPayment: 95, monthly: 95, dueDay: 15, createdYear: cur - 2, lender: 'Banco Pichincha', payDesc: 'Pago tarjeta de crédito', sub: 'Tarjeta de Crédito' },
            { key: 'carro', name: 'Préstamo del carro (Kia Sportage)', kind: 'vehicular', balance: 9040, originalBalance: 20000, rate: 11, minPayment: 435, monthly: 435, dueDay: 8, createdYear: cur - 3, lender: 'Produbanco', payDesc: 'Cuota préstamo vehicular', sub: 'Préstamo Vehicular' },
            { key: 'quiro', name: 'Préstamo quirografario IESS', kind: 'personal', balance: 3980, originalBalance: 6000, rate: 9.8, minPayment: 193, monthly: 193, dueDay: 30, createdYear: cur - 1, lender: 'BIESS', payDesc: 'Cuota quirografario (rol)', sub: 'Préstamo Personal', payroll: true }
        ];
        const snowballTarget = () => 'tarjeta';

        const goals = [
            { key: 'ef', name: 'Fondo de emergencia (6 meses)', target: 15000, current: 3200, monthly: 100, rate: 8.5, targetDate: `${cur + 4}-12`, sub: 'Fondo de Emergencia', store: 'Produbanco', desc: 'Ahorro fondo de emergencia' },
            { key: 'playa', name: 'Vacaciones en Puerto López', target: 2500, current: 900, monthly: 60, rate: 8.5, targetDate: `${cur + 1}-08`, sub: 'Aporte a Metas', store: 'Produbanco', desc: 'Ahorro vacaciones' },
            { key: 'carro', name: 'Cambio del Chevrolet Spark', target: 8000, current: 1500, monthly: 50, rate: 8.5, targetDate: `${cur + 4}-06`, sub: 'Aporte a Metas', store: 'Produbanco', desc: 'Ahorro cambio de carro' },
            { key: 'uni', name: 'Universidad de Mateo', target: 12000, current: 3800, monthly: 70, rate: 8.5, targetDate: `${cur + 3}-09`, sub: 'Aporte a Metas', store: 'Cooperativa JEP', desc: 'Ahorro universidad' }
        ];

        const salary = (y) => (y >= cur ? 3400 : round5(3400 * Math.pow(0.965, cur - y) / 5) * 5);
        const yearFields = (y) => ({
            sueldo: salary(y), tasa: 8.5, d3: true, d4: true, d4Region: 'sierra', cargas: y >= cur - 2 ? 2 : 1,
            otherIncomes: [{ id: 1, name: 'Honorarios de Gabriela (diseño)', amount: y >= cur ? 1600 : round5(1600 * Math.pow(0.97, cur - y)), category: 'Ingresos Independientes' }],
            payDeductions: [
                // The quirografario is paid by the paycheck (linked to its debt: not a budget line).
                y >= cur - 1 ? { id: 1, name: 'Préstamo quirografario IESS', group: 'loan', kind: 'loan', pretax: false, monthly: 193, debtId: debts.findIndex(d => d.key === 'quiro') + 1 } : null,
                { id: 2, name: 'Seguro médico privado (familiar)', group: 'insurance', kind: 'health', pretax: true, monthly: y >= cur ? 168 : 155 }
            ].filter(Boolean)
        });

        const pastNetWorth = (y) => {
            const k = cur - y;
            return {
                checking: [0, 1210, 980, 860, 640, 500][k] || 500,
                savings: [0, 2950, 2100, 1600, 900, 700][k] || 600,
                investments: [0, 7500, 5000, 3000, 2000, 0][k] || 0,
                mortgage: loanBalance(loan.amount, loan.rate, loan.months, loan.firstY, loan.firstM, y, 12),
                autoLoans: y >= cur - 3 ? [0, 12100, 15300, 18500][k] : 0,
                creditCards: [0, 3350, 4100, 2200, 1500, 900][k] || 0,
                personalLoans: y >= cur - 1 ? 5150 : 0,
                studentLoans: 0,
                otherDebts: 0
            };
        };

        const accounts = [
            { id: 1, name: 'Banco Pichincha – cuenta corriente', kind: 'corriente', balance: 1265.6, plusBills: true },
            { id: 2, name: 'Produbanco – cuenta de ahorros', kind: 'ahorros', balance: 3812.25 },
            { id: 3, name: 'Efectivo', kind: 'efectivo', balance: 64 }
        ];
        const polizas = [
            { coopName: 'JEP (Juventud Ecuatoriana Progresista)', number: 'DPF-48213', amount: 4000, rate: 9.0, days: 361, modality: 'Al Vencimiento (Simple)', matureIn: 118 },
            { coopName: 'Jardín Azuayo', number: 'DPF-20671', amount: 2500, rate: 8.5, days: 180, modality: 'Mensual (Compuesto)', matureIn: 39 },
            { coopName: 'Cooperativa Politécnica', number: 'DPF-77305', amount: 3000, rate: 8.75, days: 270, modality: 'Mensual (Compuesto)', matureIn: 203 }
        ];
        const assets = [
            { name: 'Departamento en Quito (Norte)', category: 'Bienes Raíces', purchaseYear: flatYear, purchaseValue: 112000, values: { [prev]: 124000, [cur]: 127500 } },
            { name: 'Kia Sportage 2022', category: 'Vehículo', purchaseYear: cur - 3, purchaseValue: 27900, values: { [prev]: 21500, [cur]: 19800 } },
            { name: 'Chevrolet Spark GT 2016', category: 'Vehículo', purchaseYear: flatYear, purchaseValue: 8900, values: { [prev]: 6400, [cur]: 5900 } }
        ];
        const rules = [
            { contains: 'SUPERMAXI', category: 'Alimentación', sub: 'Mercado/Supermercado', line: 'super' },
            { contains: 'PRIMAX', category: 'Transporte', sub: 'Gasolina/Diesel', line: 'gasolina', rename: 'Gasolina Primax' },
            { contains: 'NETFLIX', category: 'Suscripciones y Entretenimiento Digital', sub: 'Streaming de Video', line: 'suscripciones', rename: 'Netflix' },
            { contains: 'EEQ', category: 'Servicios Básicos y Comunicación', sub: 'Energía Eléctrica', line: 'luz', rename: 'Planilla de luz' }
        ];

        function month(c) {
            const { y, m, dim } = c;
            const classes = m >= 9 || m <= 6;          // Sierra school year: September – June
            const ea = easter(y);

            // Quincenas (and the décimos, which the app adds to August and December by itself).
            c.paychecks({ store: 'Andina Logística S.A.', desc: 'Sueldo – quincena', member: ANDRES });
            if (m === 8) c.add({ day: 14, type: 'Ingreso', parent: 'Ingresos Laborales', sub: 'Décimo Cuarto', amount: c.year().sbu, store: 'Andina Logística S.A.', desc: 'Décimo cuarto sueldo', pay: XFER, member: ANDRES });
            if (m === 12) c.add({ day: 19, type: 'Ingreso', parent: 'Ingresos Laborales', sub: 'Décimo Tercero', amount: c.year().sueldo, store: 'Andina Logística S.A.', desc: 'Décimo tercer sueldo', pay: XFER, member: ANDRES });
            c.add({ day: 5, type: 'Ingreso', parent: 'Ingresos Independientes', sub: 'Honorarios Profesionales', amount: c.plannedIncome(1), store: 'Estudio Creativo Mitad', desc: 'Honorarios diseño gráfico (mensual)', pay: XFER, member: GABY, incomeId: 1 });

            // Groceries: Supermaxi most weeks, a big Megamaxi run, Mi Comisariato, Tía, Coral,
            // the municipal market for fruit and vegetables (cash), and the bakery.
            const sup = [];
            for (let d = R.int(1, 4); d <= dim; d += 8) sup.push({ day: d, store: 'Supermaxi', desc: 'Compras de la semana', w: 1, member: R.pick([GABY, GABY, ANDRES]) });
            sup.push({ store: 'Megamaxi', desc: 'Compra grande del mes', w: 2, member: GABY });
            sup.push({ store: R.pick(['Mi Comisariato', 'Tía', 'Coral Hipermercados']), desc: 'Víveres', w: 0.6, member: R.pick(adults) });
            sup.push({ store: R.pick(['Mercado Iñaquito', 'Mercado Santa Clara']), desc: 'Frutas y verduras', sub: 'Mercado Municipal/Ferias', pay: CASH, w: 0.5, member: GABY });
            sup.push({ store: R.pick(['Mercado Iñaquito', 'Mercado Santa Clara']), desc: 'Frutas y verduras', sub: 'Mercado Municipal/Ferias', pay: CASH, w: 0.45, member: ANDRES });
            for (let i = 0; i < 3; i++) sup.push({ store: 'Panadería La Unión', desc: 'Pan', sub: 'Panadería', pay: CASH, w: 0.05 });
            c.spread('super', c.vary('super', [1.0, 0.97, 1.0, 1.02, 1.0, 1.0, 1.0, 1.0, 0.98, 1.0, 1.0, 1.04]), sup, { sub: 'Mercado/Supermercado', pay: card });

            const eat = [
                { store: 'KFC', desc: 'Almuerzo', sub: 'Comida Rápida', w: 0.8, member: R.pick(adults) },
                { store: 'Sweet & Coffee', desc: 'Café y postre', sub: 'Cafetería', w: 0.4, member: GABY },
                { store: 'PedidosYa', desc: 'Pedido a domicilio', sub: 'Delivery a Domicilio', w: 0.8 },
                { store: 'KFC', desc: 'KFC con amigos', sub: 'Comida Rápida', w: 0.3, member: MATEO, pay: CASH },
                { store: 'Almuerzos La Casona', desc: 'Almuerzo ejecutivo', sub: 'Restaurantes', w: 0.3, member: ANDRES, pay: CASH }
            ];
            if (R.chance(0.5)) eat.push({ store: 'Menestras del Negro', desc: 'Almuerzo en familia', sub: 'Restaurantes', w: 0.9 });
            c.spread('comidas', c.vary('comidas'), eat, { pay: retail });

            // Car: four fill-ups, parking, taxis, oil changes every four months.
            const fills = 4;
            c.spread('gasolina', c.vary('gasolina', [1.0, 1.05, 1.0, 1.02, 1.0, 0.98, 1.0, 1.08, 1.0, 0.98, 1.0, 1.05]),
                Array.from({ length: fills }, (_, i) => ({ day: Math.max(1, Math.round((i + 0.5) * dim / fills) + R.int(-2, 2)), store: R.pick(['Primax', 'Primax', 'Petroecuador – gasolinera', 'Terpel']), desc: 'Gasolina extra', member: R.pick([ANDRES, ANDRES, GABY]) })),
                { sub: 'Gasolina/Diesel', pay: card });
            const mov = [{ store: 'Parqueadero Quicentro', desc: 'Parqueo', sub: 'Parqueo', pay: CASH, w: 0.2, member: ANDRES }, { store: R.pick(['DiDi', 'Uber', 'Cabify']), desc: 'Taxi por app', sub: 'Taxi/App de Transporte', w: 0.4, member: R.pick([GABY, MATEO]) }];
            if (R.chance(0.5)) mov.push({ store: 'Lubricadora El Batán', desc: 'Lavada del carro', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CASH, w: 0.2, member: ANDRES });
            c.spread('movilidad', c.vary('movilidad', [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1]) * (m % 4 === 2 ? 0.5 : 1), mov, { pay: retail });
            if (m % 4 === 2) c.add({ day: R.int(6, 24), key: 'movilidad', amount: R.pick([42, 45, 48]), store: 'Tecnicentro Valle', desc: 'Cambio de aceite y filtros', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CREDIT, member: ANDRES });
            if (y === prev && m === 10) c.add({ day: 9, key: 'movilidad', amount: 286.5, store: 'Tecnicentro Valle', desc: 'Llantas delanteras y alineación', sub: 'Mantenimiento (aceite, llantas, frenos)', pay: CREDIT, member: ANDRES });
            if (R.chance(0.25)) c.add({ day: R.int(1, dim), key: 'movilidad', amount: 0.45, store: 'Trolebús', desc: 'Pasaje', sub: 'Pasajes/Bus', pay: CASH, member: MATEO });

            // Gas cylinder, cash at the door.
            c.add({ day: R.int(3, 25), key: 'gas', amount: 3, store: 'Distribuidor de gas', desc: 'Cilindro de gas', sub: 'Gas', pay: CASH, member: GABY });
            if (R.chance(0.6)) c.add({ day: R.int(10, 28), key: 'gas', amount: 3, store: 'Distribuidor de gas', desc: 'Cilindro de gas', sub: 'Gas', pay: CASH });
            if (R.chance(0.5)) c.add({ day: R.int(1, 20), key: 'celular', amount: 5, store: 'Claro', desc: 'Recarga celular Mateo', sub: 'Plan Celular', pay: CASH, member: MATEO });

            // Home: Kywi most months; the plumber now and then.
            c.spread('hogar', c.vary('hogar', [0.8, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 1.2]), [{ store: 'Kywi', desc: R.pick(['Ferretería', 'Focos y repuestos', 'Productos de limpieza']), sub: R.pick(['Mantenimiento del Hogar', 'Jardinería/Limpieza del Hogar']), member: ANDRES }], { pay: card });
            if (R.chance(0.15)) c.add({ day: R.int(1, dim), key: 'hogar', amount: R.pick([25, 30, 40]), store: 'Gasfitero', desc: 'Arreglo de la ducha', sub: 'Reparaciones (plomería, eléctrico, techo)', pay: CASH, member: ANDRES });

            // School: pensión September–June; matrícula and útiles with the décimo cuarto in
            // August; uniforms and books when classes start in September.
            if (classes) c.add({ day: 5, key: 'pension', amount: c.amt('pension'), store: 'Unidad Educativa Alborada', desc: 'Pensión mensual (Mateo)', sub: 'Colegiatura/Pensión', pay: XFER, member: ANDRES });
            if (m === 8) {
                c.add({ day: 20, key: 'utiles', amount: 300, store: 'Unidad Educativa Alborada', desc: 'Matrícula año lectivo (Mateo)', sub: 'Colegiatura/Pensión', pay: XFER, member: ANDRES });
                c.add({ day: 24, key: 'utiles', amount: 96.4, store: 'Librería Juan Marcet', desc: 'Útiles escolares', sub: 'Útiles Escolares', pay: CREDIT, member: GABY });
            }
            if (m === 9) {
                c.add({ day: 2, key: 'utiles', amount: 112, store: 'Uniformes Alborada', desc: 'Uniformes (diario y educación física)', sub: 'Uniformes', pay: DEBIT, member: GABY });
                c.add({ day: 3, key: 'utiles', amount: 84.5, store: 'Librería Española', desc: 'Libros del año', sub: 'Libros y Material Educativo', pay: CREDIT, member: GABY });
                c.add({ day: 6, key: 'ropa', amount: 45, store: 'Marathon Sports', desc: 'Zapatos colegiales (Mateo)', sub: 'Ropa y Calzado', pay: CREDIT, member: MATEO });
            }
            if (classes && R.chance(0.3)) c.add({ day: R.int(8, 26), key: 'utiles', amount: R.pick([5, 8, 12]), store: 'Papelería Popular', desc: 'Materiales para deberes', sub: 'Útiles Escolares', pay: CASH, member: MATEO });

            // Kids and baby.
            c.add({ day: 6, key: 'chicos', amount: 35, store: 'Academia de Fútbol Liga', desc: 'Mensualidad fútbol (Mateo)', sub: 'Actividades Extracurriculares', pay: XFER, member: MATEO });
            if (c.line('bebe')) c.spread('bebe', c.vary('bebe'), [{ store: 'Fybeca', desc: 'Pañales Pampers', w: 1 }, { store: 'Supermaxi', desc: 'Pañales y toallitas', w: 0.8 }].concat(R.chance(0.3) ? [{ store: 'Juguetón', desc: 'Juguete', sub: 'Juguetes', w: 0.5 }] : []), { sub: 'Pañales y Artículos de Bebé', pay: card, member: GABY });

            // Health (the private insurance comes out of the paycheck).
            c.add({ day: R.int(2, 12), key: 'salud', amount: round2(R.between(12, 30)), store: R.pick(['Fybeca', 'Pharmacys', 'Farmacias Cruz Azul']), desc: 'Medicinas', sub: 'Medicinas', pay: card(), member: R.pick(adults) });
            if (R.chance(m >= 4 && m <= 7 ? 0.5 : 0.65)) c.add({ day: R.int(10, 26), key: 'salud', amount: R.pick([35, 40, 40]), store: R.pick(['Dra. Paredes – Pediatra', 'Hospital Metropolitano – consulta', 'Centro Médico Meditrópoli']), desc: R.pick(['Consulta pediatra (Sofía)', 'Consulta médica', 'Control médico']), sub: 'Consultas Médicas', pay: DEBIT, member: GABY });
            if (m === 3 || m === 9) c.add({ day: 17, key: 'salud', amount: 35, store: 'Dental Sonrisas', desc: 'Limpieza dental', sub: 'Odontología', pay: DEBIT, member: GABY });
            if (m === 6) c.add({ day: 11, key: 'salud', amount: 28, store: 'Laboratorio Clínico Interlab', desc: 'Exámenes de sangre', sub: 'Exámenes de Laboratorio', pay: DEBIT, member: ANDRES });

            // Clothing, personal care, outings.
            c.spread('ropa', c.vary('ropa', [1.2, 0.8, 0.9, 1.0, 1.1, 1.0, 0.8, 0.8, 0.6, 1.0, 1.0, 1.4]),
                [{ store: R.pick(['De Prati', 'Etafashion', 'RM']), desc: R.pick(['Ropa', 'Ropa para Sofía', 'Zapatos']), member: R.pick([GABY, GABY, ANDRES]) }].concat(R.chance(0.4) ? [{ store: 'Etafashion', desc: 'Ropa (Mateo)', member: MATEO, w: 0.6 }] : []),
                { sub: 'Ropa y Calzado', pay: retail });
            c.spread('cuidado', c.vary('cuidado'), [
                { store: 'Peluquería Stylos', desc: 'Corte de pelo (Andrés y Mateo)', sub: 'Peluquería/Barbería', pay: CASH, member: ANDRES, w: 0.6 },
                { store: R.pick(['Fybeca', 'Supermaxi']), desc: 'Artículos de aseo', sub: 'Higiene Personal', member: GABY, w: 1 }
            ].concat(m % 2 === 0 ? [{ store: 'Salón Glamour', desc: 'Cepillado y uñas', sub: 'Manicure/Pedicure', pay: CASH, member: GABY, w: 0.8 }] : []), { pay: card });
            c.spread('paseos', c.vary('paseos', [1.0, 0.9, 0.9, 1.0, 1.0, 1.0, 1.2, 1.2, 0.9, 1.0, 1.0, 1.0]), [
                { store: R.pick(['Cinemark', 'Supercines']), desc: 'Cine en familia', sub: 'Cine', w: 1 },
                { store: R.pick(['TelefériQo', 'Parque La Carolina – juegos', 'Mitad del Mundo']), desc: 'Paseo de fin de semana', sub: 'Salidas y Paseos', w: 0.8 },
                { store: 'Cinemark', desc: 'Cine con amigos', sub: 'Cine', member: MATEO, w: 0.3, pay: CASH }
            ], { pay: retail });

            // Subscriptions, the dog, offering, freelance tools, odds and ends.
            c.add({ day: 7, key: 'suscripciones', amount: 11.99, store: 'Netflix', desc: 'Netflix', sub: 'Streaming de Video', pay: CREDIT, rec: 'netflix' });
            c.add({ day: 12, key: 'suscripciones', amount: 9.99, store: 'Spotify', desc: 'Spotify Familiar', sub: 'Streaming de Música', pay: CREDIT, rec: 'spotify' });
            c.add({ day: 3, key: 'suscripciones', amount: 1.99, store: 'Google', desc: 'Google One', sub: 'Almacenamiento en la Nube', pay: CREDIT });
            c.add({ day: R.int(2, 10), key: 'mascota', amount: round2(R.between(26, 31)), store: 'Megamaxi', desc: 'Comida para Rocky', sub: 'Alimento para Mascotas', pay: card(), member: GABY });
            if (m === 4 || m === 10) c.add({ day: 16, key: 'mascota', amount: 35, store: 'Veterinaria Patitas', desc: 'Vacunas y desparasitación (Rocky)', sub: 'Veterinario', pay: DEBIT, member: GABY });
            else if (R.chance(0.4)) c.add({ day: R.int(12, 26), key: 'mascota', amount: 12, store: 'Veterinaria Patitas', desc: 'Baño de Rocky', sub: 'Peluquería Canina', pay: CASH });
            weekdaysOf(y, m, 0).forEach(d => c.add({ day: d, key: 'ofrenda', amount: R.pick([3, 4, 5]), store: 'Parroquia El Batán', desc: 'Ofrenda de la misa', sub: 'Diezmo/Donaciones Religiosas', pay: CASH }));
            if (m === 12) c.add({ day: 15, key: 'ofrenda', amount: 20, store: 'Fundación Banco de Alimentos Quito', desc: 'Donación navideña', sub: 'Donaciones Benéficas', pay: XFER });
            if (c.line('negocio')) {
                c.add({ day: 18, key: 'negocio', amount: 34.99, store: 'Adobe', desc: 'Adobe Creative Cloud', sub: 'Software/Herramientas de Negocio', pay: CREDIT, member: GABY });
                if (R.chance(0.4)) c.add({ day: R.int(1, dim), key: 'negocio', amount: R.pick([5, 8, 10]), store: 'Meta (Instagram)', desc: 'Publicidad en Instagram', sub: 'Publicidad/Marketing', pay: CREDIT, member: GABY });
            }
            if (R.chance(0.4)) c.add({ day: R.int(1, dim), key: 'imprevistos', amount: round2(R.between(5, 25)), store: R.pick(['Tía', 'Papelería Popular', 'Cerrajería']), desc: R.pick(['Imprevisto', 'Copia de llaves', 'Varios']), sub: 'Imprevistos', pay: CASH });
            if (y === prev && m === 7) c.add({ day: 22, key: 'imprevistos', amount: 50, store: 'AMT Quito', desc: 'Multa de tránsito (pico y placa)', sub: 'Multas', pay: DEBIT, member: ANDRES });
            if (R.chance(0.6)) c.add({ day: 28, key: 'tramites', amount: 1.12, store: 'Banco Pichincha', desc: 'Comisión transferencia interbancaria', sub: 'Comisiones Bancarias', pay: DEBIT });

            // Taxes and paperwork: predial in January (with the early-payment discount), the
            // income-tax return in March, the car registration in June (plate ending in 6).
            if (m === 1) c.add({ day: 12, key: 'tramites', amount: 148.6, store: 'Municipio de Quito', desc: 'Impuesto predial', sub: 'Impuesto Predial', parent: 'Vivienda', pay: DEBIT, member: ANDRES });
            if (m === 3) c.add({ day: 18, key: 'tramites', amount: 40, store: 'Contadora Lucía Mena', desc: 'Declaración del impuesto a la renta', sub: 'Asesoría Contable/Tributaria', pay: XFER, member: ANDRES });
            if (m === 6) c.add({ day: 9, key: 'tramites', amount: 186.4, store: 'AMT Quito', desc: 'Matriculación vehicular y revisión (Kia)', sub: 'Matriculación/Revisión Vehicular', parent: 'Transporte', pay: CREDIT, member: ANDRES });
            if (m === 11) c.add({ day: 20, key: 'tramites', amount: 72.3, store: 'AMT Quito', desc: 'Matriculación vehicular (Spark)', sub: 'Matriculación/Revisión Vehicular', parent: 'Transporte', pay: DEBIT, member: GABY });

            // Feriados and celebrations: Carnaval trip, Semana Santa (fanesca), Mateo's
            // birthday, Día de la Madre and del Padre, the summer trip to the coast, Sofía's
            // birthday, Difuntos, Fiestas de Quito, Navidad and Año Viejo.
            const carnaval = shiftDay(y, ea, -48), jueves = shiftDay(y, ea, -3);
            if (m === carnaval.m) {
                c.add({ day: carnaval.d - 1, key: 'turismo', amount: 128, store: 'Hostería Luna Runtún (Baños)', desc: 'Hospedaje feriado de Carnaval', sub: 'Hospedaje', pay: CREDIT, member: ANDRES });
                c.add({ day: carnaval.d, key: 'comidas', amount: 52.8, store: 'Restaurante Casa Hood (Baños)', desc: 'Comidas en Baños', sub: 'Restaurantes', pay: DEBIT });
                c.add({ day: carnaval.d - 1, key: 'gasolina', amount: 28, store: 'Primax', desc: 'Gasolina viaje a Baños', sub: 'Gasolina/Diesel', pay: DEBIT, member: ANDRES });
                c.add({ day: carnaval.d - 1, key: 'movilidad', amount: 2, store: 'Peaje Panamericana Sur', desc: 'Peajes', sub: 'Peajes', pay: CASH });
                c.add({ day: carnaval.d, key: 'paseos', amount: 12, store: 'Tía', desc: 'Espuma y globos de Carnaval', sub: 'Salidas y Paseos', pay: CASH, member: MATEO });
            }
            if (m === jueves.m) {
                c.add({ day: Math.max(1, jueves.d - 2), key: 'super', amount: 46.3, store: 'Mercado Santa Clara', desc: 'Granos para la fanesca', sub: 'Mercado Municipal/Ferias', pay: CASH, member: GABY });
                c.add({ day: Math.max(1, jueves.d - 1), key: 'super', amount: 21.4, store: 'Supermaxi', desc: 'Bacalao para la fanesca', sub: 'Mercado/Supermercado', pay: DEBIT, member: GABY });
            }
            if (m === 3) { c.add({ day: 8, key: 'regalos', amount: 65, store: 'Marathon Sports', desc: 'Regalo de cumpleaños (Mateo)', sub: 'Regalos de Cumpleaños', pay: CREDIT, member: GABY }); c.add({ day: 9, key: 'regalos', amount: 28, store: 'Pastelería Cyrano', desc: 'Torta de cumpleaños (Mateo)', sub: 'Fiestas/Celebraciones', pay: DEBIT, member: GABY }); }
            if (m === 5) { const md = nthWeekday(y, 5, 0, 2); c.add({ day: md - 1, key: 'regalos', amount: 48.9, store: 'De Prati', desc: 'Regalo Día de la Madre', sub: 'Fiestas/Celebraciones', pay: CREDIT, member: ANDRES }); c.add({ day: md, key: 'comidas', amount: 78.5, store: 'Restaurante Mama Clorinda', desc: 'Almuerzo Día de la Madre', sub: 'Restaurantes', pay: CREDIT, member: ANDRES }); }
            if (m === 6) { const pd = nthWeekday(y, 6, 0, 3); c.add({ day: pd - 1, key: 'regalos', amount: 42, store: 'Etafashion', desc: 'Regalo Día del Padre', sub: 'Fiestas/Celebraciones', pay: CREDIT, member: GABY }); c.add({ day: pd, key: 'comidas', amount: 58.2, store: 'Parrilladas El Toro', desc: 'Almuerzo Día del Padre', sub: 'Restaurantes', pay: DEBIT, member: GABY }); }
            if (m === 7) {
                c.add({ day: 3, key: 'regalos', amount: 40, store: 'De Prati', desc: 'Regalo de cumpleaños (Gabriela)', sub: 'Regalos de Cumpleaños', pay: CREDIT, member: ANDRES });
                c.add({ day: 24, key: 'turismo', amount: 236, store: 'Hostería Nantu (Puerto López)', desc: 'Hospedaje vacaciones en la costa', sub: 'Hospedaje', pay: CREDIT, member: ANDRES });
                c.add({ day: 25, key: 'paseos', amount: 100, store: 'Machalilla Tours', desc: 'Avistamiento de ballenas (4 personas)', sub: 'Turismo Nacional', pay: CASH, member: ANDRES });
                c.add({ day: 26, key: 'comidas', amount: 96.4, store: 'Restaurante Bellitalia (Puerto López)', desc: 'Comidas en la playa', sub: 'Restaurantes', pay: DEBIT });
                c.add({ day: 23, key: 'gasolina', amount: 46, store: 'Petroecuador – gasolinera', desc: 'Gasolina viaje a la costa', sub: 'Gasolina/Diesel', pay: DEBIT, member: ANDRES });
            }
            if (m === 10) { c.add({ day: 20, key: 'regalos', amount: 86.4, store: 'Megamaxi', desc: 'Fiesta de cumpleaños (Sofía)', sub: 'Fiestas/Celebraciones', pay: CREDIT, member: GABY }); c.add({ day: 19, key: 'regalos', amount: 32, store: 'Juguetón', desc: 'Regalo de cumpleaños (Sofía)', sub: 'Regalos de Cumpleaños', pay: CREDIT, member: GABY }); }
            if (m === 11) { c.add({ day: 1, key: 'super', amount: 14.5, store: 'Panadería La Unión', desc: 'Colada morada y guaguas de pan', sub: 'Panadería', pay: CASH, member: GABY }); c.add({ day: 15, key: 'regalos', amount: 45, store: 'Etafashion', desc: 'Regalo de cumpleaños (Andrés)', sub: 'Regalos de Cumpleaños', pay: CREDIT, member: GABY }); }
            if (m === 12) {
                c.add({ day: 4, key: 'paseos', amount: 40, store: 'Chiva Quiteña Tours', desc: 'Chiva por las Fiestas de Quito', sub: 'Conciertos/Eventos', pay: CASH, member: ANDRES });
                c.add({ day: 5, key: 'paseos', amount: 30, store: 'Fiestas de Quito', desc: 'Concierto y canelazo', sub: 'Conciertos/Eventos', pay: CASH, member: MATEO });
                c.add({ day: 13, key: 'regalos', amount: 186.5, store: 'Megamaxi', desc: 'Regalos de Navidad', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: GABY });
                c.add({ day: 16, key: 'regalos', amount: 142.3, store: 'De Prati', desc: 'Regalos de Navidad', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: ANDRES });
                c.add({ day: 18, key: 'regalos', amount: 64.9, store: 'Juguetón', desc: 'Juguetes del Niño Jesús', sub: 'Regalos Navideños/Bodas/Baby Showers', pay: CREDIT, member: GABY });
                c.add({ day: 22, key: 'super', amount: 78.6, store: 'Supermaxi', desc: 'Pavo y cena navideña', sub: 'Mercado/Supermercado', pay: DEBIT, member: GABY });
                c.add({ day: 30, key: 'regalos', amount: 25, store: 'Monigotes La Floresta', desc: 'Monigote de Año Viejo', sub: 'Fiestas/Celebraciones', pay: CASH, member: MATEO });
                c.add({ day: 31, key: 'super', amount: 42.8, store: 'Megamaxi', desc: 'Cena de Año Viejo', sub: 'Mercado/Supermercado', pay: DEBIT, member: GABY });
                c.add({ day: 20, key: 'paseos', amount: 36, store: 'Novena en casa', desc: 'Novena navideña (buñuelos, chocolate)', sub: 'Salidas y Paseos', pay: CASH });
            }

            // Income outside the plan: a DPF's interest, a freelance extra, selling the stroller,
            // the SRI refund. Routed to the debt snowball by default.
            if (y === prev && m === 11) c.add({ day: 18, type: 'Ingreso', parent: 'Ingresos Financieros', sub: 'Interés DPF/Pólizas', amount: 186.4, store: 'Cooperativa JEP', desc: 'Interés de póliza al vencimiento', pay: XFER, member: ANDRES, route: 'extra' });
            const extraJob = { 6: 300, 10: 250 }[m];
            if (extraJob) c.add({ day: R.int(15, 24), type: 'Ingreso', parent: 'Ingresos Independientes', sub: 'Honorarios Profesionales', amount: extraJob, store: 'Cliente: Café Dos Volcanes', desc: 'Diseño de marca (proyecto extra)', pay: XFER, member: GABY, route: 'extra' });
            if (y === cur && m === 5) c.add({ day: 21, type: 'Ingreso', parent: 'Otros Ingresos', sub: 'Venta de Artículos Usados', amount: 80, store: 'Marketplace', desc: 'Venta del coche de bebé', pay: CASH, member: GABY, route: 'extra' });
            if (m === 5) c.add({ day: 28, type: 'Ingreso', parent: 'Gobierno y Beneficios', sub: 'Devolución de Impuestos (SRI)', amount: y === cur ? 124.6 : 98.3, store: 'SRI', desc: 'Devolución de impuesto a la renta', pay: XFER, member: ANDRES, route: 'extra' });
            if (m === 3) c.add({ day: 9, type: 'Ingreso', parent: 'Otros Ingresos', sub: 'Regalos Recibidos', amount: 50, store: 'Abuelos', desc: 'Regalo de cumpleaños para Mateo', pay: CASH, member: MATEO, route: 'regalos' });
        }

        // The décimos have a job every year: the décimo cuarto (August) pays the school start,
        // the décimo tercero (December) pays Christmas and the rest goes to the snowball.
        const bonusRoutes = (m, amount) => (m === '8' ? { utiles: Math.min(amount, 380), extra: Math.max(0, amount - 380) }
            : m === '12' ? { regalos: 420, super: 110, paseos: 90, extra: amount - 620 } : null);

        return {
            firstYear: flatYear,
            members: [{ id: ANDRES, name: 'Andrés', color: '#2a78d6' }, { id: GABY, name: 'Gabriela', color: '#eb6834' }, { id: MATEO, name: 'Mateo', color: '#1baf7a' }],
            lines, extraLine: { name: 'Pago extra de deudas (bola de nieve)' }, surplus: { key: 'dpf', keep: 150 }, debts, goals, snowballTarget, yearFields, pastNetWorth, accounts, holdings: [], polizas, assets, rules, month, bonusRoutes,
            goalDay: 6, extraDay: 26,
            payDay: { freq: 'monthly', days: [15, 30], weekend: 'before' },
            mortgage: { amount: loan.amount, rate: loan.rate, years: loan.months / 12, extraPayment: 0 },
            mortgageNow: loanBalance(loan.amount, loan.rate, loan.months, loan.firstY, loan.firstM, env.T.getFullYear(), env.T.getMonth() + 1),
            retirement: { edadActual: 40, edadJubilacion: 65, aporteMensual: 80, tasaRetiroSegura: 4, aniosAportados: 17, tasaReemplazo: 60 },
            settings: { cashBuffer: 200, retireWhatIfMax: 500, mortgageWhatIfMax: 1000, mortgageSystem: 'frances' },
            recurringDefs: { hipoteca: 'monthly', mama: 'monthly', netflix: 'monthly', spotify: 'monthly' }
        };
    }

    // ================================================================== the builder
    function build(country, today) {
        const US = String(country || '').toUpperCase() === 'US';
        const Defaults = lib('Defaults', './defaults.js');
        const D = US ? lib('DefaultsUS', './defaults-us.js') : Defaults;
        const Engine = lib('Engine', './engine.js');
        const t0 = new Date(today || Date.now());
        const T = new Date(t0.getFullYear(), t0.getMonth(), t0.getDate());
        const todayISO = isoOf(T);
        const cur = T.getFullYear(), prev = cur - 1;
        const R = prng(`${US ? 'US' : 'EC'}|${todayISO}`);
        const env = { T, cur, prev, R };
        const P = US ? usProfile(env) : ecProfile(env);
        const lastYear = cur + 10;

        const s = D.newState(T);
        s.configStartYear = P.firstYear;
        s.configEndYear = lastYear;
        s.activeYear = cur;
        s.members = clone(P.members);
        Object.assign(s.settings, P.settings, { country: US ? 'US' : 'EC', currency: 'USD', welcomeDismissed: true, sample: true });
        s.settings.paySchedule = Object.assign({}, P.payDay);
        if (P.payDay.freq === 'weekly') {
            // Every other Friday, counted from the first Friday of last January.
            const a = new Date(prev, 0, 2);
            a.setDate(a.getDate() + ((P.payDay.weekday - a.getDay() + 7) % 7));
            s.settings.paySchedule.anchor = isoOf(a);
        }

        // Debts and goals (their budget lines are derived by the app from these).
        s.debts = P.debts.map((d, i) => {
            const out = { id: i + 1, name: d.name, kind: d.kind, balance: d.balance, rate: d.rate, minPayment: d.minPayment, monthly: d.monthly, dueDay: d.dueDay, createdYear: d.createdYear, originalBalance: d.originalBalance };
            d.id = out.id;
            return out;
        });
        const debtByKey = Object.fromEntries(P.debts.map(d => [d.key, d]));
        s.goals = P.goals.map((g, i) => {
            g.id = i + 1;
            return { id: g.id, name: g.name, target: g.target, current: g.current, monthly: g.monthly, rate: g.rate, createdYear: prev, targetDate: g.targetDate };
        });
        const goalByKey = Object.fromEntries(P.goals.map(g => [g.key, g]));

        // ------------------------------------------------------------ years and budgets
        const lineIds = {};
        P.lines.forEach((l, i) => { lineIds[l.key] = i + 1; });
        const EXTRA_ID = P.lines.length + 1;
        lineIds.extra = EXTRA_ID;
        const amountFor = (l, y) => {
            if (y >= cur) return l.amount;
            if (l.past !== undefined) return l.past;
            return l.type === 'Gasto Variable' ? Math.max(5, round5(l.amount * Math.pow(0.97, cur - y))) : l.amount;
        };
        // The debt and goal lines the app adds to year y (mirrors Store.linkedRows).
        const linkedTotal = (y, yd) => {
            const byPayroll = new Set((yd.payDeductions || []).filter(x => x.debtId).map(x => Number(x.debtId)));
            const debts = s.debts.filter(d => d.balance > 0.01 && d.createdYear <= y && !byPayroll.has(d.id)).reduce((t, d) => t + d.monthly, 0);
            return debts + s.goals.filter(g => g.createdYear <= y).reduce((t, g) => t + g.monthly, 0);
        };
        const plan = {};
        for (let y = P.firstYear; y <= lastYear; y++) {
            const yd = D.newYear();
            Object.assign(yd, P.yearFields(Math.min(y, cur)));
            if (US) yd.country = 'US';
            yd.budgetBase = P.lines.filter(l => (!l.from || l.from <= y) && (!l.until || y <= l.until)).map(l => {
                const a = amountFor(l, y);
                const item = { id: lineIds[l.key], name: l.name, type: l.type, isDeductible: !!l.deductible, prep: a, real: a, linkedCategory: l.cat };
                if (l.dueDay) item.dueDay = l.dueDay;
                return item;
            });
            const pay = Engine.payroll(yd);
            const income = pay.netoM + yd.otherIncomes.reduce((t, x) => t + x.amount, 0);
            const assigned = yd.budgetBase.reduce((t, i) => t + i.real, 0) + linkedTotal(y, yd);
            let extra = Math.max(0, Math.floor((income - assigned) * 100) / 100);
            // Years before last year had fewer debts and kids' costs: beyond a modest snowball,
            // what was left went to savings.
            const keep = P.surplus && y < prev ? P.surplus.keep : Infinity;
            const saved = yd.budgetBase.find(i => i.id === lineIds[(P.surplus || {}).key]);
            if (extra > keep && saved) { const move = round2(extra - keep); saved.prep = saved.real = round2(saved.real + move); extra = round2(extra - move); }
            yd.budgetBase.push({ id: EXTRA_ID, name: P.extraLine.name, type: 'Deuda', isDeductible: false, prep: extra, real: extra, linkedCategory: 'Deudas' });
            s.years[y] = yd;
            plan[y] = { pay };
        }

        // ------------------------------------------------------------ transactions
        const txns = [];
        const lineOf = (y, key) => (s.years[y].budgetBase || []).find(i => i.id === lineIds[key]) || null;
        // From January of last year (or 13 whole months back, if today is in January) to today.
        const months = [];
        for (let k = Math.min(prev * 12, cur * 12 + T.getMonth() - 13); k <= cur * 12 + T.getMonth(); k++) months.push([Math.floor(k / 12), (k % 12) + 1]);

        months.forEach(([y, m]) => {
            const dim = daysIn(y, m);
            const yd = s.years[y];
            const c = {
                y, m, dim, R,
                year: () => yd,
                line: (key) => lineOf(y, key),
                amt: (key) => { const l = lineOf(y, key); return l ? l.real : 0; },
                plannedIncome: (id) => (yd.otherIncomes.find(x => x.id === id) || { amount: 0 }).amount,
                // Budget × the month's seasonal factor × ±8% noise.
                vary: (key, season) => c.amt(key) * (season ? season[m - 1] : 1) * R.between(0.92, 1.08),
                add(o) {
                    const day = Math.max(1, Math.min(dim, Math.round(o.day || 1)));
                    const date = iso(y, m, day);
                    if (date > todayISO || !(o.amount > 0)) return null;
                    const type = o.type || 'Gasto';
                    const t = { type, description: o.desc, store: o.store || '', parentCategory: o.parent, category: o.sub, amount: round2(o.amount), date, paymentType: typeof o.pay === 'function' ? o.pay() : (o.pay || DEBIT) };
                    if (type === 'Gasto') {
                        let line = null;
                        if (o.key && o.key.startsWith('debt:')) { const d = debtByKey[o.key.slice(5)]; t.budgetLine = 'debt-' + d.id; t._debt = d.id; t.parentCategory = t.parentCategory || 'Deudas'; }
                        else if (o.key && o.key.startsWith('goal:')) { const g = goalByKey[o.key.slice(5)]; t.budgetLine = 'goal-' + g.id; t.parentCategory = t.parentCategory || 'Ahorro e Inversión'; }
                        else if (o.key) {
                            line = lineOf(y, o.key);
                            if (!line) return null;              // that line doesn't exist this year
                            t.budgetLine = String(line.id);
                            t.parentCategory = t.parentCategory || line.linkedCategory;
                        }
                    }
                    if (o.member) t.memberId = o.member;
                    if (o.incomeId) t.incomeId = o.incomeId;
                    if (o.countAsExtra) t.countAsExtra = true;
                    if (o.refund) t.refund = true;
                    if (o.rec) t._rec = o.rec;
                    if (o.route) t._route = o.route;
                    txns.push(t);
                    return t;
                },
                // Split `total` among `pieces` (each a partial transaction with a weight `w`).
                spread(key, total, pieces, base = {}) {
                    if (!(total > 0) || !pieces.length) return;
                    const ws = pieces.map(p => (p.w || 1) * R.between(0.75, 1.25));
                    const W = ws.reduce((a, b) => a + b, 0);
                    let left = round2(total);
                    pieces.forEach((p, i) => {
                        const amount = i === pieces.length - 1 ? left : round2(total * ws[i] / W);
                        left = round2(left - amount);
                        c.add(Object.assign({ key, day: R.int(1, dim) }, base, p, { amount }));
                    });
                },
                // Salary deposits on the paydays of the pay schedule (the app counts the
                // salary from the payroll, so these are records of it, never added twice).
                paychecks({ store, desc, member }) {
                    const days = Engine.payDates(s.settings.paySchedule, iso(y, m, 1), iso(y, m, dim));
                    const net = plan[y].pay.netoM;
                    const each = P.payDay.freq === 'weekly' ? round2(net * 12 / 26) : round2(net / days.length);
                    days.forEach(d => c.add({ day: Number(d.slice(8)), type: 'Ingreso', parent: 'Ingresos Laborales', sub: 'Sueldo/Salario', amount: each, store, desc, pay: XFER, member }));
                }
            };

            // Fixed bills from the lines that describe one.
            P.lines.forEach(l => {
                if (!l.bill || !c.line(l.key)) return;
                const b = l.bill;
                const a = b.season ? c.amt(l.key) * b.season[m - 1] * R.between(1 - (b.noise || 0), 1 + (b.noise || 0)) : c.amt(l.key);
                c.add({ day: b.day, key: l.key, amount: a, store: b.store, desc: b.desc, sub: b.sub, pay: b.pay, member: b.member, rec: b.rec });
            });
            // Debt payments on their due day (not the one the paycheck pays), goal transfers.
            P.debts.forEach(d => {
                if (d.payroll || d.createdYear > y || (d.start && y * 12 + m < d.start[0] * 12 + d.start[1])) return;
                c.add({ day: d.dueDay, key: 'debt:' + d.key, amount: d.monthly, store: d.lender, desc: d.payDesc, sub: d.sub, pay: XFER, member: P.members[0].id });
            });
            if (y >= prev) P.goals.forEach(g => c.add({ day: P.goalDay, key: 'goal:' + g.key, amount: g.monthly, store: g.store, desc: g.desc, sub: g.sub, pay: XFER }));
            // Savings lines (retirement, DPF): a transfer each month.
            P.lines.filter(l => l.type === 'Ahorro' && c.line(l.key)).forEach(l => c.add({
                day: P.goalDay, key: l.key, amount: c.amt(l.key), store: US ? 'Vanguard' : (l.key === 'dpf' ? 'Cooperativa JEP' : 'Fondo Complementario Previsional'), desc: US ? 'Roth IRA contribution' : (l.key === 'dpf' ? 'Ahorro para la próxima póliza' : 'Aporte voluntario para la jubilación'),
                sub: US ? '401(k) / IRA' : (l.key === 'dpf' ? 'Aporte DPF' : 'Aporte Voluntario IESS'), pay: XFER, member: US ? 2 : 1
            }));
            P.month(c);
        });

        // ------------------------------------------------------------ months with their own budget
        // Unplanned income (and the décimos) get a job in that month's budget: the base budget
        // with those amounts added to the lines they pay for (by default the debt snowball).
        const routed = {};   // 'y-m' → { lineKey: amount, _last: day }
        txns.filter(t => t._route).forEach(t => {
            const k = `${Number(t.date.slice(0, 4))}-${Number(t.date.slice(5, 7))}`;
            const r = routed[k] || (routed[k] = { _last: 0 });
            r[t._route] = round2((r[t._route] || 0) + t.amount);
            r._last = Math.max(r._last, Number(t.date.slice(8)));
        });
        Object.keys(s.years).forEach(yk => {
            const y = Number(yk), yd = s.years[y];
            for (let m = 1; m <= 12; m++) {
                const key = `${y}-${m}`, routes = Object.assign({}, routed[key] || {});
                delete routes._last;
                const bonus = Engine.bonusForMonth(yd, String(m));
                if (bonus > 0 && P.bonusRoutes) Object.entries(P.bonusRoutes(String(m), bonus)).forEach(([k, a]) => { routes[k] = round2((routes[k] || 0) + a); });
                if (!Object.keys(routes).length) continue;
                const items = clone(yd.budgetBase);
                Object.entries(routes).forEach(([k, a]) => {
                    const item = items.find(i => i.id === lineIds[k]) || items.find(i => i.id === EXTRA_ID);
                    item.prep = item.real = round2(item.real + a);
                });
                yd.monthOverrides[String(m)] = items;
            }
        });

        // The snowball's own payment each month: the extra line's amount for that month, to the
        // debt the snowball is attacking, once the month's extra money has arrived.
        months.forEach(([y, m]) => {
            const items = s.years[y].monthOverrides[String(m)] || s.years[y].budgetBase;
            const extra = (items.find(i => i.id === EXTRA_ID) || { real: 0 }).real;
            const d = debtByKey[P.snowballTarget(y, m)];
            const day = Math.min(daysIn(y, m), Math.max(P.extraDay, ((routed[`${y}-${m}`] || {})._last || 0) + 1));
            const date = iso(y, m, day);
            if (extra > 0 && date <= todayISO) txns.push({ type: 'Gasto', description: US ? `Extra payment – ${d.name}` : `Pago extra – ${d.name}`, store: d.lender, parentCategory: 'Deudas', category: d.sub, amount: extra, date, paymentType: XFER, budgetLine: String(EXTRA_ID), memberId: P.members[0].id, _debt: d.id });
        });

        // ------------------------------------------------------------ tags
        // The family tags their trips and Christmas, so each one can be totaled across categories.
        const TRIP = /vacation|vacaci|playa|puerto l[oó]pez|ba[nñ]os|traverse|sleeping bear|kayak|moomers|mabel|carnaval|hoster[ií]a|hospedaje/i;
        txns.forEach(t => {
            // Savings for the trip aren't the trip itself.
            if (t.type !== 'Gasto' || t.parentCategory === 'Ahorro e Inversión') return;
            const y = t.date.slice(0, 4);
            if (t.parentCategory === 'Viajes y Vacaciones' || TRIP.test(`${t.description} ${t.store}`)) t.tags = [(US ? 'vacation-' : 'vacaciones-') + y];
            else if (t.date.slice(5, 7) === '12' && t.parentCategory === 'Regalos, Celebraciones y Donaciones') t.tags = [(US ? 'christmas-' : 'navidad-') + y];
        });

        // ------------------------------------------------------------ transfers + refunds
        // Cash from the ATM twice a month (checking → wallet), and a few purchases returned:
        // neither changes what the family earned, and a refund lowers what they spent.
        const chk = P.accounts.find(a => a.kind === 'corriente'), wallet = P.accounts.find(a => a.kind === 'efectivo');
        const firstISO = txns.reduce((m, t) => (t.date < m ? t.date : m), todayISO);
        for (let d = new Date(Number(firstISO.slice(0, 4)), Number(firstISO.slice(5, 7)) - 1, 1); d <= T; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
            [3, 17].forEach(day => {
                const date = iso(d.getFullYear(), d.getMonth() + 1, day);
                if (date < firstISO || date > todayISO) return;
                txns.push({ type: 'Transferencia', description: US ? 'ATM withdrawal' : 'Retiro en cajero', store: US ? 'LMCU ATM' : 'Cajero Banco Pichincha', parentCategory: 'Transferencia', category: '', amount: US ? R.pick([60, 80, 100]) : R.pick([40, 60]), date, paymentType: XFER, from: 'acc-' + chk.id, to: 'acc-' + wallet.id, memberId: P.members[R.int(0, 1)].id });
            });
        }
        const returnable = txns.filter(t => t.type === 'Gasto' && !t._rec && !t.splits && t.parentCategory !== 'Deudas' && (t.paymentType === DEBIT || t.paymentType === CREDIT) && Number(t.amount) >= 35 && t.date <= isoOf(new Date(T.getFullYear(), T.getMonth(), T.getDate() - 10)));
        const used = new Set();
        for (let k = 0; k < 4 && returnable.length; k++) {
            const t = R.pick(returnable);
            if (used.has(t.date.slice(0, 7))) continue;
            used.add(t.date.slice(0, 7));
            const back = new Date(Number(t.date.slice(0, 4)), Number(t.date.slice(5, 7)) - 1, Number(t.date.slice(8, 10)) + R.int(4, 9));
            txns.push({ type: 'Gasto', refund: true, description: (US ? 'Return: ' : 'Devolución: ') + t.description, store: t.store, parentCategory: t.parentCategory, category: t.category, amount: R.chance(0.5) ? t.amount : Math.round(t.amount * 0.5 * 100) / 100, date: isoOf(back), paymentType: t.paymentType, budgetLine: t.budgetLine, memberId: t.memberId, _refundOf: t });
            if (!txns[txns.length - 1].budgetLine) delete txns[txns.length - 1].budgetLine;
        }

        // ------------------------------------------------------------ recurring + ids
        txns.sort((a, b) => a.date.localeCompare(b.date) || (a.type === b.type ? 0 : a.type === 'Ingreso' ? -1 : 1));
        s.recurring = Object.keys(P.recurringDefs).map((rk, i) => {
            const mine = txns.filter(t => t._rec === rk);
            const t = mine[mine.length - 1];
            const rec = { id: i + 1, type: t.type, description: t.description, store: t.store, parentCategory: t.parentCategory, category: t.category, amount: t.amount, paymentType: t.paymentType, budgetLine: t.budgetLine, frequency: P.recurringDefs[rk], startDate: mine[0].date, lastPosted: t.date, auto: true };
            if (t.memberId) rec.memberId = t.memberId;
            mine.forEach(x => { x.recurringId = rec.id; });
            return rec;
        });
        txns.forEach((t, i) => { t._id = i + 1; });
        s.transactions = txns.map(t => {
            const out = Object.assign({ id: t._id }, t);
            if (t._refundOf) out.refundOf = t._refundOf._id;
            delete out._rec; delete out._route; delete out._refundOf; delete out._id; delete out._debt;
            if (!out.memberId) delete out.memberId;
            return out;
        });

        // Each debt's payment history (what "Pagar" keeps), walked back from today's balance:
        // before a payment the balance was (after + paid) / (1 + monthly rate).
        s.debts.forEach(d => {
            const r = (Number(d.rate) || 0) / 1200;
            let bal = d.balance;
            const list = txns.filter(t => t._debt === d.id).sort((a, b) => b.date.localeCompare(a.date));
            // Interest is charged once a month: on the month's first payment.
            const pays = list.map((t, i) => {
                const firstOfMonth = !list[i + 1] || list[i + 1].date.slice(0, 7) !== t.date.slice(0, 7);
                const before = round2(firstOfMonth ? (bal + t.amount) / (1 + r) : bal + t.amount);
                const interest = firstOfMonth ? round2(before * r) : 0, row = { date: t.date, amount: t.amount, interest, principal: round2(t.amount - interest), balance: round2(bal) };
                bal = before;
                return row;
            });
            // Keep the recent stretch that stays within what was originally borrowed.
            const cap = Math.max(Number(d.originalBalance) || 0, d.balance);
            const keep = [];
            for (const p of pays) { if (p.balance + p.principal > cap + 0.01) break; keep.push(p); }
            if (keep.length) d.payments = keep.reverse().slice(-120);
        });

        s.rules = P.rules.map((r, i) => {
            const out = { id: i + 1, contains: r.contains, category: r.category, sub: r.sub, budgetLine: String(lineIds[r.line]) };
            if (r.rename) out.rename = r.rename;
            return out;
        });

        // ------------------------------------------------------------ money, investments, assets
        const addDays = (n) => isoOf(new Date(T.getFullYear(), T.getMonth(), T.getDate() + n));
        // Checking holds a cushion plus what this month's bills still due will take, so "safe to
        // spend" reads sensibly whichever day the example is opened.
        const dueLater = s.years[cur].budgetBase.filter(i => i.dueDay > T.getDate()).reduce((t, i) => t + i.real, 0)
            + s.debts.filter(d => d.dueDay > T.getDate() && !(P.debts.find(x => x.id === d.id) || {}).payroll).reduce((t, d) => t + d.monthly, 0);
        s.accounts = P.accounts.map(a => {
            const out = Object.assign({}, a, { balance: round2(a.balance + (a.plusBills ? dueLater : 0)), updatedAt: todayISO });
            delete out.plusBills;
            return out;
        });
        s.holdings = P.holdings.map(h => Object.assign({}, h, { priceAt: new Date(T.getFullYear(), T.getMonth(), T.getDate(), 9, 30).toISOString(), priceSource: 'manual' }));
        s.polizas = P.polizas.map((p, i) => ({ id: i + 1, coopName: p.coopName, number: p.number, amount: p.amount, rate: p.rate, days: p.days, modality: p.modality, maturityDate: addDays(p.matureIn) }));
        s.assets = P.assets.map((a, i) => ({ id: i + 1, name: a.name, category: a.category, purchaseYear: a.purchaseYear, purchaseValue: a.purchaseValue, status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false, valuesByYear: a.values }));
        // The college estimator: the teen's existing college goal, the toddler with nothing saved yet.
        const gid = (k) => (goalByKey[k] || {}).id || null;
        s.college = { kids: US ? [
            { id: 1, name: 'Emma', age: 15, type: 'in-state', years: 4, cost: null, saved: 0, monthly: 0, goalId: gid('college') },
            { id: 2, name: 'Leo', age: 2, type: 'in-state', years: 4, cost: null, saved: 0, monthly: 0, goalId: null }
        ] : [
            { id: 1, name: 'Mateo', age: 15, type: 'privada', years: 5, cost: null, saved: 0, monthly: 0, goalId: gid('uni') },
            { id: 2, name: 'Sofía', age: 2, type: 'publica', years: 5, cost: null, saved: 0, monthly: 0, goalId: null }
        ], costInflation: null, returnPct: null };

        // US: what the pay stubs say is withheld (federal), Sarah's part-time W-2 and the
        // photography side income — for the refund-or-owe estimate.
        if (US) s.years[cur].withholding = { perCheck: 195, ytd: null, spouseWages: 22800, spouseWithheld: 1150, untaxed: 2400 };

        // Yearly bills for the annual planner (no fund yet: "Crear el apartado" is the next step).
        s.annualBills = (US ? [
            { name: 'Car registration (Odyssey + Civic)', amount: 238, every: 12, month: 3, category: 'Transporte', sub: 'Matriculación/Revisión Vehicular' },
            { name: 'Amazon Prime', amount: 139, every: 12, month: 7, category: 'Suscripciones y Entretenimiento Digital' },
            { name: 'Summer camp (Emma)', amount: 650, every: 12, month: 6, category: 'Familia e Hijos' },
            { name: 'Back-to-school', amount: 380, every: 12, month: 8, category: 'Educación' },
            { name: 'Holiday gifts', amount: 900, every: 12, month: 12, category: 'Regalos, Celebraciones y Donaciones' },
            { name: 'Tax preparation', amount: 180, every: 12, month: 3, category: 'Financiero y Legal', sub: 'Preparación de Impuestos' }
        ] : [
            { name: 'Matrícula vehicular (Sportage)', amount: 185, every: 12, month: 4, category: 'Transporte', sub: 'Matriculación/Revisión Vehicular' },
            { name: 'Impuesto predial', amount: 240, every: 12, month: 1, category: 'Vivienda' },
            { name: 'Seguro del carro', amount: 690, every: 12, month: 6, category: 'Seguros y Protección' },
            { name: 'Útiles y uniformes escolares', amount: 320, every: 12, month: 9, category: 'Educación' },
            { name: 'Regalos de Navidad', amount: 450, every: 12, month: 12, category: 'Regalos, Celebraciones y Donaciones' }
        ]).map((b, i) => Object.assign({ id: i + 1 }, b));
        s.mortgage = Object.assign(s.mortgage, P.mortgage);
        Object.assign(s.retirement, P.retirement, { tasaRetorno: null, inflacion: null, sueldoPromedio: null, whatIfExtra: 0 });
        s.debtPlan = { strategy: 'snowball', extraPayment: 0 };

        // Net worth: this year is exactly the accounts, CDs/DPF, holdings and debts above; past
        // years follow the household's history. Future years carry this year's figures forward.
        const sumKind = (kinds) => round2(s.accounts.filter(a => kinds.includes(a.kind)).reduce((t, a) => t + a.balance, 0));
        const byKind = (kind) => round2(s.debts.filter(d => d.kind === kind).reduce((t, d) => t + d.balance, 0));
        const now = {
            checking: sumKind(['corriente', 'efectivo']), savings: sumKind(['ahorros']),
            investments: round2(Engine.polizasCapital(s.polizas) + Engine.holdingsValue(s.holdings) + sumKind(['retiro'])),
            mortgage: P.mortgageNow, autoLoans: byKind('vehicular'), creditCards: byKind('tarjeta'), personalLoans: byKind('personal'), studentLoans: byKind('estudiantil'), otherDebts: byKind('otra')
        };
        for (let y = P.firstYear; y <= cur; y++) {
            const yd = s.years[y];
            yd.netWorth = y === cur ? now : P.pastNetWorth(y);
            yd.netWorthTouched = Object.fromEntries(Engine.NET_WORTH_FIELDS.map(f => [f, true]));
        }

        // Net worth month by month since January of last year: between year-ends, with a small
        // wobble (markets, the card balance), ending exactly on today's figure.
        const ends = {};
        for (let y = P.firstYear; y <= cur; y++) ends[y] = Engine.netWorth(s.years, s.assets, y);
        const curM = T.getMonth() + 1;
        s.netWorthHistory = [];
        for (let y = Math.max(P.firstYear + 1, cur - 1); y <= cur; y++) {
            const from = ends[y - 1] || ends[y], to = ends[y], span = y === cur ? curM : 12;
            for (let m = 1; m <= span; m++) {
                const f = m / span, last = y === cur && m === span, wob = last ? 1 : 1 + (R.int(-6, 6) / 1000);
                const assets = round2((from.assets + (to.assets - from.assets) * f) * wob), liabilities = round2(from.liabilities + (to.liabilities - from.liabilities) * f);
                s.netWorthHistory.push({ month: `${y}-${pad2(m)}`, assets, liabilities, value: round2(assets - liabilities) });
            }
        }
        // When each net-worth step was first reached (App dates the rest as "already had it").
        const seed = s.settings.milestonesSeed = {};
        [0, 10000, 25000, 50000, 100000, 250000, 500000, 1000000].forEach(v => {
            const hit = s.netWorthHistory.find(h => (v === 0 ? h.value > 0 : h.value >= v));
            if (hit && hit !== s.netWorthHistory[0]) seed['nw' + v] = hit.month + '-15';
        });
        return s;
    }

    const Sample = { build };

    if (typeof module !== 'undefined' && module.exports) module.exports = Sample;
    else root.Sample = Sample;
})(this);
