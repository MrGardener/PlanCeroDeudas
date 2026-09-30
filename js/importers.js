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
        store: ['lugar', 'comercio', 'establecimiento', 'merchant', 'tienda', 'oficina', 'agencia']
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
        ['date', 'debit', 'credit', 'description', 'category', 'store', 'amount'].forEach(k => {
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

    const headerSignature = (headers) => headers.map(norm).join('|');

    // Rows of the table (after the header) → candidate transactions, using the mapping:
    // { date, description, store, category?, amount>0, type 'Gasto'|'Ingreso', error? }
    function buildRows(table, mapping) {
        const { mode = 'single', date, description, amount, debit, credit, category, store,
            dateFormat = 'auto', decimal = 'auto', expensesAre = 'negative' } = mapping;
        return table.map((cells, i) => {
            const get = (idx) => (idx !== undefined && idx !== null && idx >= 0 ? cells[idx] : '');
            const out = { index: i, date: parseDate(get(date), dateFormat), description: get(description) || '', store: get(store) || '', category: get(category) || '' };
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

    const Importers = { detectDelimiter, parseCSV, parseAmount, parseDate, guessMapping, headerSignature, buildRows, isDuplicate, applyRules, parseSriXml, parseReceiptText, norm };
    if (typeof module !== 'undefined' && module.exports) module.exports = Importers;
    else root.Importers = Importers;
})(this);
