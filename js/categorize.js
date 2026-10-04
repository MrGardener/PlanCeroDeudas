/*
 * Categorize: reads a bank or card statement line and makes an educated guess of what it is.
 *
 *  - parse(text): bank text often comes in several lines ("DEPOSIT ACME TOOLS INC<br />TYPE:
 *    PAYROLL  ID: …<br />CO: ACME TOOLS INC"; "Card purchase<br />GROCERY OUTLET #123
 *    SPRINGFIELD IL<br />Date 03/14/26 *0000*1234567 5411"). It finds the direction (money in /
 *    out / between your accounts), the company or merchant, the ACH type and the card's merchant
 *    category code (MCC, the 4 digits at the end of a card line), and a clean name to show.
 *  - guess(info, { sign, country }): { type, category, sub, confidence, why, key } — first strong
 *    words (payroll, tax refund, investments, mortgage, utilities, card payments), then the MCC,
 *    then well-known stores, then the bare direction (DEPOSIT → income, WITHDRAWAL → expense).
 *    `key` is the word a rule would use next time (the company or store name).
 *
 * Categories are the app's own (Spanish keys, shown translated). Nothing here touches the page.
 */
(function (root) {
    'use strict';
    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

    // ------------------------------------------------------------------ reading the text
    const LINE_SPLIT = /<br\s*\/?>|\r?\n|\s*%%\s*/i;
    const DIRECTION = [
        // Between your own accounts: credit-card payments, transfers between shares/loans.
        [/credit card pa?yme?nt|payments? transfer|transfer (?:to|from) (?:loan|share|savings|checking|credit card)|\btransfer (?:to|from)\b.*\bshare\b|online transfer|internal transfer|autopay.*card|pago (?:de )?tarjeta|transferencia (?:entre|a) (?:mis|cuentas propias)/, 'transfer'],
        [/^(?:deposit|dep\b|credit\b|ach credit|direct dep|payroll|refund|deposito|abono|acreditacion|nomina)/, 'in'],
        [/^(?:withdrawal|withdraw|debit|ach debit|purchase|pos\b|checkcard|check\b|draft|loan advance|payment|bill pay|atm|retiro|debito|compra|pago|cargo)/, 'out']
    ];
    // Leading words that say what kind of movement it is, not who it's with.
    const LEADING = /^(?:(?:withdrawal|deposit)\s+transfer\b|transferencia (?:recibida|enviada)(?: de| a)?|withdrawal|deposit(?: by check)?|ach (?:debit|credit)|debit card purchase|pos purchase|pos|purchase|recurring payment|checkcard(?: \d+)?|loan advance (?:credit card|bill payment(?: #\*?\d+)?)|payments?|online payment|bill pay(?:ment)?|retiro|deposito|compra|pago|debito|credito|transferencia)\b[\s,:-]*/i;

    // Well-known names → how to show them (and what a rule should look for).
    const BRANDS = [
        [/amazon|amzn/, 'Amazon'], [/wal-?mart|walmart|\bwm supercenter/, 'Walmart'], [/meijer/, 'Meijer'], [/kroger/, 'Kroger'], [/costco/, 'Costco'],
        [/sam\x27?s ?club|samsclub/, "Sam's Club"], [/target\b/, 'Target'], [/aldi\b/, 'Aldi'], [/whole ?foods/, 'Whole Foods'], [/trader joe/, "Trader Joe's"],
        [/lowe\x27?s/, "Lowe's"], [/home ?depot/, 'Home Depot'], [/menards/, 'Menards'], [/\blyft\b/, 'Lyft'], [/\buber ?eats/, 'Uber Eats'], [/\buber\b/, 'Uber'],
        [/doordash/, 'DoorDash'], [/grubhub/, 'Grubhub'], [/starbucks/, 'Starbucks'], [/mcdonald/, "McDonald's"], [/chick-?fil-?a/, 'Chick-fil-A'],
        [/netflix/, 'Netflix'], [/spotify/, 'Spotify'], [/hulu/, 'Hulu'], [/disney ?(?:\+|plus)/, 'Disney+'], [/apple\.com|itunes/, 'Apple'], [/google/, 'Google'],
        [/great clips/, 'Great Clips'], [/vanguard/, 'Vanguard'], [/fidelity/, 'Fidelity'], [/schwab/, 'Charles Schwab'], [/progressive/, 'Progressive'],
        [/geico/, 'GEICO'], [/state farm/, 'State Farm'], [/dte energy|\bdte\b/, 'DTE Energy'], [/consumers energy/, 'Consumers Energy'],
        [/irs\s*treas|us treasury 310|tax ref|^irs\b/, 'IRS'], [/state ?of ?michigan/, 'State of Michigan'], [/cvs/, 'CVS'], [/walgreens/, 'Walgreens'], [/shell\b/, 'Shell'], [/speedway/, 'Speedway'],
        [/supermaxi|megamaxi/, 'Supermaxi'], [/mi comisariato/, 'Mi Comisariato'], [/fybeca/, 'Fybeca']
    ];

    const title = (s) => s.toLowerCase().replace(/(^|[\s\-/&(])([a-z])/g, (m, a, b) => a + b.toUpperCase()).replace(/\x27S\b/g, "'s");

    // Card merchant line: "GROCERY OUTLET #123 SPRINGFIELD IL" → "GROCERY OUTLET"; "GOLDEN DRAGON 217-5550100 IL" → "GOLDEN DRAGON".
    function cleanMerchant(s) {
        let m = String(s || '').trim();
        for (let k = 0; k < 3 && /^(?:[a-z]{2,6}\s?\*\s?|sp\s+(?=[A-Z]))/i.test(m); k++) m = m.replace(/^(?:[a-z]{2,6}\s?\*\s?|sp\s+(?=[A-Z]))/i, '');
        m = m.replace(/^\d{3,}\s+/, '');
        // "LINDBERG'S BLUEBERR Coopersville MI": a mixed-case city after an all-caps name.
        m = m.replace(/^(.*?[A-Z0-9\x27&.)]{2,})((?:\s+[A-Z][a-z][\w.\x27-]*)+)(\s+[A-Z]{2})?$/, '$1');
        m = m.replace(/\s+(?:\+?1?[\s-]?)?\(?\d{3}\)?[\s-]?\d{3}-?\d{4}\b.*$/, '');      // phone and what follows
        m = m.replace(/\s*[#*]\s*[\w-]*\d[\w-]*.*$/, '');                                // store number / order code and what follows
        m = m.replace(/\s+(?:[a-z0-9.-]+\.(?:com|net|org)\S*).*$/i, '');                  // amzn.com/bill …
        m = m.replace(/\s+[A-Z]{2}$/, '');                                                // state at the end
        m = m.replace(/\s+\d{3,}\b.*$/, '');                                             // "TACO PLACE 4410 SPRINGFIELD"
        // Card networks give the merchant name 23 characters and then the city: cut there.
        if (m.length > 23) { const cut = m.slice(0, 23); m = /\s/.test(m.charAt(23)) ? cut : cut.replace(/\s+\S*$/, ''); }
        return m.replace(/[\s,.-]+$/, '').trim();
    }

    function parse(text) {
        const raw = String(text || '');
        const lines = raw.split(LINE_SPLIT).map(l => l.trim()).filter(Boolean);
        const all = lines.join(' ');
        // "CO: ACME TOOLS INC", "TYPE: PAYROLL  ID: …": each field, from its own line.
        const field = (name) => {
            const re = new RegExp(`(?:^|\\s)${name}:\\s*(.+?)(?=\\s{2,}|\\s+(?:TYPE|ID|DATA|CO|NAME|CONFIRMATION #?):|$)`, 'i');
            for (const l of lines) { const m = l.match(re); if (m) return m[1].trim(); }
            return '';
        };
        const first = lines[0] || '';
        const n = norm(first);
        const lower = norm(all);
        let direction = null;
        for (const [re, d] of DIRECTION) { if (re.test(d === 'transfer' ? lower : n)) { direction = d; break; } }
        const company = field('CO').replace(/\s*,\s*-?[\w.]{0,6}$/, '').replace(/\s+(?:inc|llc|corp|co)\.?$/i, '').trim();
        const achType = field('TYPE');
        const data = field('DATA');
        // Card purchase: the merchant is on the second line, the MCC at the end of the "Date …" line.
        const isCard = /loan advance|card purchase|checkcard|pos purchase|debit card/i.test(first);
        const dateLine = lines.find(l => /^date \d/i.test(l)) || '';
        const mccMatch = dateLine.match(/\s(\d{4})\s*$/);
        let merchant = '';
        if (isCard && lines[1]) merchant = cleanMerchant(lines[1]);
        let rest = first.replace(LEADING, '').replace(/\s*CONFIRMATION #?:.*$/i, '').trim();
        const check = (first + ' ' + (lines[1] || '')).match(/(?:draft|check|cheque)(?: number| #|\s+no\.?)?\s*(\d{2,})/i);
        // The best name to show: the company (ACH), the card merchant, or what is left of the first line.
        // A memo the person typed on a transfer ("new couch", "Rent share").
        const last = lines[lines.length - 1] || '';
        const memo = lines.length > 1 && !/^(?:type|data|co|name|id|confirmation|date|ach|withdrawal|deposit)\b/i.test(last) && !/^(?:to|from)\s/i.test(last) && last !== first ? last : '';
        let name = company || merchant || cleanMerchant(rest);
        if (!name || /^(?:withdrawal|deposit|transfer|by check|(?:to|from) (?:loan|share)\b.*)$/i.test(name)) name = '';
        const cash = /(?:^|\s)(?:atm|cajero)\b|cash withdrawal|retiro (?:en|de) efectivo/i.test(all);
        if (cash) name = 'Retiro de efectivo';
        if (direction === 'transfer' || /^(?:withdrawal|deposit) transfer\b|^transfer\b/i.test(first)) name = memo && !/^transfer$/i.test(memo) ? memo : /credit card/i.test(all) ? 'Pago de tarjeta de crédito' : 'Transferencia';
        const brandText = norm(`${name} ${isCard ? lines[1] || '' : first}`);
        const brand = direction === 'transfer' ? null : BRANDS.find(([re]) => re.test(brandText));
        const display = brand ? brand[1] : name ? (name === name.toUpperCase() ? title(name) : name) : '';
        return { raw, lines, direction, cash, company, merchant, achType, data, mcc: mccMatch ? Number(mccMatch[1]) : null, isCard, check: check ? check[1] : null, name: display, brand: brand ? brand[1] : null, memo, text: lower };
    }

    // ------------------------------------------------------------------ merchant category codes
    // ISO 18245 codes card networks attach to every purchase → [category, subcategory].
    const MCC = [
        [[5411, 5422, 5441, 5451, 5499, 5300], 'Alimentación', 'Mercado/Supermercado'], [[5462], 'Alimentación', 'Panadería'],
        [[5812], 'Alimentación', 'Restaurantes'], [[5814], 'Alimentación', 'Comida Rápida'], [[5813], 'Entretenimiento y Ocio', 'Salidas y Paseos'],
        [[5541, 5542, 5983], 'Transporte', 'Gasolina/Diesel'], [[4121], 'Transporte', 'Taxi/App de Transporte'], [[4111, 4112, 4131], 'Transporte', 'Transporte Público'],
        [[7523], 'Transporte', 'Parqueo'], [[4784], 'Transporte', 'Peajes'], [[3351, 7512, 7513, 7519, 3366, 3357, 3389, 3393, 3395, 3405], 'Transporte', 'Alquiler de Vehículo'],
        [[5531, 5532, 5533, 7531, 7534, 7535, 7538, 7542, 7549], 'Transporte', 'Mantenimiento (aceite, llantas, frenos)'],
        [[4511, 3000, 3001, 3005, 3007, 3008, 3009, 3010, 3058, 3256], 'Viajes y Vacaciones', 'Vuelos'], [[7011, 3501, 3502, 3503, 3504, 3509, 3512, 3530, 3533, 3543, 3604, 3615, 3640, 3665, 3690, 3692, 3700, 3703, 3710, 3750], 'Viajes y Vacaciones', 'Hospedaje'],
        [[4722, 4723], 'Viajes y Vacaciones', 'Hospedaje'],
        [[4900], 'Servicios Básicos y Comunicación', 'Energía Eléctrica'], [[4812, 4814, 4813], 'Servicios Básicos y Comunicación', 'Plan Celular'], [[4816], 'Servicios Básicos y Comunicación', 'Internet'], [[4899], 'Servicios Básicos y Comunicación', 'Cable/TV'],
        [[5912], 'Salud', 'Medicinas'], [[8011, 8031, 8041, 8042, 8049, 8050, 8062, 8099], 'Salud', 'Consultas Médicas'], [[8021], 'Salud', 'Odontología'], [[8043, 8044], 'Salud', 'Óptica'], [[8071], 'Salud', 'Exámenes de Laboratorio'],
        [[5200, 5211, 5231, 5251, 5261, 5198], 'Vivienda', 'Mantenimiento del Hogar'], [[5712, 5713, 5714, 5718, 5719, 5722, 5732], 'Vivienda', 'Muebles y Electrodomésticos'],
        [[1520, 1711, 1731, 1740, 1750, 1761, 1771, 1799, 7349], 'Vivienda', 'Reparaciones (plomería, eléctrico, techo)'],
        [[5611, 5621, 5631, 5641, 5651, 5655, 5661, 5681, 5691, 5697, 5698, 5699, 5137, 5139], 'Vestimenta', 'Ropa y Calzado'], [[7210, 7211, 7216, 7251], 'Vestimenta', 'Lavandería/Tintorería'],
        [[7230], 'Cuidado Personal', 'Peluquería/Barbería'], [[7298, 7297], 'Cuidado Personal', 'Spa/Masajes'], [[5977], 'Cuidado Personal', 'Cosméticos y Perfumería'],
        [[7832, 7841], 'Entretenimiento y Ocio', 'Cine'], [[7922, 7929], 'Entretenimiento y Ocio', 'Conciertos/Eventos'], [[7991, 7996, 7998, 7999, 7932, 7933], 'Entretenimiento y Ocio', 'Salidas y Paseos'],
        [[7941, 7992, 7997, 5940, 5941, 5945, 5946, 5949, 5970], 'Entretenimiento y Ocio', 'Hobbies'], [[5942, 5994, 2741], 'Entretenimiento y Ocio', 'Libros'],
        [[5815, 5818], 'Suscripciones y Entretenimiento Digital', 'Streaming de Video'], [[5816], 'Suscripciones y Entretenimiento Digital', 'Videojuegos'], [[5817, 5734, 5372], 'Suscripciones y Entretenimiento Digital', 'Software/Herramientas'],
        [[8211, 8220, 8241, 8244, 8249, 8299], 'Educación', 'Cursos/Capacitación'], [[8351], 'Familia e Hijos', 'Guardería/Niñera'], [[5641], 'Vestimenta', 'Ropa y Calzado'],
        [[742, 5995], 'Mascotas', 'Veterinario'], [[8398, 8661], 'Regalos, Celebraciones y Donaciones', 'Donaciones Benéficas'], [[5992, 5947, 5193], 'Regalos, Celebraciones y Donaciones', 'Fiestas/Celebraciones'],
        [[6300, 5960], 'Seguros y Protección', 'Seguro de Vida'], [[9311], 'Financiero y Legal', 'Preparación de Impuestos'], [[9222, 9399, 9402, 9211], 'Financiero y Legal', 'Multas y Trámites Municipales'],
        [[6012, 6051, 6211], 'Financiero y Legal', 'Comisiones Bancarias']
    ];
    const MCC_INDEX = {};
    MCC.forEach(([codes, c, s]) => codes.forEach(k => { if (!MCC_INDEX[k]) MCC_INDEX[k] = [c, s]; }));
    // Airlines (3000–3299), car rental (3351–3441) and hotels (3501–3999) have a code per company.
    const mccFor = (k) => MCC_INDEX[k] || (k >= 3000 && k <= 3299 ? ['Viajes y Vacaciones', 'Vuelos'] : k >= 3351 && k <= 3441 ? ['Transporte', 'Alquiler de Vehículo'] : k >= 3501 && k <= 3999 ? ['Viajes y Vacaciones', 'Hospedaje'] : null);

    // ------------------------------------------------------------------ words
    // [pattern, type, category, subcategory, confidence]. Checked against the whole text.
    const STRONG = [
        // Income
        [/payroll|reg\.? ?salary|\bsalary\b|direct dep|dir dep|paycheck|\bnomina\b|rol de pagos|sueldo/, 'Ingreso', 'Ingresos Laborales', 'Sueldo/Salario', 'high', 'payroll'],
        [/irs\s*treas|us treasury 310|tax ref|tax refund/, 'Ingreso', 'Gobierno y Beneficios', 'Reembolso de Impuestos (IRS)', 'high'],
        [/(?:state ?of ?\w+|dept of (?:revenue|treasury)|treasury).*(?:income tax|inctax|tax)|income tax.*refund|stateof\w+/, 'Ingreso', 'Gobierno y Beneficios', 'Reembolso de Impuestos (IRS)', 'medium'],
        [/ssa treas|soc sec|social security/, 'Ingreso', 'Gobierno y Beneficios', 'Seguro Social', 'high'],
        [/unemploy|\buia\b|ui benefit/, 'Ingreso', 'Gobierno y Beneficios', 'Beneficios de Desempleo', 'high'],
        [/apy earned|\bdividend\b.*\brate\b|interest (?:paid|earned|payment)|\bint(?:erest)? pd\b|intereses ganados/, 'Ingreso', 'Ingresos Financieros', 'Intereses', 'high'],
        [/\bdividend/, 'Ingreso', 'Ingresos Financieros', 'Dividendos', 'medium'],
        // Investing (money that leaves to a brokerage or retirement account is saving, not spending)
        [/\b(?:roth|ira|401k|401\(k\)|403b)\b/, 'Gasto', 'Ahorro e Inversión', '401(k) / IRA', 'high'],
        [/vanguard|fidelity|schwab|e\*?trade|robinhood|betterment|wealthfront|acorns|\bstash\b|m1 finance|merrill|ameritrade|webull|\binvestment\b|individual buy/, 'Gasto', 'Ahorro e Inversión', 'Inversiones (bolsa)', 'high'],
        [/\b529\b|mesp|education savings/, 'Gasto', 'Ahorro e Inversión', 'Plan 529 (universidad)', 'high'],
        // Housing and bills
        [/mortgage|mtg pymt|home loan|rocket mortgage|mr\.? cooper|quicken loans|hipoteca|biess/, 'Gasto', 'Vivienda', 'Hipoteca', 'high'],
        [/\brent\b|apartments?\b|property mgmt|realpage|appfolio|arriendo/, 'Gasto', 'Vivienda', 'Arriendo', 'medium'],
        [/water|sewer|agua potable|epmaps|interagua/, 'Gasto', 'Servicios Básicos y Comunicación', 'Agua', 'high'],
        [/natural gas|\bsemco\b|nicor|gas co\b|gas company/, 'Gasto', 'Servicios Básicos y Comunicación', 'Gas', 'high'],
        [/energy|electric|edison|\bpower\b|\bdte\b|duke energy|pg&e|xcel|empresa electrica|cnel|\beeq\b/, 'Gasto', 'Servicios Básicos y Comunicación', 'Energía Eléctrica', 'high'],
        [/comcast|xfinity|spectrum(?! health)|frontier comm|starlink|att internet|netlife|puntonet|\binternet\b/, 'Gasto', 'Servicios Básicos y Comunicación', 'Internet', 'high'],
        [/t-?mobile|verizon|mint mobile|cricket|metro by|visible|at&t|att\*|claro|movistar|tuenti|\bcnt\b/, 'Gasto', 'Servicios Básicos y Comunicación', 'Plan Celular', 'high'],
        [/progressive|geico|state farm|allstate|liberty mutual|farmers ins|usaa|nationwide|esurance|auto insur/, 'Gasto', 'Transporte', 'Seguro Vehicular', 'high'],
        [/life insur|northwestern mutual|primerica|seguro de vida/, 'Gasto', 'Seguros y Protección', 'Seguro de Vida', 'high'],
        [/univ|university|college|tuition|universidad/, 'Gasto', 'Educación', 'Matrícula Universitaria', 'high'],
        [/daycare|child ?care|kindercare|learning center|guarderia/, 'Gasto', 'Familia e Hijos', 'Guardería/Niñera', 'high'],
        [/church|ministr|tithe|diezmo|iglesia/, 'Gasto', 'Regalos, Celebraciones y Donaciones', 'Diezmo/Donaciones Religiosas', 'high'],
        [/overdraft|nsf fee|service charge|monthly fee|maintenance fee|international service assess|foreign transaction|intl (?:service|transaction) fee|comision/, 'Gasto', 'Financiero y Legal', 'Comisiones Bancarias', 'high']
    ];
    const STORES = [
        [/kroger|meijer(?! express)|wal-?mart|walmart|aldi|costco(?! gas)|sam\x27?s ?club|samsclub|whole ?foods|trader joe|publix|safeway|\bheb\b|spartan|family fare|save a lot|gordon food|supermaxi|megamaxi|mi comisariato|\btia\b|santa maria|\baki\b|tuti/, 'Alimentación', 'Mercado/Supermercado'],
        [/doordash|uber ?eats|grubhub|instacart|rappi|pedidos ya/, 'Alimentación', 'Delivery a Domicilio'],
        [/starbucks|dunkin|coffee|cafe\b|tim hortons|wandering cup|sweet ?& ?coffee|juan valdez/, 'Alimentación', 'Cafetería'],
        [/mcdonald|burger|wendy|taco bell|chick-?fil|subway|kfc|popeyes|arby|sonic|culver|five guys|chipotle|panera|donut|ice cream/, 'Alimentación', 'Comida Rápida'],
        [/pizza|grill|restaurant|bistro|kitchen|diner|sushi|\bwok\b|tavern|brewing|steakhouse|restaurante/, 'Alimentación', 'Restaurantes'],
        [/shell|\bbp\b|marathon|speedway|mobil|exxon|sunoco|citgo|chevron|circle k|wawa|sheetz|meijer express|costco gas|primax|terpel|petroecuador/, 'Transporte', 'Gasolina/Diesel'],
        [/\blyft\b|\buber\b|taxi|cabify|indriver/, 'Transporte', 'Taxi/App de Transporte'],
        [/parking|park ?mobile|parqueadero/, 'Transporte', 'Parqueo'],
        [/budget rent|enterprise rent|hertz|avis|alamo|national car/, 'Transporte', 'Alquiler de Vehículo'],
        [/netflix|hulu|disney|hbo|\bmax\b|peacock|paramount|youtube|prime video/, 'Suscripciones y Entretenimiento Digital', 'Streaming de Video'],
        [/spotify|apple music|pandora|sirius/, 'Suscripciones y Entretenimiento Digital', 'Streaming de Música'],
        [/apple\.com|icloud|google (?:one|storage)|dropbox/, 'Suscripciones y Entretenimiento Digital', 'Almacenamiento en la Nube'],
        [/cvs|walgreens|rite aid|pharmacy|farmacia|fybeca|sana sana|cruz azul/, 'Salud', 'Medicinas'],
        [/clinic|hospital|medical|urgent care|pediatric|spectrum health|corewell|health ?care|clinica|laboratorio/, 'Salud', 'Consultas Médicas'],
        [/dental|orthodont|dentist/, 'Salud', 'Odontología'],
        [/lowe\x27?s|home depot|menards|ace hardware|true value|harbor freight|tractor.?supply/, 'Vivienda', 'Mantenimiento del Hogar'],
        [/old navy|kohl\x27?s|tj ?maxx|marshalls|\bross\b|nordstrom|wearhouse|\bgap\b|h&m|nike|carter\x27?s|burlington|de prati|etafashion|marathon sports/, 'Vestimenta', 'Ropa y Calzado'],
        [/great clips|sport clips|supercuts|salon|barber|peluqueria/, 'Cuidado Personal', 'Peluquería/Barbería'],
        [/petsmart|petco|chewy|animal hosp|veterinar/, 'Mascotas', 'Alimento para Mascotas'],
        [/red cross|salvation army|donation|charity|unicef/, 'Regalos, Celebraciones y Donaciones', 'Donaciones Benéficas'],
        [/cinema|theater|theatre|amc |regal |cinemark|supercines|multicines/, 'Entretenimiento y Ocio', 'Cine']
    ];

    const result = (type, category, sub, confidence, why, key) => ({ type, category, sub, confidence, why, key });

    function guess(info, { sign = 0, country = 'US' } = {}) {
        const t = info.text || '';
        const key = info.brand || info.name || '';
        const dir = info.direction;
        // 1. Between your accounts: not income or spending.
        if (dir === 'transfer') return result('Transferencia', '', '', 'high', 'Card payment or a move between your accounts', key || 'transfer');
        const incoming = sign > 0 || (sign === 0 && dir === 'in');
        // 2. Strong words.
        for (const [re, type, cat, sub, conf] of STRONG) {
            if (!re.test(t)) continue;
            if ((type === 'Ingreso') !== incoming) continue;     // "tax refund" as an expense makes no sense
            return result(type, cat, sub, conf, 'From the bank\'s wording', key);
        }
        // Money coming back from an investment account or another account of yours.
        if (incoming && /transfer from|deposit transfer/.test(t)) return result('Transferencia', '', '', 'medium', 'Money coming from another account of yours', key || 'transfer');
        if (!incoming && /withdrawal transfer|transfer to/.test(t)) return result('Transferencia', '', '', 'medium', 'Money you move to another account', key || 'transfer');
        // 3. The card's merchant category code.
        const everything = /amazon|amzn|target\b|ebay|etsy|dollar (?:tree|general)|five below|temu|shein|aliexpress/.test(t);
        if (!incoming && info.mcc) {
            const m = mccFor(info.mcc);
            // Some codes are too broad (Amazon uses 5942 "books", city parking 9399 "government"):
            // a store that sells everything is asked about, and a known store name wins.
            const broad = [5942, 5999, 5311, 5310, 5331, 5399, 5964, 5969, 9399, 9222, 9402, 7399, 8999].includes(info.mcc);
            const store = STORES.find(([re]) => re.test(t));
            if (everything && broad) return Object.assign(result('Gasto', 'Otros', 'Otros Gastos', 'low', 'Store that sells everything: pick what you bought', key), { ask: true });
            if (store && broad) return result('Gasto', store[1], store[2], 'medium', 'From the store\'s name', key);
            if (m) return result('Gasto', m[0], m[1], 'high', `From the kind of business (code ${info.mcc})`, key);
        }
        // 4. Store names.
        if (!incoming) {
            const s = STORES.find(([re]) => re.test(t));
            if (s) return result('Gasto', s[1], s[2], 'medium', 'From the store\'s name', key);
        }
        // 5. Only the direction is known.
        if (!incoming && info.check) return result('Gasto', 'Otros', 'Otros Gastos', 'low', `Check #${info.check}: what was it for?`, '');
        if (!incoming && (info.cash || (/^(?:withdrawal|atm|retiro)\b/.test(norm(info.lines[0] || '')) && !info.name))) return result('Gasto', 'Otros', 'Otros Gastos', 'low', 'Cash withdrawal: what was it used for?', '');
        if (incoming) return result('Ingreso', 'Otros Ingresos', '', 'low', /check/.test(t) ? 'Check deposit: what is it from?' : 'Money in: what is it from?', key);
        if (everything) return Object.assign(result('Gasto', 'Otros', 'Otros Gastos', 'low', 'Store that sells everything: pick what you bought', key), { ask: true });
        return result('Gasto', 'Otros', 'Otros Gastos', 'low', '', key);
    }

    // Card lines end with the city, and a short name keeps it ("TACO PLACE SPRINGFIELD"). A last word
    // (or two) that ends the names of 3+ different merchants in the same file is a city: drop it.
    function tidyNames(infos) {
        const ends = {};
        const seen = new Set();
        infos.forEach(i => {
            if (!i || !i.isCard || !i.name || i.brand) return;
            const w = i.name.split(/\s+/);
            if (w.length < 2 || seen.has(i.name)) return;
            seen.add(i.name);
            [1, 2].forEach(n => { if (w.length > n) { const e = w.slice(-n).join(' ').toLowerCase(); (ends[e] || (ends[e] = new Set())).add(w.slice(0, -n).join(' ')); } });
        });
        const NOT_CITY = /^(?:cafe|coffee|inc|llc|co|corp|company|store|stores|market|grill|bar|pizza|restaurant|kitchen|center|centre|shop|services?|visa|international|express|online|club|house|bakery|deli|foods?|supply|outlet|pharmacy|clinic|the|and|of)$/;
        const cities = Object.keys(ends).filter(e => ends[e].size >= 3 && e.length >= 4 && !e.split(' ').some(w => NOT_CITY.test(w))).sort((a, b) => b.length - a.length);
        infos.forEach(i => {
            if (!i || !i.isCard || !i.name || i.brand) return;
            const c = cities.find(e => i.name.toLowerCase().endsWith(' ' + e));
            if (c) i.name = i.name.slice(0, -(c.length + 1)).trim();
        });
        return cities;
    }

    // Rows from the same payer or store should agree: a guess backed by the bank's words (one
    // paycheck says PAYROLL) is shared with that payer's rows that had only a weak guess, and
    // regular deposits from the same company (3 or more) are most likely a paycheck.
    function harmonize(guesses) {
        const groups = {};
        guesses.forEach((g, i) => { if (g && g.key && g.type !== 'Transferencia') (groups[norm(g.key)] || (groups[norm(g.key)] = [])).push(i); });
        Object.values(groups).forEach(ix => {
            const best = ix.map(i => guesses[i]).filter(g => g.confidence !== 'low').sort((a, b) => (a.confidence === 'high' ? -1 : 1) - (b.confidence === 'high' ? -1 : 1))[0];
            ix.forEach(i => {
                const g = guesses[i];
                if (g.confidence !== 'low' || g.ask) return;
                if (best && best.type === g.type) Object.assign(g, { category: best.category, sub: best.sub, confidence: 'medium', why: `Like the other transactions from ${g.key}` });
                else if (!best && g.type === 'Ingreso' && ix.length >= 3) Object.assign(g, { category: 'Ingresos Laborales', sub: 'Sueldo/Salario', confidence: 'medium', why: 'Regular deposits from the same company: looks like a paycheck' });
            });
        });
        return guesses;
    }

    // The rows whose guess is worth remembering: same key, same category, more than once (or
    // changed by you). → [{ key, type, category, sub, count, rows }]
    function suggestRules(rows, existing = []) {
        const groups = {};
        rows.forEach((r, i) => {
            if (!r.key || r.key.length < 3 || r.error) return;
            const k = norm(r.key);
            if ((existing || []).some(x => x.contains && k.includes(norm(x.contains)))) return;
            const g = groups[k] || (groups[k] = { key: r.key, rows: [], combos: {} });
            g.rows.push(i);
            const c = `${r.type}|${r.category}|${r.sub || ''}`;
            g.combos[c] = (g.combos[c] || 0) + 1;
        });
        return Object.values(groups).filter(g => g.rows.length >= 2).map(g => {
            const [best] = Object.entries(g.combos).sort((a, b) => b[1] - a[1]);
            const [type, category, sub] = best[0].split('|');
            return { key: g.key, type, category, sub, count: g.rows.length, rows: g.rows };
        }).sort((a, b) => b.count - a.count);
    }

    const Categorize = { parse, guess, harmonize, tidyNames, suggestRules, cleanMerchant, mccFor, norm };
    if (typeof module !== 'undefined' && module.exports) module.exports = Categorize;
    else root.Categorize = Categorize;
})(this);
