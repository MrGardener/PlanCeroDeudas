/*
 * Defaults — the starting data for a new user and for any year not yet configured.
 * Everything here is a factory returning fresh objects, so callers can mutate freely.
 */
(function (root) {
    'use strict';

    const clone = (x) => JSON.parse(JSON.stringify(x));

    const BUDGET_TEMPLATE = [
        { id: 1, name: 'Arriendo / Hipoteca', type: 'Gasto Fijo', isDeductible: true, prep: 350, real: 350, linkedCategory: 'Vivienda' },
        { id: 2, name: 'Alícuotas / Empleados Hogar', type: 'Gasto Fijo', isDeductible: true, prep: 50, real: 50, linkedCategory: 'Vivienda' },
        { id: 3, name: 'Internet y Plan Celular', type: 'Gasto Fijo', isDeductible: false, prep: 35, real: 35, linkedCategory: 'Servicios Básicos y Comunicación' },
        { id: 4, name: 'Servicios Básicos (Luz/Agua)', type: 'Gasto Fijo', isDeductible: false, prep: 30, real: 30, linkedCategory: 'Servicios Básicos y Comunicación' },
        { id: 5, name: 'Seguro Salud Privado / Vet', type: 'Gasto Fijo', isDeductible: true, prep: 60, real: 60, linkedCategory: 'Salud' },
        { id: 6, name: 'Alimentación / Víveres', type: 'Gasto Variable', isDeductible: true, prep: 250, real: 250, linkedCategory: 'Alimentación' },
        { id: 7, name: 'Educación / Matrículas / Útiles', type: 'Gasto Variable', isDeductible: true, prep: 80, real: 80, linkedCategory: 'Educación' },
        { id: 8, name: 'Prendas de Vestir / Ropa', type: 'Gasto Variable', isDeductible: true, prep: 50, real: 50, linkedCategory: 'Vestimenta' },
        { id: 9, name: 'Turismo Nacional Facturado', type: 'Gasto Variable', isDeductible: true, prep: 40, real: 40, linkedCategory: 'Viajes y Vacaciones' },
        { id: 10, name: 'Pensiones Alimenticias', type: 'Gasto Variable', isDeductible: true, prep: 0, real: 0, linkedCategory: 'Familia e Hijos' },
        { id: 11, name: 'Transporte / Gasolina', type: 'Gasto Variable', isDeductible: false, prep: 70, real: 70, linkedCategory: 'Transporte' },
        { id: 12, name: 'Entretenimiento', type: 'Gasto Variable', isDeductible: false, prep: 30, real: 30, linkedCategory: 'Entretenimiento y Ocio' },
        { id: 14, name: 'Ahorro Recurrente Póliza DPF', type: 'Ahorro', isDeductible: false, prep: 50, real: 50, linkedCategory: 'Ahorro e Inversión' },
        { id: 15, name: 'Seguro Vehicular', type: 'Gasto Fijo', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Transporte' },
        { id: 16, name: 'Mantenimiento del Hogar', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Vivienda' },
        { id: 17, name: 'Suscripciones Digitales (Streaming, etc.)', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Suscripciones y Entretenimiento Digital' },
        { id: 18, name: 'Cuidado Personal (Peluquería, Cosméticos)', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Cuidado Personal' },
        { id: 19, name: 'Mascotas', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Mascotas' },
        { id: 20, name: 'Regalos y Donaciones', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Regalos, Celebraciones y Donaciones' },
        { id: 21, name: 'Impuestos y Trámites (Predial, Matrícula)', type: 'Gasto Variable', isDeductible: false, prep: 0, real: 0, linkedCategory: 'Financiero y Legal' }
    ];

    const BUDGET_TYPES = [
        { value: 'Gasto Fijo', label: 'Gasto Fijo' },
        { value: 'Gasto Variable', label: 'Gasto Variable' },
        { value: 'Deuda', label: 'Pago Deuda' },
        { value: 'Ahorro', label: 'Ahorro/Inversión' }
    ];

    // Adapted from a broad household category list to Ecuador's dollarized, cash/DPF economy.
    const EXPENSE_TAXONOMY = {
        'Vivienda': ['Arriendo', 'Hipoteca', 'Alícuotas/Condominio', 'Impuesto Predial', 'Seguro de Hogar', 'Mantenimiento del Hogar', 'Reparaciones (plomería, eléctrico, techo)', 'Muebles y Electrodomésticos', 'Jardinería/Limpieza del Hogar'],
        'Servicios Básicos y Comunicación': ['Agua', 'Energía Eléctrica', 'Gas', 'Internet', 'Plan Celular', 'Cable/TV'],
        'Transporte': ['Cuota de Vehículo (Préstamo)', 'Gasolina/Diesel', 'Seguro Vehicular', 'Mantenimiento (aceite, llantas, frenos)', 'Matriculación/Revisión Vehicular', 'Pasajes/Bus', 'Taxi/App de Transporte', 'Parqueo', 'Peajes', 'Alquiler de Vehículo'],
        'Alimentación': ['Mercado/Supermercado', 'Mercado Municipal/Ferias', 'Restaurantes', 'Comida Rápida', 'Delivery a Domicilio', 'Cafetería', 'Panadería'],
        'Suscripciones y Entretenimiento Digital': ['Streaming de Video', 'Streaming de Música', 'Almacenamiento en la Nube', 'Software/Herramientas', 'Videojuegos'],
        'Entretenimiento y Ocio': ['Cine', 'Conciertos/Eventos', 'Salidas y Paseos', 'Turismo Nacional', 'Hobbies', 'Libros', 'Suscripciones de Revistas/Periódicos'],
        'Cuidado Personal': ['Peluquería/Barbería', 'Manicure/Pedicure', 'Spa/Masajes', 'Cosméticos y Perfumería', 'Higiene Personal'],
        'Vestimenta': ['Ropa y Calzado', 'Ropa de Trabajo', 'Reparación de Ropa/Zapatos', 'Lavandería/Tintorería'],
        'Salud': ['Seguro Médico', 'Consultas Médicas', 'Medicinas', 'Odontología', 'Óptica', 'Terapia/Salud Mental', 'Exámenes de Laboratorio'],
        'Educación': ['Colegiatura/Pensión', 'Matrícula Universitaria', 'Útiles Escolares', 'Uniformes', 'Libros y Material Educativo', 'Cursos/Capacitación', 'Clases Particulares/Tutoría'],
        'Familia e Hijos': ['Guardería/Niñera', 'Pañales y Artículos de Bebé', 'Juguetes', 'Actividades Extracurriculares', 'Pensión Alimenticia'],
        'Mascotas': ['Alimento para Mascotas', 'Veterinario', 'Peluquería Canina', 'Accesorios'],
        'Deudas': ['Tarjeta de Crédito', 'Préstamo Personal', 'Préstamo Vehicular', 'Préstamo Estudiantil', 'Préstamos entre Familiares'],
        'Seguros y Protección': ['Seguro de Vida', 'Seguro de Vida de Deudor'],
        'Financiero y Legal': ['Comisiones Bancarias', 'Trámites Legales/Notaría', 'Asesoría Contable/Tributaria', 'Multas y Trámites Municipales'],
        'Ahorro e Inversión': ['Aporte DPF', 'Fondo de Emergencia', 'Aporte a Metas', 'Aporte Voluntario IESS', 'Inversiones (bolsa)'],
        'Viajes y Vacaciones': ['Vuelos', 'Hospedaje', 'Alquiler de Auto de Viaje', 'Seguro de Viaje', 'Pasaportes/Visas', 'Equipaje'],
        'Regalos, Celebraciones y Donaciones': ['Regalos de Cumpleaños', 'Regalos Navideños/Bodas/Baby Showers', 'Diezmo/Donaciones Religiosas', 'Donaciones Benéficas', 'Fiestas/Celebraciones'],
        'Remesas y Ayuda Familiar': ['Remesa Enviada al Exterior', 'Ayuda Económica a Familiares'],
        'Negocio Propio / Freelance': ['Software/Herramientas de Negocio', 'Publicidad/Marketing', 'Insumos/Inventario', 'Envíos y Empaque', 'Espacio de Trabajo/Coworking'],
        'Otros': ['Imprevistos', 'Multas', 'Otros Gastos']
    };

    const INCOME_TAXONOMY = {
        'Ingresos Laborales': ['Sueldo/Salario', 'Horas Extras', 'Bonos', 'Comisiones', 'Décimo Tercero', 'Décimo Cuarto'],
        'Ingresos Independientes': ['Freelance/Consultoría', 'Ventas de Negocio Propio', 'Honorarios Profesionales'],
        'Remesas del Exterior': ['Remesa Familiar (EE.UU.)', 'Remesa Familiar (España)', 'Remesa Familiar (Otro País)'],
        'Ingresos Financieros': ['Interés DPF/Pólizas', 'Dividendos', 'Alquiler de Propiedad (que recibes)'],
        'Gobierno y Beneficios': ['Bono de Desarrollo Humano', 'Devolución de Impuestos (SRI)', 'Pensión IESS'],
        'Otros Ingresos': ['Regalos Recibidos', 'Herencias', 'Venta de Artículos Usados', 'Reembolsos']
    };

    // SRI income-tax table for 2026 (Resolución NAC-DGERCGC25-00000043). It changes every year:
    // editable in Configuración → Parámetros legales.
    const SRI_TABLE_YEAR = 2026;
    const sriBrackets = () => [
        { min: 0, max: 12208, baseTax: 0, rate: 0 },
        { min: 12208, max: 15549, baseTax: 0, rate: 0.05 },
        { min: 15549, max: 20188, baseTax: 167, rate: 0.10 },
        { min: 20188, max: 26700, baseTax: 631, rate: 0.12 },
        { min: 26700, max: 35136, baseTax: 1412, rate: 0.15 },
        { min: 35136, max: 46575, baseTax: 2678, rate: 0.20 },
        { min: 46575, max: 62005, baseTax: 4965, rate: 0.25 },
        { min: 62005, max: 82679, baseTax: 8823, rate: 0.30 },
        { min: 82679, max: 109956, baseTax: 15025, rate: 0.35 },
        { min: 109956, max: 999999999, baseTax: 24572, rate: 0.37 }
    ];

    function newYear() {
        return {
            sueldo: 1500,
            tasa: 8.5,
            annualMode: 'base12',
            d3: false,
            d4: false,
            d4Region: 'costa',
            sweepSavings: false,
            iessRate: 9.45,
            sbu: 482,                // salario básico unificado 2026 (Acuerdo MDT-2025-195)
            canasta: 821.80,         // canasta familiar básica, enero 2026 (INEC)
            cosede: 32000,
            cargas: 0,               // family dependents: sets the cap for personal expenses
            sriRebajaRate: 18,       // % of personal expenses taken off the tax
            taxTableYear: SRI_TABLE_YEAR,
            netWorth: { checking: 0, savings: 0, investments: 0, mortgage: 0, autoLoans: 0, creditCards: 0, personalLoans: 0, studentLoans: 0, otherDebts: 0 },
            netWorthTouched: {},
            budgetBase: clone(BUDGET_TEMPLATE),
            // Income besides the salary, every month: { id, name, amount, category }.
            otherIncomes: [],
            // What the employer takes from each paycheck besides IESS and income tax (seguros,
            // pensión alimenticia, préstamos IESS, ahorro voluntario…), per month:
            // { id, name, group, kind, monthly, pretax, debtId? }.
            payDeductions: [],
            monthOverrides: {},
            sriBrackets: sriBrackets()
        };
    }

    const COOPERATIVAS = [
        { id: 1, name: 'JEP (Juventud Ecuatoriana Progresista)', segment: 'Segmento 1', defaultRate: 9.0, interestType: 'Al Vencimiento (Simple)', cosedeMax: 32000 },
        { id: 2, name: 'Jardín Azuayo', segment: 'Segmento 1', defaultRate: 8.5, interestType: 'Mensual (Compuesto)', cosedeMax: 32000 },
        { id: 3, name: 'Cooperativa Politécnica', segment: 'Segmento 1', defaultRate: 8.75, interestType: 'Mensual (Compuesto)', cosedeMax: 32000 },
        { id: 4, name: 'CoopProgreso', segment: 'Segmento 1', defaultRate: 8.8, interestType: 'Al Vencimiento (Simple)', cosedeMax: 32000 },
        { id: 5, name: 'Alianza del Valle', segment: 'Segmento 1', defaultRate: 8.6, interestType: 'Mensual (Compuesto)', cosedeMax: 32000 }
    ];

    function newState(today) {
        const t = new Date(today || Date.now());
        const iso = t.toISOString().slice(0, 10);
        const thisYear = t.getFullYear();
        return {
            version: 8,
            configStartYear: 2020,
            configEndYear: 2050,
            activeYear: Math.min(2050, Math.max(2020, thisYear)),
            years: {},
            baselines: [],
            cooperativas: clone(COOPERATIVAS),
            polizas: [
                { id: 1, coopName: 'JEP (Juventud Ecuatoriana Progresista)', number: 'DPF-88492', amount: 5000, rate: 9.0, days: 361, modality: 'Al Vencimiento (Simple)', maturityDate: `${thisYear}-12-15` },
                { id: 2, coopName: 'Jardín Azuayo', number: 'DPF-10294', amount: 3000, rate: 8.5, days: 180, modality: 'Mensual (Compuesto)', maturityDate: `${thisYear + 1}-03-30` }
            ],
            goals: [
                { id: 1, name: 'Fondo de Reserva Pleno', target: 5000, current: 1000, monthly: 0, rate: 8.5, createdYear: thisYear },
                { id: 2, name: 'Terreno / Lote', target: 20000, current: 0, monthly: 0, rate: 8.5, createdYear: thisYear }
            ],
            debts: [
                { id: 1, name: 'Tarjeta de Crédito', kind: 'tarjeta', balance: 1500, rate: 42, minPayment: 60, monthly: 83.25, createdYear: thisYear },
                { id: 2, name: 'Préstamo Vehicular', kind: 'vehicular', balance: 6000, rate: 11, minPayment: 180, monthly: 180, createdYear: thisYear }
            ],
            assets: [
                { id: 1, name: 'Casa Principal', category: 'Bienes Raíces', purchaseYear: 2022, purchaseValue: 120000, status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false, valuesByYear: {} }
            ],
            transactions: [
                { id: 1, type: 'Gasto', description: 'Compras de la semana', store: 'Supermaxi', parentCategory: 'Alimentación', category: 'Mercado/Supermercado', amount: 45.50, date: iso, paymentType: 'Tarjeta de Débito' },
                { id: 2, type: 'Gasto', description: 'Pasaje bus', store: 'Cooperativa de Transporte', parentCategory: 'Transporte', category: 'Pasajes/Bus', amount: 0.35, date: iso, paymentType: 'Efectivo' },
                { id: 3, type: 'Ingreso', description: 'Remesa mensual de mi hermano', store: 'Western Union', parentCategory: 'Remesas del Exterior', category: 'Remesa Familiar (EE.UU.)', amount: 200, date: iso, paymentType: 'Tarjeta de Débito' }
            ],
            taxonomy: { expense: clone(EXPENSE_TAXONOMY), income: clone(INCOME_TAXONOMY) },
            settings: { retireWhatIfMax: 500, mortgageWhatIfMax: 2000, mortgageSystem: 'frances', welcomeDismissed: false, lastBackupAt: null, currency: 'USD', importProfiles: {}, priceProvider: 'finnhub', priceKey: '', paydays: [], paySchedule: null, cashBuffer: 0, alertsDismissed: {}, flowExclude: [], flowIntroSeen: false, dismissedEvents: [], taxonomyRev: 0 },
            // "Description contains X → category / budget line", used on import and new transactions.
            rules: [],
            // Investments: { id, ticker, name, kind, shares, price, priceAt, auto }
            holdings: [],
            // Household members: { id, name, color }. Transactions can say who (memberId).
            members: [],
            // Money you know is coming in or going out: { id, date, name, amount (+ in, − out),
            // frequency? ('once' | 'weekly' | 'biweekly' | 'monthly' | 'monthlyNth' | 'quarterly' |
            // 'yearly'), key?, category?, accountId? }. Forecast only (never posted): shown on the
            // cash flow chart, the money calendar and the month's events.
            cashEvents: [],
            // Repeating / scheduled transactions (posted automatically when due).
            recurring: [],
            // Deleted transactions, restorable for 60 days.
            trash: [],
            // Excluded transactions (a duplicate, a reimbursed work expense…): kept and shown with
            // the "Excluded" filter, but no budget, report or total counts them.
            excludedTxns: [],
            // Money accounts: { id, name, kind: 'corriente'|'ahorros'|'efectivo', balance, updatedAt }.
            // Cards and loans are debts (Deudas y Metas), so they're never counted twice.
            accounts: [],
            // Yearly / irregular bills to set money aside for: { id, name, amount, every, month, category, sub }.
            annualBills: [],
            // Months reviewed with "Cerrar el mes": 'YYYY-MM' → { closedAt, income, spent, leftover, planned, note }.
            monthCloses: {},
            // Net worth month by month ({ month: 'YYYY-MM', assets, liabilities, value }), kept on its own.
            netWorthHistory: [],
            // Milestones reached: key → 'YYYY-MM-DD' (or 'antes' when it was already true). null until first checked.
            milestones: null,
            // "¿Y si pierdo mi trabajo?": lines kept or cut, income that continues, benefit, severance.
            runway: { keep: {}, other: null, benefit: 0, benefitMonths: 0, lump: 0 },
            // Revisión de seguros: answers (key → 'si' | 'no'), total life coverage, dependents (null = guess).
            insurance: { answers: {}, life: 0, dependents: null },
            // College estimator: kids { id, name, age, type, years, cost (null = type default), saved, monthly, goalId }.
            college: { kids: [], costInflation: null, returnPct: null },
            // Checklists: estate { key: 'YYYY-MM-DD' } and the yearly review { 'YYYY': { key: date } }.
            checklists: { estate: {}, review: {} },
            // Target mix of your investments, % per asset class { us, intl, bonds, cash, other } (null = not set).
            investTarget: null,
            mortgage: { amount: 80000, rate: 10.5, years: 20, extraPayment: 0 },
            // tasaRetorno/sueldoPromedio: null means "linked" (follow the active year's DPF rate /
            // sueldo); a number is the user's deliberate override for a what-if scenario.
            retirement: { edadActual: 30, edadJubilacion: 65, aporteMensual: 100, tasaRetiroSegura: 4, aniosAportados: 5, tasaReemplazo: 60, tasaRetorno: null, inflacion: null, sueldoPromedio: null, whatIfExtra: 0, ingresoDeseado: null },
            debtPlan: { strategy: 'snowball', extraPayment: 0 }
        };
    }

    // A fully empty model (for "Borrar Todo") — keeps the reference catalogs
    // (taxonomies, cooperativas) because they are configuration, not personal data.
    function emptyState(today) {
        const s = newState(today);
        s.polizas = []; s.goals = []; s.debts = []; s.assets = []; s.transactions = []; s.holdings = []; s.recurring = []; s.trash = []; s.accounts = []; s.annualBills = []; s.monthCloses = {}; s.netWorthHistory = []; s.milestones = null;
        return s;
    }

    // Ideas for the annual bills planner: the yearly costs that catch Ecuadorian families off guard.
    const annualIdeas = () => [
        { name: 'Matrícula vehicular', amount: 180, every: 12, month: 4, category: 'Transporte', sub: 'Matriculación/Revisión Vehicular' },
        { name: 'Seguro del carro', amount: 650, every: 12, month: 6, category: 'Seguros y Protección' },
        { name: 'Impuesto predial', amount: 220, every: 12, month: 1, category: 'Vivienda' },
        { name: 'Útiles y uniformes escolares', amount: 300, every: 12, month: 9, category: 'Educación' },
        { name: 'Matrícula del colegio', amount: 250, every: 12, month: 8, category: 'Educación' },
        { name: 'Regalos de Navidad', amount: 400, every: 12, month: 12, category: 'Regalos, Celebraciones y Donaciones' },
        { name: 'Declaración del impuesto a la renta', amount: 60, every: 12, month: 3, category: 'Financiero y Legal' },
        { name: 'Mantenimiento del carro', amount: 200, every: 6, month: 5, category: 'Transporte' }
    ];

    // College estimator: the kinds of studies and a yearly cost to start from (approximate; editable).
    const collegeTypes = () => [
        { id: 'publica', label: 'Universidad pública (gastos de vida)', cost: 2400 },
        { id: 'privada', label: 'Universidad privada', cost: 6000 },
        { id: 'privada-top', label: 'Universidad privada de élite', cost: 11000 },
        { id: 'exterior', label: 'Estudios en el exterior', cost: 30000 }
    ];
    const collegeDefaults = { costInflation: 3, returnPct: 7 };

    // Checklists: protecting the family if something happens, and the yearly money check-up.
    const checklists = () => ({
        estate: [
            { key: 'will', label: 'Testamento ante notario', why: 'Decide tú quién hereda y evita años de trámites a tu familia.' },
            { key: 'guardian', label: 'Tutor para tus hijos menores', why: 'Quién cuidaría de ellos si faltan los dos padres (va en el testamento).' },
            { key: 'beneficiaries', label: 'Beneficiarios al día', why: 'Seguros de vida, cuentas, pólizas y el montepío del IESS.' },
            { key: 'poa', label: 'Poder notarial', why: 'Alguien de confianza que pueda manejar tus cuentas si no puedes hacerlo.' },
            { key: 'health', label: 'Tus decisiones médicas por escrito', why: 'Qué tratamientos quieres y quién decide por ti si no puedes.' },
            { key: 'legacy', label: 'Carpeta para tu familia', why: 'Cuentas, pólizas, deudas, seguros y contraseñas en un solo lugar, y que sepan dónde está.' }
        ],
        review: [
            { key: 'networth', label: 'Actualiza tu patrimonio neto', why: 'Saldos de cuentas, inversiones y deudas al día.' },
            { key: 'insurance', label: 'Revisa tus seguros y compara precios', why: 'Coberturas suficientes y sin pagar de más.' },
            { key: 'retire1', label: 'Sube 1% tu ahorro para la jubilación', why: 'Con cada aumento de sueldo, un poco más para tu yo del futuro.' },
            { key: 'rebalance', label: 'Rebalancea tus inversiones', why: 'Vuelve a la mezcla que elegiste.' },
            { key: 'credit', label: 'Revisa tu historial de crédito', why: 'En la Superintendencia de Bancos o un buró, gratis: que no haya deudas que no son tuyas.' },
            { key: 'taxes', label: 'Impuestos del año', why: 'Proyección de gastos personales a tu empleador (enero) y declaración del impuesto a la renta (marzo).' },
            { key: 'emergency', label: 'Ajusta tu fondo de emergencia', why: '3 a 6 meses de tus gastos de hoy, no los de hace un año.' },
            { key: 'annual', label: 'Actualiza tus gastos anuales', why: 'Matrícula, seguros, útiles, Navidad: precios nuevos.' },
            { key: 'backup', label: 'Guarda una copia de respaldo', why: 'Tu plan en un lugar seguro, fuera de este equipo.' }
        ]
    });

    // An icon per expense category (bubbles, spending); anything else gets the generic one.
    const CATEGORY_ICONS = {
        'Vivienda': 'fa-house', 'Servicios Básicos y Comunicación': 'fa-lightbulb', 'Transporte': 'fa-car', 'Alimentación': 'fa-utensils',
        'Suscripciones y Entretenimiento Digital': 'fa-tv', 'Entretenimiento y Ocio': 'fa-film', 'Cuidado Personal': 'fa-spa', 'Vestimenta': 'fa-shirt',
        'Salud': 'fa-heart-pulse', 'Educación': 'fa-graduation-cap', 'Familia e Hijos': 'fa-children', 'Mascotas': 'fa-paw', 'Deudas': 'fa-credit-card',
        'Seguros y Protección': 'fa-shield-heart', 'Financiero y Legal': 'fa-scale-balanced', 'Ahorro e Inversión': 'fa-piggy-bank',
        'Viajes y Vacaciones': 'fa-plane', 'Regalos, Celebraciones y Donaciones': 'fa-gift', 'Remesas y Ayuda Familiar': 'fa-hand-holding-dollar',
        'Negocio Propio / Freelance': 'fa-briefcase', 'Otros': 'fa-ellipsis',
        // US edition only.
        'Compras': 'fa-bag-shopping', 'Pasatiempos': 'fa-palette', 'Impuestos': 'fa-landmark'
    };
    const categoryIcon = (c) => CATEGORY_ICONS[c] || 'fa-tag';

    const Defaults = { clone, CATEGORY_ICONS, categoryIcon, annualIdeas, collegeTypes, collegeDefaults, checklists, BUDGET_TEMPLATE, BUDGET_TYPES, EXPENSE_TAXONOMY, INCOME_TAXONOMY, COOPERATIVAS, sriBrackets, newYear, newState, emptyState };

    if (typeof module !== 'undefined' && module.exports) module.exports = Defaults;
    else root.Defaults = Defaults;
})(this);
