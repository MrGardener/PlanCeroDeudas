/*
 * US edition (ZeroDebtPlan): starting data and tax parameters.
 *
 * Category and type names are the app's internal codes (shown translated: "Alimentación" →
 * "Food"), so every feature that matches categories keeps working; budget line names and sample
 * data are plain English (they're the user's own words from then on).
 *
 * Tax figures are for tax year 2026 as published (IRS Rev. Proc. 2025-32, SSA 2026 fact
 * sheet, Michigan Treasury). They change every year and are editable in Settings → Legal
 * parameters. Always verify against the official sources.
 */
(function (root) {
    'use strict';

    const clone = (x) => JSON.parse(JSON.stringify(x));
    const EC = root.Defaults || (typeof require !== 'undefined' ? require('./defaults.js') : null);

    // ------------------------------------------------------------------ federal (2026)
    const usTax2026 = () => ({
        year: 2026,
        brackets: {
            single: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [640600, 0.37]],
            mfj: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]],
            hoh: [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]],
            // Married filing separately: half the joint brackets. A qualifying surviving spouse uses the joint ones.
            mfs: [[0, 0.10], [12400, 0.12], [50400, 0.22], [105700, 0.24], [201775, 0.32], [256225, 0.35], [384350, 0.37]],
            qss: [[0, 0.10], [24800, 0.12], [100800, 0.22], [211400, 0.24], [403550, 0.32], [512450, 0.35], [768700, 0.37]]
        },
        stdDeduction: { single: 16100, mfj: 32200, hoh: 24150, mfs: 16100, qss: 32200 },
        // 65 or older, or blind: each one adds this to the standard deduction (married or a surviving
        // spouse / everyone else).
        addlStd: { married: 1650, unmarried: 2050 },
        // Itemizing (One Big Beautiful Bill Act): SALT cap, cut by 30% of income above the threshold
        // down to a $10,000 floor; charity counts above 0.5% of income; medical above 7.5%. Taking
        // the standard deduction, cash gifts to charity up to these amounts still come off.
        saltCap: 40400, saltPhaseoutStart: 505000, saltFloor: 10000, charityFloorPct: 0.5, medicalFloorPct: 7.5,
        charityNonItemizer: { single: 1000, mfj: 2000, hoh: 1000, mfs: 1000, qss: 1000 },
        childCredit: 2200,          // per qualifying child under 17
        otherDependentCredit: 500,
        // Both credits drop $50 per $1,000 of income above these amounts (IRC §24(b)).
        ctcPhaseoutStart: { single: 200000, mfj: 400000, hoh: 200000, mfs: 200000, qss: 200000 }, ctcPhaseoutStep: 50,
        ssRate: 6.2, ssWageBase: 184500,
        medicareRate: 1.45, addlMedicareRate: 0.9, addlMedicareThreshold: { single: 200000, mfj: 250000, hoh: 200000, mfs: 125000, qss: 200000 }, addlMedicareWithholding: 200000,
        // Contribution limits (for warnings): 401(k)/403(b) deferrals, pre-tax and Roth together (457(b)
        // has its own); catch-up from 50 (more from 60 to 63); everything incl. after-tax and the match
        // (415(c)); health FSA (limited-purpose shares it); dependent care FSA per household (from 2026).
        limit401k: 24500, catchUp401k: 8000, superCatchUp401k: 11250, limit415c: 72000, limitIRA: 7500, iraCatchUp: 1100,
        // A Roth IRA allows less between these incomes, nothing above (married filing separately: 0–10,000).
        rothIraPhaseout: { single: [153000, 168000], hoh: [153000, 168000], mfj: [242000, 252000], qss: [242000, 252000], mfs: [0, 10000] },
        limitHSA: { self: 4400, family: 8750 }, hsaCatchUp: 1000,
        limitFSA: 3400, limitDCFSA: 7500,
        // "No tax on overtime" (2025–2028): the extra half of time-and-a-half, up to these amounts, less
        // 10% of income above the phase-out start. Married people get it only filing jointly (0).
        overtimeDeduction: { max: { single: 12500, mfj: 25000, hoh: 12500, mfs: 0, qss: 12500 }, phaseoutStart: { single: 150000, mfj: 300000, hoh: 150000, mfs: 150000, qss: 150000 }, phaseoutRate: 0.1 },
        // The other 2025–2028 deductions (Schedule 1-A), with or without itemizing: qualified tips up
        // to $25,000 (less 10% of income above $150,000 / $300,000 joint; married only jointly);
        // interest on a loan for a new car assembled in the US, bought after 2024, up to $10,000
        // (less 20% above $100,000 / $200,000 joint); $6,000 for each person 65 or older (each one
        // less 6% of income above $75,000 / $150,000 joint; married only jointly).
        tipsDeduction: { max: { single: 25000, mfj: 25000, hoh: 25000, mfs: 0, qss: 25000 }, phaseoutStart: { single: 150000, mfj: 300000, hoh: 150000, mfs: 150000, qss: 150000 }, phaseoutRate: 0.1 },
        carLoanDeduction: { max: { single: 10000, mfj: 10000, hoh: 10000, mfs: 10000, qss: 10000 }, phaseoutStart: { single: 100000, mfj: 200000, hoh: 100000, mfs: 100000, qss: 100000 }, phaseoutRate: 0.2 },
        seniorDeduction: { max: { single: 6000, mfj: 6000, hoh: 6000, mfs: 0, qss: 6000 }, phaseoutStart: { single: 75000, mfj: 150000, hoh: 75000, mfs: 75000, qss: 75000 }, phaseoutRate: 0.06 },
        // Social Security benefit formula (PIA bend points, full retirement age 67)
        ssBend1: 1286, ssBend2: 7749, ssFullAge: 67,
        // Bonuses and other supplemental wages: employers usually withhold a flat 22% federal.
        supplementalRate: 22
    });

    // ------------------------------------------------------------------ states
    // 2026 tables (Engine.usStateTax): std = standard deduction by filing status ('federal': the
    // federal one); exemption = per person (filers and dependents); personal = by filing status;
    // perDependent; zero = income taxed at 0%; brackets by status (separately: half the joint ones);
    // surtax. Sources: each state's 2026 law or withholding tables as published by October 2026.
    // `approx` says what isn't counted. They change often: verify each January.
    const STD_NC = { single: 12750, mfs: 12750, mfj: 25500, hoh: 19125, qss: 25500 };
    const VA_BRACKETS = [[0, 0.02], [3000, 0.03], [5000, 0.05], [17000, 0.0575]];
    const STATE_TABLES = {
        AZ: { type: 'flat', rate: 2.5, std: 'federal', approx: 'the dependent credit' },
        CO: { type: 'flat', rate: 4.4, std: 'federal' },
        GA: { type: 'flat', rate: 4.99, std: { single: 15000, mfs: 15000, mfj: 30000, hoh: 15000, qss: 30000 }, perDependent: 5000 },
        ID: { type: 'flat', rate: 5.3, std: 'federal', approx: 'the first few thousand dollars taxed at 0%' },
        IN: { type: 'flat', rate: 2.95, exemption: 1000, approx: 'county tax: type it as the city rate' },
        IA: { type: 'flat', rate: 3.8, std: 'federal' },
        KY: { type: 'flat', rate: 3.5, std: { single: 3360, mfs: 3360, mfj: 6720, hoh: 3360, qss: 3360 } },
        LA: { type: 'flat', rate: 3.0, std: { single: 12875, mfs: 12875, mfj: 25750, hoh: 25750, qss: 25750 } },
        MA: { type: 'flat', rate: 5.0, personal: { single: 4400, mfs: 4400, mfj: 8800, hoh: 6800, qss: 4400 }, perDependent: 1000, surtax: { over: 1083150, rate: 4 } },
        MN: { type: 'brackets', std: { single: 15300, mfs: 15300, mfj: 30600, hoh: 23000, qss: 30600 },
            brackets: { single: [[0, 0.0535], [33310, 0.068], [109430, 0.0785], [203150, 0.0985]], mfj: [[0, 0.0535], [48700, 0.068], [193480, 0.0785], [337930, 0.0985]] },
            approx: 'the dependent exemption; head of household uses the single brackets' },
        MS: { type: 'flat', rate: 4.0, std: { single: 2300, mfs: 2300, mfj: 4600, hoh: 3400, qss: 4600 }, personal: { single: 6000, mfs: 6000, mfj: 12000, hoh: 9500, qss: 12000 }, perDependent: 1500, zero: 10000 },
        NC: { type: 'flat', rate: 3.99, std: STD_NC },
        OH: { type: 'flat', rate: 2.75, zero: 26050, approx: 'the personal exemptions' },
        UT: { type: 'flat', rate: 4.45, approx: 'the taxpayer credit, so a little high' },
        VA: { type: 'brackets', std: { single: 8750, mfs: 8750, mfj: 17500, hoh: 8750, qss: 17500 }, exemption: 930, brackets: { single: VA_BRACKETS, mfj: VA_BRACKETS, mfs: VA_BRACKETS, hoh: VA_BRACKETS, qss: VA_BRACKETS } }
    };
    // type: 'none' (no tax on wages), 'flat' (rate % after exemptions), 'custom' (enter the
    // rate from your pay stub until this state's table is added). Michigan first, as requested.
    const STATES = [
        ['AL', 'Alabama'], ['AK', 'Alaska', 'none'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'], ['CT', 'Connecticut'],
        ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida', 'none'], ['GA', 'Georgia'], ['HI', 'Hawaii'], ['ID', 'Idaho'],
        ['IL', 'Illinois', 'flat', 4.95, 2850], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'], ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'],
        ['MD', 'Maryland'], ['MA', 'Massachusetts'], ['MI', 'Michigan', 'flat', 4.25, 5900], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'],
        ['MT', 'Montana'], ['NE', 'Nebraska'], ['NV', 'Nevada', 'none'], ['NH', 'New Hampshire', 'none'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
        ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'], ['OR', 'Oregon'],
        ['PA', 'Pennsylvania', 'flat', 3.07, 0, true], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota', 'none'], ['TN', 'Tennessee', 'none'],
        ['TX', 'Texas', 'none'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington', 'none'], ['WV', 'West Virginia'],
        ['WI', 'Wisconsin'], ['WY', 'Wyoming', 'none']
    ].map(([code, name, type = 'custom', rate = null, exemption = 0, taxes401k = false]) => Object.assign({ code, name, type, rate, exemption, taxes401k }, STATE_TABLES[code] || {}));

    // Michigan cities with an income tax (Uniform City Income Tax Ordinance): resident rate, the
    // non-resident rate (half) for people who only work there, and the exemption per person
    // ($600 in most cities). Verify each year with your city.
    const MI_CITIES = [
        ['Detroit', 2.4], ['Grand Rapids', 1.5], ['Highland Park', 2.0], ['Saginaw', 1.5], ['Albion', 1.0], ['Battle Creek', 1.0], ['Benton Harbor', 1.0], ['Big Rapids', 1.0],
        ['East Lansing', 1.0], ['Flint', 1.0], ['Grayling', 1.0], ['Hamtramck', 1.0], ['Hudson', 1.0], ['Ionia', 1.0], ['Jackson', 1.0], ['Lansing', 1.0],
        ['Lapeer', 1.0], ['Muskegon', 1.0], ['Muskegon Heights', 1.0], ['Pontiac', 1.0], ['Port Huron', 1.0], ['Portland', 1.0], ['Springfield', 1.0], ['Walker', 1.0]
    ].map(([name, rate]) => ({ name, rate, nonresident: rate / 2, exemption: 600 }));
    // Other states' local income taxes on wages (resident rate, non-resident rate). Ohio cities tax
    // people who work there at the same rate; Pennsylvania's earned income tax includes the school
    // district's; New York City has its own brackets on New York taxable income (no non-resident
    // tax). Verify each year with your city.
    const NYC_BRACKETS = { single: [[0, 0.03078], [12000, 0.03762], [25000, 0.03819], [50000, 0.03876]], mfj: [[0, 0.03078], [21600, 0.03762], [45000, 0.03819], [90000, 0.03876]],
        hoh: [[0, 0.03078], [14400, 0.03762], [30000, 0.03819], [60000, 0.03876]] };
    const CITIES = {
        MI: MI_CITIES,
        OH: [['Columbus', 2.5], ['Cleveland', 2.5], ['Cincinnati', 1.8], ['Toledo', 2.5], ['Akron', 2.5], ['Dayton', 2.5], ['Youngstown', 2.75], ['Canton', 2.5]]
            .map(([name, rate]) => ({ name, rate, nonresident: rate, exemption: 0 })),
        PA: [{ name: 'Philadelphia', rate: 3.74, nonresident: 3.43, exemption: 0 }, { name: 'Pittsburgh', rate: 3, nonresident: 1, exemption: 0 }],
        NY: [{ name: 'New York City', brackets: NYC_BRACKETS, std: { single: 8000, mfs: 8000, mfj: 16050, hoh: 11200, qss: 16050 }, rate: 3.876, nonresident: 0, exemption: 0 }]
    };

    // ------------------------------------------------------------------ budget
    const BUDGET_TEMPLATE = [
        { id: 1, name: 'Giving', type: 'Gasto Variable', isDeductible: false, prep: 100, real: 100, linkedCategory: 'Regalos, Celebraciones y Donaciones' },
        { id: 2, name: 'Rent / Mortgage', type: 'Gasto Fijo', isDeductible: false, prep: 1300, real: 1300, linkedCategory: 'Vivienda' },
        { id: 3, name: "Renter's / Home Insurance", type: 'Gasto Fijo', isDeductible: false, prep: 20, real: 20, linkedCategory: 'Vivienda' },
        { id: 4, name: 'Electric & Gas', type: 'Gasto Fijo', isDeductible: false, prep: 150, real: 150, linkedCategory: 'Servicios Básicos y Comunicación' },
        { id: 5, name: 'Water & Trash', type: 'Gasto Fijo', isDeductible: false, prep: 60, real: 60, linkedCategory: 'Servicios Básicos y Comunicación' },
        { id: 6, name: 'Internet & Phone', type: 'Gasto Fijo', isDeductible: false, prep: 120, real: 120, linkedCategory: 'Servicios Básicos y Comunicación' },
        { id: 7, name: 'Groceries', type: 'Gasto Variable', isDeductible: false, prep: 500, real: 500, linkedCategory: 'Alimentación' },
        { id: 8, name: 'Gas & Fuel', type: 'Gasto Variable', isDeductible: false, prep: 160, real: 160, linkedCategory: 'Transporte' },
        { id: 9, name: 'Car Insurance', type: 'Gasto Fijo', isDeductible: false, prep: 140, real: 140, linkedCategory: 'Transporte' },
        { id: 10, name: 'Health & Medicine', type: 'Gasto Variable', isDeductible: false, prep: 80, real: 80, linkedCategory: 'Salud' },
        { id: 11, name: 'Life Insurance', type: 'Gasto Fijo', isDeductible: false, prep: 30, real: 30, linkedCategory: 'Seguros y Protección' },
        { id: 12, name: 'Clothing', type: 'Gasto Variable', isDeductible: false, prep: 60, real: 60, linkedCategory: 'Vestimenta' },
        { id: 13, name: 'Personal Care', type: 'Gasto Variable', isDeductible: false, prep: 50, real: 50, linkedCategory: 'Cuidado Personal' },
        { id: 14, name: 'Fun Money', type: 'Gasto Variable', isDeductible: false, prep: 80, real: 80, linkedCategory: 'Entretenimiento y Ocio' },
        { id: 15, name: 'Subscriptions', type: 'Gasto Variable', isDeductible: false, prep: 40, real: 40, linkedCategory: 'Suscripciones y Entretenimiento Digital' },
        { id: 16, name: 'Emergency Fund', type: 'Ahorro', isDeductible: false, prep: 300, real: 300, linkedCategory: 'Ahorro e Inversión' }
    ];

    // A copy of `obj` with `key` placed right after `after` (or at the end): the order is the
    // order on the Categories screen and in every category list.
    function insertAfter(obj, after, key, value) {
        const out = {};
        Object.keys(obj).forEach(k => { if (k !== key) out[k] = obj[k]; if (k === after) out[key] = value; });
        if (!(key in out)) out[key] = value;
        return out;
    }

    // Added to the categories after the first version: each is added once to older saves
    // (Store.migrate, settings.taxonomyRev). `alike`: a name someone may already have added by
    // hand for the same thing; then theirs is kept and the app's guesses go to it instead.
    const TAXONOMY_REV = 1;
    const TAXONOMY_ADDED = [
        { rev: 1, cat: 'Servicios Básicos y Comunicación', subs: [['Basura/Reciclaje', /trash|garbage|refuse|recycl|basura|recicl/i]] },
        { rev: 1, cat: 'Compras', after: 'Alimentación', alike: /^(?:shopping|compras)$/i, subs: [['Compras en Línea'], ['Tiendas por Departamento'], ['Electrónica'], ['Compras Generales']] },
        { rev: 1, cat: 'Pasatiempos', after: 'Entretenimiento y Ocio', alike: /^(?:hobbies|hobby|pasatiempos)$/i, subs: [['Materiales de Pasatiempos'], ['Manualidades y Arte'], ['Equipo Deportivo y Aire Libre'], ['Gimnasio, Deportes y Clubes'], ['Música e Instrumentos'], ['Clases de Pasatiempos'], ['Juegos y Coleccionables']] },
        { rev: 1, cat: 'Financiero y Legal', subs: [['Cargos de Tarjeta de Crédito', /card fee|annual fee|late fee|cargos? de tarjeta/i], ['Comisiones por Compras en el Exterior', /foreign|international|intl|exterior|extranjero/i]] },
        { rev: 1, cat: 'Impuestos', after: 'Financiero y Legal', alike: /^(?:taxes|tax|impuestos)$/i, subs: [['Impuesto Federal (IRS)'], ['Impuesto Estatal'], ['Impuesto Municipal/Local'], ['Pagos Estimados Trimestrales'], ['Otros Impuestos']] }
    ];

    // The Ecuador taxonomy with US items (same category codes, so matching keeps working).
    function taxonomy() {
        let exp = clone(EC.EXPENSE_TAXONOMY);
        const inc = clone(EC.INCOME_TAXONOMY);
        exp['Servicios Básicos y Comunicación'] = ['Agua', 'Energía Eléctrica', 'Gas', 'Basura/Reciclaje', 'Internet', 'Plan Celular', 'Cable/TV'];
        // Hobbies have their own category here.
        exp['Entretenimiento y Ocio'] = exp['Entretenimiento y Ocio'].filter(x => x !== 'Hobbies');
        exp['Vivienda'] = ['Arriendo', 'Hipoteca', 'Alícuotas/Condominio', 'Impuesto Predial', 'Seguro de Hogar', 'Seguro de Inquilino', 'Mantenimiento del Hogar', 'Reparaciones (plomería, eléctrico, techo)', 'Muebles y Electrodomésticos', 'Jardinería/Limpieza del Hogar'];
        exp['Transporte'] = ['Cuota de Vehículo (Préstamo)', 'Gasolina/Diesel', 'Seguro Vehicular', 'Mantenimiento (aceite, llantas, frenos)', 'Matriculación/Revisión Vehicular', 'Transporte Público', 'Taxi/App de Transporte', 'Parqueo', 'Peajes', 'Alquiler de Vehículo'];
        exp['Ahorro e Inversión'] = ['Fondo de Emergencia', 'Aporte a Metas', 'Certificado de Depósito (CD)', '401(k) / IRA', 'Inversiones (bolsa)', 'Plan 529 (universidad)', 'Cuenta HSA'];
        exp['Salud'] = ['Seguro Médico', 'Copagos y Deducibles', 'Consultas Médicas', 'Medicinas', 'Odontología', 'Óptica', 'Terapia/Salud Mental', 'Exámenes de Laboratorio'];
        exp['Financiero y Legal'] = ['Comisiones Bancarias', 'Cargos de Tarjeta de Crédito', 'Comisiones por Compras en el Exterior', 'Trámites Legales/Notaría', 'Preparación de Impuestos', 'Multas y Trámites Municipales'];
        delete exp['Remesas y Ayuda Familiar'];
        exp['Remesas y Ayuda Familiar'] = ['Remesa Enviada al Exterior', 'Ayuda Económica a Familiares'];
        TAXONOMY_ADDED.filter(a => a.after).forEach(a => { exp = insertAfter(exp, a.after, a.cat, a.subs.map(x => x[0])); });
        inc['Ingresos Laborales'] = ['Sueldo/Salario', 'Horas Extras', 'Bonos', 'Comisiones', 'Propinas'];
        inc['Ingresos Financieros'] = ['Intereses', 'Dividendos', 'Alquiler de Propiedad (que recibes)'];
        inc['Gobierno y Beneficios'] = ['Reembolso de Impuestos (IRS)', 'Seguro Social', 'Beneficios de Desempleo'];
        delete inc['Remesas del Exterior'];
        return { expense: exp, income: inc };
    }

    const BANKS = [
        { id: 1, name: 'Ally Bank', segment: 'FDIC', defaultRate: 4.0, interestType: 'Al Vencimiento (Simple)', cosedeMax: 250000 },
        { id: 2, name: 'Capital One', segment: 'FDIC', defaultRate: 3.9, interestType: 'Al Vencimiento (Simple)', cosedeMax: 250000 },
        { id: 3, name: 'Marcus by Goldman Sachs', segment: 'FDIC', defaultRate: 3.9, interestType: 'Mensual (Compuesto)', cosedeMax: 250000 },
        { id: 4, name: 'Lake Michigan Credit Union', segment: 'NCUA', defaultRate: 3.8, interestType: 'Mensual (Compuesto)', cosedeMax: 250000 }
    ];

    function newYear() {
        const y = EC.newYear();
        return Object.assign(y, {
            country: 'US',
            sueldo: 5000,               // gross pay per month (with hourly pay: the base pay, kept in sync)
            payType: 'salary',          // 'salary' | 'hourly'
            hourly: { rate: 0, hours: 40, otHours: 0, otRate: 1.5, otInBudget: false },   // hours per week; otPerCheck: overtime hours on a usual paycheck (any pay type)
            bonuses: [],                // [{ id, name, amount, month: '1'…'12', inBudget }] gross, this year
            budgetOnPaychecks: false,   // weekly / every 2 weeks: budget on the usual paychecks; extra ones are extra income
            paysPerYear: null,          // paychecks a year (52, 26, 24, 12); null: the pay calendar's, else every 2 weeks
            tasa: 4.0,                  // savings / CD rate (APY %)
            d3: false, d4: false, iessRate: 0, sbu: 0, canasta: 0, sriCapMultiplier: 0, sriBrackets: [],
            cosede: 250000,             // FDIC / NCUA coverage per depositor, per bank, per ownership category
            filingStatus: 'single',     // 'single' | 'mfj' | 'mfs' (married filing separately) | 'hoh' | 'qss' (qualifying surviving spouse)
            dependents: 0,              // children under 17
            otherDependents: 0,
            age65: 0,                   // people on the return 65 or older at the end of the year (you, your spouse)
            blind: 0,                   // people on the return who are blind
            tipsY: 0,                   // qualified tips a year (2025–2028 deduction)
            carLoanInterestY: 0,        // interest on a new US-assembled car's loan a year (2025–2028 deduction)
            matchTiers: [{ rate: 100, upTo: 3 }, { rate: 50, upTo: 2 }],   // the employer's 401(k) match
            iraContributed: 0,          // put in an IRA for this year so far
            groupLife: { coverage: 0, age: null, perCheck: 0 },   // employer group-term life: coverage $, age at year end; or the stub's GTL per paycheck
            state: 'MI',
            stateRate: null,            // % override (or the rate for a 'custom' state)
            localName: '',              // city with income tax
            localResident: true,        // false = works in the city, lives elsewhere (non-resident rate)
            localRate: 0,               // %
            schoolRate: 0,              // % school district income tax (Ohio)
            itemized: 0,                // itemized deductions (used only if above the standard deduction)
            usTax: usTax2026(),
            budgetBase: clone(BUDGET_TEMPLATE)
        });
    }

    function newState(today) {
        const t = new Date(today || Date.now());
        const iso = t.toISOString().slice(0, 10);
        const thisYear = t.getFullYear();
        const s = EC.newState(today);
        return Object.assign(s, {
            cooperativas: clone(BANKS),
            polizas: [
                { id: 1, coopName: 'Ally Bank', number: 'CD-1001', amount: 5000, rate: 4.0, days: 365, modality: 'Al Vencimiento (Simple)', maturityDate: `${thisYear + 1}-03-15` }
            ],
            goals: [
                { id: 1, name: 'Full Emergency Fund (3–6 months)', target: 15000, current: 2000, monthly: 0, rate: 4.0, createdYear: thisYear },
                { id: 2, name: 'House Down Payment', target: 30000, current: 0, monthly: 0, rate: 4.0, createdYear: thisYear }
            ],
            debts: [
                { id: 1, name: 'Credit Card', kind: 'tarjeta', balance: 3200, rate: 22.9, minPayment: 95, monthly: 150, createdYear: thisYear },
                { id: 2, name: 'Car Loan', kind: 'vehicular', balance: 14000, rate: 7.5, minPayment: 350, monthly: 350, createdYear: thisYear }
            ],
            assets: [
                { id: 1, name: 'Car', category: 'Vehículo', purchaseYear: thisYear - 2, purchaseValue: 22000, status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false, valuesByYear: {} }
            ],
            transactions: [
                { id: 1, type: 'Gasto', description: 'Weekly groceries', store: 'Meijer', parentCategory: 'Alimentación', category: 'Mercado/Supermercado', amount: 85.40, date: iso, paymentType: 'Tarjeta de Débito' },
                { id: 2, type: 'Gasto', description: 'Gas', store: 'Speedway', parentCategory: 'Transporte', category: 'Gasolina/Diesel', amount: 42.00, date: iso, paymentType: 'Tarjeta de Débito' },
                { id: 3, type: 'Ingreso', description: 'Side gig', store: 'Upwork', parentCategory: 'Ingresos Independientes', category: 'Freelance/Consultoría', amount: 300, date: iso, paymentType: 'Transferencia' }
            ],
            taxonomy: taxonomy(),
            settings: Object.assign(s.settings, { taxonomyRev: TAXONOMY_REV }),
            mortgage: { amount: 250000, rate: 6.5, years: 30, extraPayment: 0, propertyTax: 4000, homeInsurance: 1500, pmiRate: 0, hoa: 0, homeValue: 0 },
            retirement: Object.assign(s.retirement, { edadJubilacion: 67, aniosAportados: 8, tasaReemplazo: 40 })
        });
    }

    function emptyState(today) {
        const s = newState(today);
        s.polizas = []; s.goals = []; s.debts = []; s.assets = []; s.transactions = []; s.holdings = []; s.recurring = []; s.trash = []; s.accounts = [];
        return s;
    }

    // Ideas for the annual bills planner: the yearly costs that catch US families off guard.
    const annualIdeas = () => [
        { name: 'Car registration', amount: 120, every: 12, month: 3, category: 'Transporte', sub: 'Matriculación/Revisión Vehicular' },
        { name: 'Car insurance (6 months)', amount: 650, every: 6, month: 4, category: 'Transporte', sub: 'Seguro Vehicular' },
        { name: 'Amazon Prime', amount: 139, every: 12, month: 7, category: 'Suscripciones y Entretenimiento Digital' },
        { name: 'Holiday gifts', amount: 800, every: 12, month: 12, category: 'Regalos, Celebraciones y Donaciones' },
        { name: 'Back-to-school', amount: 350, every: 12, month: 8, category: 'Educación' },
        { name: 'Tax preparation', amount: 250, every: 12, month: 3, category: 'Financiero y Legal', sub: 'Preparación de Impuestos' },
        { name: 'Summer camp', amount: 600, every: 12, month: 6, category: 'Familia e Hijos' },
        { name: 'Life insurance (yearly)', amount: 420, every: 12, month: 1, category: 'Seguros y Protección' }
    ];

    // College estimator: College Board "Trends in College Pricing" 2024–25 averages (tuition,
    // fees, room and board for 4-year schools; tuition and fees for community college). Editable.
    const collegeTypes = () => [
        { id: 'in-state', label: 'Public 4-year, in-state', cost: 24920 },
        { id: 'out-state', label: 'Public 4-year, out-of-state', cost: 44090 },
        { id: 'private', label: 'Private 4-year', cost: 58600 },
        { id: 'community', label: 'Community college (living at home)', cost: 4050 }
    ];
    const collegeDefaults = { costInflation: 5, returnPct: 6 };

    // Checklists: protecting the family if something happens, and the yearly money check-up.
    const checklists = () => ({
        estate: [
            { key: 'will', label: 'Testamento (will)', why: 'Decide tú quién hereda y quién se encarga; sin él, decide el estado.' },
            { key: 'guardian', label: 'Tutor para tus hijos menores', why: 'Quién cuidaría de ellos si faltan los dos padres (se nombra en el testamento).' },
            { key: 'beneficiaries', label: 'Beneficiarios al día', why: '401(k), IRA, seguros de vida y cuentas con "transfer on death": pasan directo, sin juicio sucesorio.' },
            { key: 'poa', label: 'Poder notarial financiero (durable power of attorney)', why: 'Alguien de confianza que pueda manejar tus cuentas si no puedes hacerlo.' },
            { key: 'health', label: 'Directiva médica y poder para salud', why: 'Qué tratamientos quieres (living will) y quién decide por ti (health care proxy).' },
            { key: 'legacy', label: 'Carpeta para tu familia', why: 'Cuentas, pólizas, deudas, seguros y contraseñas en un solo lugar, y que sepan dónde está.' }
        ],
        review: [
            { key: 'networth', label: 'Actualiza tu patrimonio neto', why: 'Saldos de cuentas, inversiones y deudas al día.' },
            { key: 'insurance', label: 'Revisa tus seguros y compara precios', why: 'Coberturas suficientes y sin pagar de más.' },
            { key: 'retire1', label: 'Sube 1% tu ahorro para la jubilación', why: 'Con cada aumento de sueldo, un poco más para tu yo del futuro.' },
            { key: 'rebalance', label: 'Rebalancea tus inversiones', why: 'Vuelve a la mezcla que elegiste.' },
            { key: 'credit', label: 'Revisa tu reporte de crédito', why: 'Gratis en annualcreditreport.com: que no haya cuentas que no son tuyas.' },
            { key: 'taxes', label: 'Impuestos del año', why: 'Declara antes de abril y revisa tu W-4 para no deber ni regalarle un préstamo sin intereses al IRS.' },
            { key: 'emergency', label: 'Ajusta tu fondo de emergencia', why: '3 a 6 meses de tus gastos de hoy, no los de hace un año.' },
            { key: 'annual', label: 'Actualiza tus gastos anuales', why: 'Placas, seguros, útiles, regalos: precios nuevos.' },
            { key: 'backup', label: 'Guarda una copia de respaldo', why: 'Tu plan en un lugar seguro, fuera de este equipo.' }
        ]
    });

    const DefaultsUS = { clone, CATEGORY_ICONS: EC.CATEGORY_ICONS, categoryIcon: EC.categoryIcon, annualIdeas, collegeTypes, collegeDefaults, checklists, BUDGET_TEMPLATE, STATES, MI_CITIES, CITIES, BANKS, usTax2026, taxonomy, TAXONOMY_REV, TAXONOMY_ADDED, insertAfter, newYear, newState, emptyState, BUDGET_TYPES: EC.BUDGET_TYPES, EXPENSE_TAXONOMY: taxonomy().expense, INCOME_TAXONOMY: taxonomy().income, COOPERATIVAS: BANKS, sriBrackets: () => [] };

    if (typeof module !== 'undefined' && module.exports) module.exports = DefaultsUS;
    else root.DefaultsUS = DefaultsUS;
})(this);
