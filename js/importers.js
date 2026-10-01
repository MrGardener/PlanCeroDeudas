/*
 * Importers — turn files from elsewhere into transactions. Pure functions, no DOM, so they
 * run in Node tests too:
 *   - CSV/TXT exports from any bank or app (delimiter, dates and amounts detected; the
 *     person maps the columns);
 *   - SRI electronic invoices (XML "comprobante" / "autorización");
 *   - text read from a receipt photo (OCR) — best effort, always reviewed.
 * Files are only read in memory: nothing here stores them.
 */
(function (root) {
    'use strict';

    // ------------------------------------------------------------------ CSV
    function detectDelimiter(text) {
        const lines = text.split(/\r?\n/).filter(l => l.trim()).slice(0, 15);
        const candidates = [',', ';', '\t', '|'];
        let best = ',', bestScore = -1;
        candidates.forEach(d => {
            const counts = lines.map(l => splitLine(l, d).length);
            if (!counts.length) return;
            const common = mode(counts);
            const consistent = counts.filter(c => c === common).length;
            const score = common > 1 ? consistent * common : 0;
            if (score > bestScore) { bestScore = score; best = d; }
        });
        return best;
    }

    function mode(arr) {
        const m = new Map();
        arr.forEach(x => m.set(x, (m.get(x) || 0) + 1));
        return [...m.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    }

    // One line, honoring double quotes ("a, b" and "" escapes).
    function splitLine(line, d) {
        const out = [];
        let cur = '', q = false;
        for (let i = 0; i < line.length; i++) {
            const ch = line[i];
            if (q) {
                if (ch === '"' && line[i + 1] === '"') { cur += '"'; i++; }
                else if (ch === '"') q = false;
                else cur += ch;
            } else if (ch === '"') q = true;
            else if (ch === d) { out.push(cur); cur = ''; }
            else cur += ch;
        }
        out.push(cur);
        return out.map(c => c.trim());
    }

    // Whole file → rows (quoted fields may contain line breaks).
    function parseCSV(text, delimiter) {
        text = String(text || '').replace(/^﻿/, '');
        const d = delimiter || detectDelimiter(text);
        const rows = [];
        let buf = null;
        // Blank lines are kept (as empty rows) so row numbers match what a spreadsheet shows.
        text.split(/\r?\n/).forEach(line => {
            buf = buf === null ? line : buf + '\n' + line;
            const quotes = (buf.match(/"/g) || []).length;
            if (quotes % 2 === 1) return;            // inside a quoted field: keep reading
            rows.push(buf.trim() ? splitLine(buf, d) : ['']);
            buf = null;
        });
        if (buf !== null && buf.trim()) rows.push(splitLine(buf, d));
        while (rows.length && rows[rows.length - 1].length === 1 && rows[rows.length - 1][0] === '') rows.pop();
        return { delimiter: d, rows };
    }

    // "1.234,56" / "1,234.56" / "(45.00)" / "-$ 12,5" / "12.50-" → number
    function parseAmount(v, decimal) {
        if (typeof v === 'number') return v;
        let s = String(v || '').trim();
        if (!s) return null;
        let neg = false;
        if (/^\(.*\)$/.test(s)) { neg = true; s = s.slice(1, -1); }
        if (/-$/.test(s)) { neg = true; s = s.slice(0, -1); }
        if (/^-/.test(s.replace(/[^\d\-.,]/g, '').trim()) || /^\s*-/.test(s)) neg = true;
        s = s.replace(/[^\d.,]/g, '');
        if (!s) return null;
        let dec = decimal;
        if (!dec || dec === 'auto') {
            const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
            if (lastDot >= 0 && lastComma >= 0) dec = lastDot > lastComma ? '.' : ',';
            else if (lastComma >= 0) dec = /,\d{1,2}$/.test(s) ? ',' : '.';
            else dec = '.';
            if (dec === '.' && lastDot >= 0 && lastComma < 0 && /^\d{1,3}(\.\d{3})+$/.test(s)) dec = ',';   // 1.234.567
        }
        const n = dec === ',' ? parseFloat(s.replace(/\./g, '').replace(',', '.')) : parseFloat(s.replace(/,/g, ''));
        if (!Number.isFinite(n)) return null;
        return neg ? -n : n;
    }

    // The decimal separator of a whole column. One value alone can be ambiguous ("273.841" is
    // 273.841 or 273,841?), but the column rarely is: "208.33900000000003" or "173.94" settle
    // it for every row. Returns '.' or ',', or 'auto' when no value decides (each value is then
    // read on its own).
    function detectDecimal(values) {
        let dot = 0, comma = 0;
        (values || []).forEach(v => {
            const s = String(v || '').replace(/[^\d.,]/g, '');
            const lastDot = s.lastIndexOf('.'), lastComma = s.lastIndexOf(',');
            if (lastDot >= 0 && lastComma >= 0) { if (lastDot > lastComma) dot++; else comma++; }
            else if (lastDot >= 0) { if ((s.match(/\./g) || []).length > 1) comma++; else if (!/\.\d{3}$/.test(s)) dot++; }
            else if (lastComma >= 0) { if ((s.match(/,/g) || []).length > 1) dot++; else if (!/,\d{3}$/.test(s)) comma++; }
        });
        return dot === comma ? 'auto' : (dot > comma ? '.' : ',');
    }

    const MONTHS_ES = { ene: 1, feb: 2, mar: 3, abr: 4, may: 5, jun: 6, jul: 7, ago: 8, sep: 9, set: 9, oct: 10, nov: 11, dic: 12,
        jan: 1, apr: 4, aug: 8, dec: 12 };

    // Many date styles → 'YYYY-MM-DD' (or null). `format`: 'auto' | 'dmy' | 'mdy' | 'ymd'.
    function parseDate(v, format) {
        const s = String(v || '').trim();
        if (!s) return null;
        const iso = (y, m, d) => {
            y = Number(y); m = Number(m); d = Number(d);
            if (y < 100) y += 2000;
            if (!(m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
            const dt = new Date(y, m - 1, d);
            if (dt.getMonth() !== m - 1) return null;
            return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        };
        let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
        if (m) return iso(m[1], m[2], m[3]);
        m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})/);
        if (m) {
            const a = Number(m[1]), b = Number(m[2]);
            const f = format && format !== 'auto' ? format : (a > 12 ? 'dmy' : b > 12 ? 'mdy' : 'dmy');   // Ecuador: day first
            return f === 'mdy' ? iso(m[3], a, b) : iso(m[3], b, a);
        }
        m = s.match(/^(\d{1,2})[\s\-/.]+([A-Za-zÁÉÍÓÚáéíóú]{3,})[\s\-/.,]+(\d{2,4})/);
        if (m) { const mm = MONTHS_ES[m[2].slice(0, 3).toLowerCase()]; return mm ? iso(m[3], mm, m[1]) : null; }
        return null;
    }

    const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
    const HEADER_HINTS = {
        date: ['fecha', 'date', 'fecha transaccion', 'fecha de transaccion', 'fecha valor', 'fecha operacion'],
        description: ['descripcion', 'concepto', 'detalle', 'description', 'referencia', 'transaccion', 'movimiento', 'glosa', 'memo', 'payee', 'beneficiario'],
        amount: ['monto', 'valor', 'importe', 'amount', 'cantidad', 'total'],
        debit: ['debito', 'debitos', 'cargo', 'cargos', 'retiro', 'retiros', 'egreso', 'egresos', 'debit', 'withdrawal'],
        credit: ['credito', 'creditos', 'abono', 'abonos', 'deposito', 'depositos', 'ingreso', 'ingresos', 'credit', 'deposit'],
        category: ['categoria', 'category', 'rubro', 'tipo de gasto'],
        store: ['lugar', 'comercio', 'establecimiento', 'merchant', 'tienda', 'oficina', 'agencia'],
        balance: ['saldo', 'saldo disponible', 'saldo contable', 'balance', 'running balance']
    };

    // Best guess of which column holds what, from the header names.
    function guessMapping(headers) {
        const h = headers.map(norm);
        const find = (key, taken) => {
            const hints = HEADER_HINTS[key];
            let idx = h.findIndex((x, i) => !taken.has(i) && hints.includes(x));
            if (idx < 0) idx = h.findIndex((x, i) => !taken.has(i) && hints.some(k => x.includes(k)));
            return idx;
        };
        const taken = new Set();
        const map = {};
        ['date', 'debit', 'credit', 'balance', 'description', 'category', 'store', 'amount'].forEach(k => {
            const i = find(k, taken);
            map[k] = i;
            if (i >= 0) taken.add(i);
        });
        map.mode = map.debit >= 0 && map.credit >= 0 ? 'split' : 'single';
        if (map.mode === 'single' && map.amount < 0) {
            // A single debit or credit column still works as the amount column.
            map.amount = map.debit >= 0 ? map.debit : map.credit;
        }
        return map;
    }

    // The account balance after the most recent row (bank statements carry a running balance).
    function latestBalance(rows) {
        const withBal = (rows || []).filter(r => !r.error && r.balance !== null && r.balance !== undefined);
        if (!withBal.length) return null;
        // Same date: statements may be oldest-first or newest-first; keep the file's last row
        // of the latest date when oldest-first, the first one when newest-first.
        const newestFirst = withBal.length > 1 && withBal[0].date > withBal[withBal.length - 1].date;
        const latest = withBal.reduce((a, r) => (r.date > a.date || (r.date === a.date && !newestFirst) ? r : a));
        return { date: latest.date, balance: latest.balance };
    }

    const headerSignature = (headers) => headers.map(norm).join('|');

    // Rows of the table (after the header) → candidate transactions, using the mapping:
    // { date, description, store, category?, amount>0, type 'Gasto'|'Ingreso', error? }
    function buildRows(table, mapping) {
        const { mode = 'single', date, description, amount, debit, credit, category, store, balance,
            dateFormat = 'auto', expensesAre = 'negative' } = mapping;
        let decimal = mapping.decimal || 'auto';
        if (decimal === 'auto') {
            const cols = [amount, debit, credit, balance].filter(c => c !== undefined && c !== null && c >= 0);
            decimal = detectDecimal([].concat(...table.map(r => cols.map(c => r[c]))));
        }
        return table.map((cells, i) => {
            const get = (idx) => (idx !== undefined && idx !== null && idx >= 0 ? cells[idx] : '');
            const out = { index: i, date: parseDate(get(date), dateFormat), description: get(description) || '', store: get(store) || '', category: get(category) || '' };
            if (balance !== undefined && balance >= 0) out.balance = parseAmount(get(balance), decimal);
            let value = null;
            if (mode === 'split') {
                const d = parseAmount(get(debit), decimal), c = parseAmount(get(credit), decimal);
                if (d) value = -Math.abs(d);
                else if (c) value = Math.abs(c);
            } else {
                value = parseAmount(get(amount), decimal);
                if (value !== null && expensesAre === 'positive') value = -value;
            }
            if (!out.date) out.error = 'Fecha no reconocida';
            else if (value === null || value === 0) out.error = 'Sin monto';
            else if (!out.description.trim()) out.description = out.store || '(sin descripción)';
            out.amount = value === null ? 0 : Math.round(Math.abs(value) * 100) / 100;
            out.type = value !== null && value > 0 ? 'Ingreso' : 'Gasto';
            return out;
        });
    }

    // Same date, same amount and a similar description → most likely already registered.
    function isDuplicate(row, transactions) {
        const d = norm(row.description).slice(0, 12);
        return (transactions || []).some(t => t.date === row.date && Math.abs(Number(t.amount) - row.amount) < 0.005
            && (t.type || 'Gasto') === row.type && (norm(t.description).slice(0, 12) === d || !d));
    }

    // The same money logged twice in different words: a purchase typed by hand ("Supermaxi",
    // 12 sep) and the bank's line for it days later ("COMPRA SUPERMAXI EL BOSQUE", 14 sep).
    // Same type and amount within `days` days, text ignored; the closest date wins. `exclude`
    // (a Set of ids) keeps one transaction from matching two rows.
    function findMatch(row, transactions, { days = 4, exclude } = {}) {
        if (!row || !row.date || !(Number(row.amount) > 0)) return null;
        const at = Date.parse(row.date);
        let best = null;
        (transactions || []).forEach(t => {
            if (exclude && exclude.has(t.id)) return;
            if ((t.type || 'Gasto') !== (row.type || 'Gasto') || Math.abs(Number(t.amount) - Number(row.amount)) >= 0.005 || !t.date) return;
            const d = Math.abs(Math.round((Date.parse(t.date) - at) / 86400000));
            if (d <= days && (!best || d < best.days)) best = { txn: t, days: d };
        });
        return best;
    }

    // A fingerprint of the row as it came in the file, kept on the imported transaction so the
    // same row is recognized next time even if you gave it your own description.
    const importRef = (row) => `${row.date}|${Math.round(Number(row.amount) * 100)}|${row.type || 'Gasto'}|${norm(row.description).slice(0, 24)}`;

    // First rule whose text appears in the description (or place) wins.
    function applyRules(rules, text) {
        const hay = norm(text);
        if (!hay) return null;
        return (rules || []).find(r => r.contains && hay.includes(norm(r.contains))) || null;
    }

    // ------------------------------------------------------------------ SRI XML
    const decodeEntities = (s) => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&amp;/g, '&');
    const tag = (xml, name) => { const m = xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`)); return m ? m[1].trim() : ''; };
    const tagsAll = (xml, name) => { const out = []; const re = new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'g'); let m; while ((m = re.exec(xml))) out.push(m[1]); return out; };

    // SRI "formaPago" codes → the app's payment types.
    const SRI_PAYMENT = { '01': 'Efectivo', '15': 'Transferencia', '16': 'Tarjeta de Débito', '17': 'Transferencia', '18': 'Transferencia', '19': 'Tarjeta de Crédito', '20': 'Transferencia', '21': 'Transferencia' };

    // An SRI electronic invoice (factura) as the authorization file or the bare comprobante.
    function parseSriXml(text) {
        let xml = String(text || '');
        const inner = xml.match(/<comprobante>\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*<\/comprobante>/);
        if (inner) xml = inner[1];
        else if (/<comprobante>/.test(xml)) xml = decodeEntities(tag(xml, 'comprobante'));
        if (!/<factura[\s>]/.test(xml) && !/<notaCredito[\s>]/.test(xml)) return null;
        const it = tag(xml, 'infoTributaria');
        const inf = tag(xml, 'infoFactura') || tag(xml, 'infoNotaCredito');
        const razon = decodeEntities(tag(it, 'razonSocial'));
        const comercial = decodeEntities(tag(it, 'nombreComercial'));
        const iva = tagsAll(tag(inf, 'totalConImpuestos'), 'totalImpuesto')
            .filter(t => tag(t, 'codigo') === '2').reduce((s, t) => s + (parseFloat(tag(t, 'valor')) || 0), 0);
        const items = tagsAll(tag(xml, 'detalles'), 'detalle').map(d => ({
            description: decodeEntities(tag(d, 'descripcion')),
            quantity: parseFloat(tag(d, 'cantidad')) || 1,
            total: parseFloat(tag(d, 'precioTotalSinImpuesto')) || 0
        }));
        const pay = tag(tag(inf, 'pagos'), 'formaPago');
        return {
            kind: /<notaCredito[\s>]/.test(xml) ? 'notaCredito' : 'factura',
            supplier: comercial || razon,
            legalName: razon,
            ruc: tag(it, 'ruc'),
            number: [tag(it, 'estab'), tag(it, 'ptoEmi'), tag(it, 'secuencial')].filter(Boolean).join('-'),
            accessKey: tag(it, 'claveAcceso'),
            date: parseDate(tag(inf, 'fechaEmision'), 'dmy'),
            subtotal: parseFloat(tag(inf, 'totalSinImpuestos')) || 0,
            iva: Math.round(iva * 100) / 100,
            total: parseFloat(tag(inf, 'importeTotal') || tag(inf, 'valorModificacion')) || 0,
            payment: SRI_PAYMENT[pay] || '',
            items
        };
    }

    // ------------------------------------------------------------------ receipt text (OCR)
    // Pulls the likely total, date, RUC and store name out of text read from a photo.
    function parseReceiptText(text) {
        const lines = String(text || '').split(/\r?\n/).map(l => l.trim()).filter(Boolean);
        const amountsIn = (l) => (l.match(/\d{1,3}(?:[.,]\d{3})*[.,]\d{2}\b/g) || []).map(x => parseAmount(x)).filter(x => x !== null);
        let total = null;
        const totalRe = /(importe\s+total|valor\s+total|total\s+a\s+pagar|total\s+pagar|total\s+usd|^total\b|\btotal\b)/i;
        const skip = /(sub\s*-?\s*total|subtotal|total\s+descuento|total\s+iva|total\s+sin|base)/i;
        for (let i = 0; i < lines.length && total === null; i++) {
            const l = lines[i];
            if (totalRe.test(l) && !skip.test(l)) {
                const a = amountsIn(l).concat(i + 1 < lines.length ? amountsIn(lines[i + 1]) : []);
                if (a.length) total = a[0];
            }
        }
        if (total === null) { const all = lines.flatMap(amountsIn); if (all.length) total = Math.max(...all); }
        const dateMatch = String(text).match(/\b(\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}|\d{4}-\d{2}-\d{2})\b/);
        const ruc = (String(text).match(/\b(\d{13})\b/) || [])[1] || '';
        const merchant = lines.find(l => /[A-Za-zÁÉÍÓÚÑáéíóúñ]{3,}/.test(l) && !/(ruc|factura|fecha|autoriz|direcci|matriz|telf|tel[eé]fono)/i.test(l)) || '';
        return { total, date: dateMatch ? parseDate(dateMatch[1], 'dmy') : null, ruc, merchant: merchant.slice(0, 60) };
    }

    // ------------------------------------------------------------------ export
    // Rows (arrays) → CSV text that Excel/Sheets open correctly (BOM, quotes, CRLF). Text that
    // starts like a formula (=, +, -, @) is prefixed with ' so spreadsheets don't run it.
    function toCSV(rows, delimiter = ',') {
        const cell = (v) => {
            if (v === null || v === undefined) return '';
            if (typeof v === 'number') return String(Math.round(v * 100) / 100);
            let s = String(v);
            if (/^[=+\-@]/.test(s)) s = "'" + s;
            return /[",;\n\r\t']/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        return '﻿' + rows.map(r => r.map(cell).join(delimiter)).join('\r\n') + '\r\n';
    }

    // ------------------------------------------------------------------ pay stubs
    // What a deduction line on a pay stub is, from its label (English or Spanish).
    // { group, kind, pretax } or null for lines that aren't deductions (earnings, totals).
    const DEDUCTION_RULES = [
        // Paid by the employer on top of pay: shown, never subtracted.
        [/\b(er|employer|company|patronal)\b.*\b(401|403|457|match|retire|hsa|contrib|aporte)|\bmatch(ing)?\b|aporte patronal/, { group: 'employer', kind: 'retirement' }],
        [/\b(employer|company|patronal)\b/, { group: 'employer', kind: 'other' }],
        // Loans repaid from pay.
        [/(401k?|403b?|retirement)\s*loan|prestamo|quirografario|hipotecario|anticipo|\bloan\b|advance/, { group: 'loan', kind: 'loan' }],
        // Taxes and mandatory contributions.
        [/aporte personal|\biess\b(?!.*(prestamo|quirografario|hipotecario))|seguridad social(?!.*prestamo)/, { group: 'mandatory', kind: 'iess' }],
        [/retencion.*(renta|\bir\b)|impuesto a la renta|\bir\b retenido/, { group: 'mandatory', kind: 'ir' }],
        [/social security|oasdi|\bfica\b|\bss tax\b|\bsoc sec\b/, { group: 'mandatory', kind: 'ss' }],
        [/medicare|\bmed tax\b/, { group: 'mandatory', kind: 'medicare' }],
        [/fed(eral)?\b.*(w\/?h|withholding|income tax|tax)|\bfit\b|\bfwt\b/, { group: 'mandatory', kind: 'federal' }],
        [/\bstate\b.*(tax|w\/?h|withholding)|\bsit\b|\bswt\b|\b(mi|ca|ny|oh|il|pa|ga|nc|va|nj|ma|az|co|wi|mn|or|ky|al|la|sc|ut|ia|ks|ar|ms|ne|id|nm|wv|hi|me|ri|mt|de|vt|dc|ok|in|md|mo|ct)\b\s*(w\/?h|withholding|income tax|tax|sit)/, { group: 'mandatory', kind: 'state' }],
        [/\b(city|local|county|school district)\b.*tax|\blocal\b/, { group: 'mandatory', kind: 'local' }],
        [/\b(sdi|sui|fli|pfl|pfml|vdi|disability ins)\b/, { group: 'mandatory', kind: 'state-ins' }],
        // Court-ordered.
        [/garnish|child support|pension(es)? alimenticia|alimentos|\blevy\b|wage assign|embargo|retencion judicial|support order/, { group: 'garnishment', kind: 'garnishment' }],
        // Retirement savings.
        [/roth/, { group: 'retirement', kind: 'retirement', pretax: false }],
        [/\b401\s?\(?k\)?|\b403\s?\(?b\)?|\b457\b|\btsp\b|retirement|pension plan|deferred comp|ahorro voluntario|fondo de (cesantia|jubilacion|pensiones)|jubilacion patronal|aporte voluntario/, { group: 'retirement', kind: 'retirement', pretax: true }],
        [/\bhsa\b|health savings/, { group: 'retirement', kind: 'hsa', pretax: true }],
        // Insurance.
        [/medical|health|\bhmo\b|\bppo\b|seguro (medico|de salud|de asistencia|privado)|asistencia medica/, { group: 'insurance', kind: 'health', pretax: true }],
        [/dental|odontolog/, { group: 'insurance', kind: 'dental', pretax: true }],
        [/vision|optic/, { group: 'insurance', kind: 'vision', pretax: true }],
        [/\bfsa\b|flexible spending|dependent care/, { group: 'insurance', kind: 'fsa', pretax: true }],
        [/\blife\b|ad&d|ad ?& ?d|seguro de vida|\bstd\b|\bltd\b|short.term|long.term|accident|critical illness|hospital indemnity/, { group: 'insurance', kind: 'life', pretax: false }],
        [/auto ins|car ins|vehicle ins|seguro (vehicular|del carro|de auto)/, { group: 'insurance', kind: 'auto', pretax: false }],
        [/legal plan|pet ins|identity/, { group: 'insurance', kind: 'other', pretax: false }],
        // Other things taken from pay.
        [/union|dues|cuota sindical|sindicato|comisariato|commuter|transit|parking|charity|united way|donation|uniform|cafeteria|stock purchase|espp|multa|descuento/, { group: 'other', kind: 'other' }]
    ];
    const NOT_DEDUCTION = /gross|total|net pay|net check|neto|liquido|a recibir|a pagar|earnings|regular|overtime|horas|hours|salary|sueldo|bonus|bono|comision|commission|vacation|holiday|pto|sick|rate|ytd|year to date|period|fecha|date|check no|deposit|fondos de reserva|decimo|tips/;

    function classifyDeduction(label) {
        const t = norm(label).replace(/[^a-z0-9&/()\s.-]/g, ' ').replace(/\s+/g, ' ').trim();
        if (!t || t.length < 2) return null;
        for (const [re, out] of DEDUCTION_RULES) if (re.test(t)) return Object.assign({ pretax: false }, out);
        return null;
    }

    // Read a pay stub's text (from a PDF or a photo). Lines are "Label   current   YTD".
    // Returns { gross, net, totalDeductions, deductions: [{ label, amount, ytd, group, kind, pretax }],
    // periodStart, periodEnd, periodDays, payDate }. No names or ID numbers are returned.
    const MONEY = /\(?-?\$?\s?\d{1,3}(?:[.,\s]\d{3})*[.,]\d{2}\)?(?!\d)|\(?-?\$?\s?\d+[.,]\d{2}\)?(?!\d)/g;
    function parsePaystub(text) {
        const out = { gross: null, net: null, totalDeductions: null, deductions: [], periodStart: null, periodEnd: null, periodDays: null, payDate: null };
        const seen = new Set();
        // Day-first (Ecuador) or month-first (US) dates, decided once for the whole stub.
        const all = String(text || '').match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b/g) || [];
        const dayFirst = all.some(d => Number(d.split(/[/.-]/)[0]) > 12) || (!all.some(d => Number(d.split(/[/.-]/)[1]) > 12) && /\b(rol|periodo|sueldo|liquido|quincena|egresos)\b/.test(norm(text)));
        String(text || '').split(/\r?\n/).forEach(raw => {
            const line = raw.replace(/\b\d{3}-\d{2}-\d{4}\b|\bxxx-xx-\d{4}\b/gi, ' ').replace(/\s+/g, ' ').trim();
            if (!line) return;
            const n = norm(line);
            // Dates: pay period and pay date.
            const dates = (line.match(/\b\d{1,2}[/.-]\d{1,2}[/.-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/g) || []).map(d => parseDate(d, /\b\d{4}-/.test(d) ? 'ymd' : dayFirst ? 'dmy' : 'mdy')).filter(Boolean);
            if (/period|periodo/.test(n) && dates.length >= 2 && !out.periodStart) {
                out.periodStart = dates[0]; out.periodEnd = dates[1];
                out.periodDays = Math.round((Date.parse(dates[1]) - Date.parse(dates[0])) / 86400000) + 1;
            }
            if (/pay date|check date|fecha de pago|advice date|deposit date/.test(n) && dates.length && !out.payDate) out.payDate = dates[dates.length - 1];
            // Rates like "9,45%" are not money.
            const body = line.replace(/\d+(?:[.,]\d+)?\s?%/g, ' ');
            const amounts = (body.match(MONEY) || []).map(a => Math.abs(parseAmount(a.replace(/\s/g, ''))));
            if (!amounts.length) return;
            const first = body.search(MONEY);
            const label = body.slice(0, first).replace(/[:\-–]+\s*$/, '').replace(/\s+\d+(\.\d+)?\s*%?\s*$/, '').trim();
            const l = norm(label);
            if (/^(gross pay|gross earnings|total gross|gross|total earnings|total ingresos|ingresos totales|total devengado|total haberes|total de ingresos)\b/.test(l) || (/gross/.test(l) && !/ytd/.test(l))) { if (out.gross === null) out.gross = amounts[0]; return; }
            if (/^(net pay|net check|net amount|net|neto a (recibir|pagar)|liquido a (recibir|pagar)|total a (recibir|pagar)|valor a recibir|neto)\b/.test(l)) { if (out.net === null) out.net = amounts[0]; return; }
            if (/^(total deductions|total descuentos|total egresos|deductions total|total de descuentos)\b/.test(l)) { if (out.totalDeductions === null) out.totalDeductions = amounts[0]; return; }
            const c = classifyDeduction(label);
            if (!c || NOT_DEDUCTION.test(l) && c.group !== 'mandatory') return;
            const key = l;
            if (seen.has(key) || !(amounts[0] > 0)) return;
            seen.add(key);
            out.deductions.push(Object.assign({ label: label.slice(0, 60), amount: amounts[0], ytd: amounts.length > 1 ? amounts[amounts.length - 1] : null }, c));
        });
        return out;
    }

    // Paychecks a year from the length of the pay period (in days).
    function paysPerYearFromPeriod(days) {
        if (!(days > 0)) return null;
        if (days <= 8) return 52;
        if (days <= 14) return 26;
        if (days <= 17) return 24;
        if (days <= 31) return 12;
        return null;
    }

    const Importers = { classifyDeduction, parsePaystub, paysPerYearFromPeriod, findMatch, importRef, detectDecimal, latestBalance, toCSV, detectDelimiter, parseCSV, parseAmount, parseDate, guessMapping, headerSignature, buildRows, isDuplicate, applyRules, parseSriXml, parseReceiptText, norm };
    if (typeof module !== 'undefined' && module.exports) module.exports = Importers;
    else root.Importers = Importers;
})(this);
