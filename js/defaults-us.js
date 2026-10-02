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
            hoh: [[0, 0.10], [17700, 0.12], [67450, 0.22], [105700, 0.24], [201750, 0.32], [256200, 0.35], [640600, 0.37]]
        },
        stdDeduction: { single: 16100, mfj: 32200, hoh: 24150 },
        childCredit: 2200,          // per qualifying child under 17
        otherDependentCredit: 500,
        // Both credits drop $50 per $1,000 of income above these amounts (IRC §24(b)).
        ctcPhaseoutStart: { single: 200000, mfj: 400000, hoh: 200000 }, ctcPhaseoutStep: 50,
        ssRate: 6.2, ssWageBase: 184500,
        medicareRate: 1.45, addlMedicareRate: 0.9, addlMedicareThreshold: { single: 200000, mfj: 250000, hoh: 200000 }, addlMedicareWithholding: 200000,
        // Contribution limits (for warnings)
        limit401k: 24500, catchUp401k: 8000, limitIRA: 7500, limitHSA: { self: 4400, family: 8750 },
        // Social Security benefit formula (PIA bend points, full retirement age 67)
        ssBend1: 1286, ssBend2: 7749, ssFullAge: 67
    });

    // ------------------------------------------------------------------ states
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
    ].map(([code, name, type = 'custom', rate = null, exemption = 0, taxes401k = false]) => ({ code, name, type, rate, exemption, taxes401k }));

    // Michigan cities with an income tax (Uniform City Income Tax Ordinance): resident rate, the
    // non-resident rate (half) for people who only work there, and the exemption per person
    // ($600 in most cities). Verify each year with your city.
    const MI_CITIES = [
        ['Detroit', 2.4], ['Grand Rapids', 1.5], ['Highland Park', 2.0], ['Saginaw', 1.5], ['Albion', 1.0], ['Battle Creek', 1.0], ['Benton Harbor', 1.0], ['Big Rapids', 1.0],
        ['East Lansing', 1.0], ['Flint', 1.0], ['Grayling', 1.0], ['Hamtramck', 1.0], ['Hudson', 1.0], ['Ionia', 1.0], ['Jackson', 1.0], ['Lansing', 1.0],
        ['Lapeer', 1.0], ['Muskegon', 1.0], ['Muskegon Heights', 1.0], ['Pontiac', 1.0], ['Port Huron', 1.0], ['Portland', 1.0], ['Springfield', 1.0], ['Walker', 1.0]
    ].map(([name, rate]) => ({ name, rate, nonresident: rate / 2, exemption: 600 }));

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

    // The Ecuador taxonomy with US items (same category codes, so matching keeps working).
    function taxonomy() {
        const exp = clone(EC.EXPENSE_TAXONOMY), inc = clone(EC.INCOME_TAXONOMY);
        exp['Vivienda'] = ['Arriendo', 'Hipoteca', 'Alícuotas/Condominio', 'Impuesto Predial', 'Seguro de Hogar', 'Seguro de Inquilino', 'Mantenimiento del Hogar', 'Reparaciones (plomería, eléctrico, techo)', 'Muebles y Electrodomésticos', 'Jardinería/Limpieza del Hogar'];
        exp['Transporte'] = ['Cuota de Vehículo (Préstamo)', 'Gasolina/Diesel', 'Seguro Vehicular', 'Mantenimiento (aceite, llantas, frenos)', 'Matriculación/Revisión Vehicular', 'Transporte Público', 'Taxi/App de Transporte', 'Parqueo', 'Peajes', 'Alquiler de Vehículo'];
        exp['Ahorro e Inversión'] = ['Fondo de Emergencia', 'Aporte a Metas', 'Certificado de Depósito (CD)', '401(k) / IRA', 'Plan 529 (universidad)', 'Cuenta HSA'];
        exp['Salud'] = ['Seguro Médico', 'Copagos y Deducibles', 'Consultas Médicas', 'Medicinas', 'Odontología', 'Óptica', 'Terapia/Salud Mental', 'Exámenes de Laboratorio'];
        exp['Financiero y Legal'] = ['Comisiones Bancarias', 'Trámites Legales/Notaría', 'Preparación de Impuestos', 'Multas y Trámites Municipales'];
        delete exp['Remesas y Ayuda Familiar'];
        exp['Remesas y Ayuda Familiar'] = ['Remesa Enviada al Exterior', 'Ayuda Económica a Familiares'];
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
            sueldo: 5000,               // gross pay per month
            tasa: 4.0,                  // savings / CD rate (APY %)
            d3: false, d4: false, iessRate: 0, sbu: 0, canasta: 0, sriCapMultiplier: 0, sriBrackets: [],
            cosede: 250000,             // FDIC / NCUA coverage per depositor, per bank, per ownership category
            filingStatus: 'single',     // 'single' | 'mfj' | 'hoh'
            dependents: 0,              // children under 17
            otherDependents: 0,
            state: 'MI',
            stateRate: null,            // % override (or the rate for a 'custom' state)
            localName: '',              // city with income tax
            localResident: true,        // false = works in the city, lives elsewhere (non-resident rate)
            localRate: 0,               // %
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
            mortgage: { amount: 250000, rate: 6.5, years: 30, extraPayment: 0, propertyTax: 4000, homeInsurance: 1500, pmiRate: 0, hoa: 0, homeValue: 0 },
            retirement: Object.assign(s.retirement, { edadJubilacion: 67, aniosAportados: 8, tasaReemplazo: 40 })
        });
    }

    function emptyState(today) {
        const s = newState(today);
        s.polizas = []; s.goals = []; s.debts = []; s.assets = []; s.transactions = []; s.holdings = []; s.recurring = []; s.trash = []; s.accounts = [];
        return s;
    }

    const DefaultsUS = { clone, BUDGET_TEMPLATE, STATES, MI_CITIES, BANKS, usTax2026, taxonomy, newYear, newState, emptyState, BUDGET_TYPES: EC.BUDGET_TYPES, EXPENSE_TAXONOMY: taxonomy().expense, INCOME_TAXONOMY: taxonomy().income, COOPERATIVAS: BANKS, sriBrackets: () => [] };

    if (typeof module !== 'undefined' && module.exports) module.exports = DefaultsUS;
    else root.DefaultsUS = DefaultsUS;
})(this);
