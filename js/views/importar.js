/*
 * Presupuesto → Importar: bring transactions in from files.
 *  - CSV from any bank or app: the person maps the columns (and the file's categories to
 *    theirs), reviews a preview, duplicates are skipped. The mapping is remembered per file
 *    layout (by its header row); the file itself is never stored.
 *  - SRI electronic invoices (XML): exact data, same preview.
 *  - Receipt photo: OCR in the browser (best effort) → prefilled transaction form.
 *  - Automatic rules ("contains X → category / line").
 */
(function () {
    'use strict';
    const { money, esc } = Fmt;

    // The file being imported lives only here, in memory, until import or cancel.
    let session = null;

    // Common Ecuadorian merchants → category, when no rule or mapping says otherwise.
    const KEYWORDS = [
        [/supermaxi|megamaxi|mi comisariato|\btia\b|santa maria|coral|\baki\b|gran aki|tuti|mercado|panaderia/, 'Alimentación'],
        [/farmacia|fybeca|sana sana|cruz azul|pharmacy|medicit|clinica|hospital|laboratorio/, 'Salud'],
        [/gasolinera|primax|petroecuador|terpel|mobil|shell|uber|cabify|indriver|peaje|taxi|metro de quito/, 'Transporte'],
        [/netflix|spotify|disney|hbo|max\b|prime video|youtube|apple\.com|google play/, 'Suscripciones y Entretenimiento Digital'],
        [/\bcnt\b|claro|movistar|tuenti|netlife|puntonet|empresa electrica|\beeq\b|cnel|epmaps|agua potable|interagua/, 'Servicios Básicos y Comunicación'],
        [/kfc|mcdonald|burger|pizza|restaurante|cafe|starbucks|sweet ?& ?coffee|juan valdez/, 'Entretenimiento y Ocio'],
        [/de prati|etafashion|rm\b|pycca|marathon|zara|h&m/, 'Vestimenta'],
        [/arriendo|alquiler|condominio|alicuota/, 'Vivienda']
    ];

    const expenseTax = () => Store.state.taxonomy.expense;
    const incomeTax = () => Store.state.taxonomy.income;
    const firstSub = (tax, cat) => (tax[cat] || [])[0] || '';

    // Category (and optional budget line) for an imported row: rule → file's category mapped
    // by the person → merchant keywords → "Otros".
    function resolve(row, catMap) {
        const tax = row.type === 'Ingreso' ? incomeTax() : expenseTax();
        const rule = Importers.applyRules(Store.state.rules, `${row.description} ${row.store}`);
        if (rule && tax[rule.category]) return { category: rule.category, sub: rule.sub && (tax[rule.category] || []).includes(rule.sub) ? rule.sub : firstSub(tax, rule.category), budgetLine: rule.budgetLine || '', why: `regla «${rule.contains}»` };
        const mapped = row.category && catMap ? catMap[row.category] : null;
        if (mapped && tax[mapped]) return { category: mapped, sub: firstSub(tax, mapped), why: 'categoría del archivo' };
        if (row.category && tax[row.category]) return { category: row.category, sub: firstSub(tax, row.category), why: 'categoría del archivo' };
        if (row.type !== 'Ingreso') {
            const hay = Importers.norm(`${row.description} ${row.store}`);
            const k = KEYWORDS.find(([re, cat]) => re.test(hay) && tax[cat]);
            if (k) return { category: k[1], sub: firstSub(tax, k[1]), why: 'comercio conocido' };
        }
        const fallback = row.type === 'Ingreso' ? (tax['Otros Ingresos'] ? 'Otros Ingresos' : Object.keys(tax)[0]) : (tax.Otros ? 'Otros' : Object.keys(tax)[0]);
        return { category: fallback, sub: firstSub(tax, fallback), why: '' };
    }

    // Read a text file, trying UTF-8 first and falling back to Windows-1252 (common in bank exports).
    function readText(file) {
        return file.arrayBuffer().then(buf => {
            try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
        });
    }

    // ------------------------------------------------------------------ CSV mapping
    const FIELDS = [
        { key: 'date', label: 'Fecha', required: true },
        { key: 'description', label: 'Descripción', required: true },
        { key: 'amount', label: 'Monto (una columna)', mode: 'single' },
        { key: 'debit', label: 'Débito / cargos (gastos)', mode: 'split' },
        { key: 'credit', label: 'Crédito / abonos (ingresos)', mode: 'split' },
        { key: 'store', label: 'Lugar / comercio (opcional)' },
        { key: 'category', label: 'Categoría (opcional)' }
    ];

    function guessHeaderRow(rows) {
        // First row, among the first 15, that looks like titles: several cells, mostly text.
        for (let i = 0; i < Math.min(rows.length, 15); i++) {
            const cells = rows[i].filter(c => c !== '');
            if (cells.length >= 2 && cells.filter(c => /[A-Za-zÁÉÍÓÚáéíóú]/.test(c) && !Importers.parseDate(c) && Importers.parseAmount(c) === null).length >= Math.ceil(cells.length * 0.6)) return i;
        }
        return 0;
    }

    function startSession(name, text) {
        const parsed = Importers.parseCSV(text);
        if (parsed.rows.length < 2) { UI.toast('No encontramos filas en ese archivo. ¿Es un CSV?', 'error'); return; }
        const headerRow = guessHeaderRow(parsed.rows);
        session = { source: 'csv', name, all: parsed.rows, headerRow, include: {}, catOverride: {} };
        applyHeader();
    }

    function applyHeader() {
        const s = session;
        s.headers = s.all[s.headerRow].map((h, i) => h || `Columna ${i + 1}`);
        const width = s.headers.length;
        s.table = s.all.slice(s.headerRow + 1).filter(r => r.length >= Math.min(2, width) && r.some(c => c !== ''));
        s.signature = Importers.headerSignature(s.headers);
        const saved = (Store.state.settings.importProfiles || {})[s.signature];
        s.mapping = Object.assign({ dateFormat: 'auto', decimal: 'auto', expensesAre: 'negative' }, Importers.guessMapping(s.headers), saved ? saved.mapping : {});
        s.catMap = Object.assign({}, saved ? saved.catMap : {});
        s.fromProfile = !!saved;
        recompute();
        renderSetup();
    }

    function recompute() {
        const s = session;
        let rows;
        if (s.source === 'csv') rows = Importers.buildRows(s.table, s.mapping);
        else rows = s.rows;
        s.rows = rows.map((r, i) => {
            const res = r.error ? { category: '', sub: '' } : resolve(r, s.catMap);
            const override = s.catOverride[i];
            const dup = !r.error && (!!r.dupKey || Importers.isDuplicate(r, Store.state.transactions));
            const include = s.include[i] !== undefined ? s.include[i] : !r.error && !dup;
            return Object.assign({}, r, res, override ? { category: override, sub: firstSub(r.type === 'Ingreso' ? incomeTax() : expenseTax(), override), why: 'elegida por ti' } : {}, { dup, include: !r.error && include });
        });
        renderPreview();
    }

    function renderSetup() {
        const s = session;
        UI.show('imp-setup', s.source === 'csv');
        if (s.source !== 'csv') return;
        UI.html('imp-profile-note', s.fromProfile ? '<i class="fa-solid fa-circle-check text-emerald-600"></i> Usamos la configuración que guardaste para archivos como este. Puedes cambiarla.' : 'Revisamos los títulos y adivinamos lo que pudimos. Corrige lo que haga falta: la vista previa se actualiza sola.');
        const colOpts = (sel) => `<option value="-1">— Ninguna —</option>` + s.headers.map((h, i) => `<option value="${i}" ${Number(sel) === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
        const m = s.mapping;
        const field = (f) => (f.mode && f.mode !== m.mode) ? '' : `<label class="field"><span class="field-label">${f.label}${f.required ? ' *' : ''}</span><select class="input" data-change="imp.map" data-key="${f.key}">${colOpts(m[f.key])}</select></label>`;
        const sel = (key, label, opts) => `<label class="field"><span class="field-label">${label}</span><select class="input" data-change="imp.map" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(m[key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        UI.html('imp-map', [
            `<label class="field"><span class="field-label">Fila de los títulos</span><input type="number" class="input" min="1" max="${s.all.length}" value="${s.headerRow + 1}" data-change="imp.headerRow"></label>`,
            sel('mode', 'Los montos vienen en…', [['single', 'Una columna (gastos con signo)'], ['split', 'Dos columnas: débito y crédito']]),
            ...FIELDS.map(field),
            m.mode === 'single' ? sel('expensesAre', 'En esa columna los gastos son…', [['negative', 'Negativos (−45.50)'], ['positive', 'Positivos (todo es gasto)']]) : '',
            sel('dateFormat', 'Formato de fecha', [['auto', 'Detectar (día primero)'], ['dmy', 'Día/Mes/Año'], ['mdy', 'Mes/Día/Año'], ['ymd', 'Año-Mes-Día']]),
            sel('decimal', 'Separador decimal', [['auto', 'Detectar'], ['.', 'Punto (1,234.50)'], [',', 'Coma (1.234,50)']])
        ].join(''));
        // First rows as they are in the file, so the columns are easy to recognize.
        UI.html('imp-raw', `<thead><tr>${s.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.slice(0, 4).map(r => `<tr>${s.headers.map((_, i) => `<td class="text-xs">${esc(r[i] || '')}</td>`).join('')}</tr>`).join('')}</tbody>`);
        // The file's own categories → ours.
        const values = m.category >= 0 ? [...new Set(s.table.map(r => r[m.category]).filter(Boolean))].slice(0, 60) : [];
        UI.show('imp-cats-panel', values.length > 0);
        if (values.length) {
            const opts = (v) => `<option value="">Automática (reglas / comercio)</option>` + Object.keys(expenseTax()).concat(Object.keys(incomeTax())).map(c => `<option value="${esc(c)}" ${s.catMap[v] === c || (!s.catMap[v] && Importers.norm(c) === Importers.norm(v)) ? 'selected' : ''}>${esc(c)}</option>`).join('');
            UI.html('imp-cats', values.map(v => `<label class="flex items-center gap-2 text-xs"><span class="flex-1 truncate font-semibold" title="${esc(v)}">${esc(v)}</span><i class="fa-solid fa-arrow-right text-slate-400"></i><select class="cell-input" style="width:14rem" data-change="imp.catMap" data-value="${esc(v)}">${opts(v)}</select></label>`).join(''));
        }
    }

    function renderPreview() {
        const s = session;
        UI.show('imp-preview-card', !!s);
        if (!s) return;
        const ok = s.rows.filter(r => r.include);
        const dups = s.rows.filter(r => r.dup).length, errs = s.rows.filter(r => r.error).length;
        UI.html('imp-summary', `<strong>${esc(s.name)}</strong>: ${s.rows.length} fila${s.rows.length === 1 ? '' : 's'} · <span class="text-emerald-700 font-bold">${ok.length} para importar</span>${dups ? ` · ${dups} ya registrada${dups === 1 ? '' : 's'} (desmarcada${dups === 1 ? '' : 's'})` : ''}${errs ? ` · <span class="text-red-600">${errs} con errores (se omiten)</span>` : ''}`);
        document.getElementById('imp-commit').innerHTML = `<i class="fa-solid fa-file-import"></i> Importar ${ok.length}`;
        document.getElementById('imp-commit').disabled = ok.length === 0;
        const catOptions = (r) => Object.keys(r.type === 'Ingreso' ? incomeTax() : expenseTax()).map(c => `<option ${c === r.category ? 'selected' : ''}>${esc(c)}</option>`).join('');
        UI.html('imp-rows', s.rows.slice(0, 500).map((r, i) => `<tr class="${r.error ? 'opacity-60' : ''}">
                <td class="text-center"><input type="checkbox" class="w-4 h-4 accent-emerald-600" data-change="imp.toggle" data-i="${i}" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''}></td>
                <td class="whitespace-nowrap text-xs">${esc(r.date || '—')}</td>
                <td><div class="font-semibold text-xs">${esc(r.description)}</div>${r.store ? `<div class="text-[10px] text-slate-500">${esc(r.store)}</div>` : ''}${r.items && r.items.length ? `<div class="text-[10px] text-slate-500">${r.items.length} producto${r.items.length === 1 ? '' : 's'}${r.iva ? ` · IVA ${money(r.iva)}` : ''}</div>` : ''}</td>
                <td>${r.error ? '—' : `<select class="cell-input text-xs" data-change="imp.cat" data-i="${i}">${catOptions(r)}</select>${r.why ? `<div class="text-[10px] text-slate-400">por ${esc(r.why)}</div>` : ''}`}</td>
                <td class="num font-bold ${r.type === 'Ingreso' ? 'text-emerald-700' : ''}">${r.error ? '' : (r.type === 'Ingreso' ? '+' : '−') + money(r.amount)}</td>
                <td class="text-xs">${r.error ? `<span class="badge badge-bad">${esc(r.error)}</span>` : r.dup ? '<span class="badge badge-warn">Ya existe</span>' : '<span class="badge badge-ok">Nueva</span>'}</td>
            </tr>`).join('') + (s.rows.length > 500 ? `<tr><td colspan="6" class="text-xs text-slate-500">Mostrando 500 de ${s.rows.length}; se importan todas las marcadas.</td></tr>` : ''));
    }

    function endSession() {
        session = null;
        ['imp-file', 'imp-xml'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        UI.show('imp-setup', false);
        UI.show('imp-preview-card', false);
        UI.text('imp-file-name', '¿Tu banco solo da Excel (.xlsx)? Ábrelo y usa "Guardar como → CSV".');
    }

    // ------------------------------------------------------------------ rules
    function renderRules() {
        const rules = Store.state.rules || [];
        UI.html('rule-body', rules.length ? rules.map(r => `<tr>
                <td class="font-semibold">“${esc(r.contains)}”</td>
                <td>${esc(r.category)}${r.sub ? ` <span class="text-slate-400">› ${esc(r.sub)}</span>` : ''}</td>
                <td class="text-xs">${r.budgetLine ? esc(lineName(r.budgetLine)) : '<span class="text-slate-400">Automático</span>'}</td>
                <td class="text-center"><button class="row-del" data-action="rule.delete" data-id="${r.id}" title="Eliminar regla" aria-label="Eliminar regla"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="4">Sin reglas. Ejemplo: si contiene “supermaxi” → Alimentación.</td></tr>');
    }

    function lineName(id) {
        const items = Engine.monthItems(Store.effective(Store.state.activeYear), 'base');
        const it = items.find(i => String(i.id) === String(id));
        return it ? it.name : `(rubro ${id})`;
    }

    function render() {
        renderRules();
        if (session) { renderSetup(); renderPreview(); } else { UI.show('imp-setup', false); UI.show('imp-preview-card', false); }
    }

    // ------------------------------------------------------------------ OCR
    function loadTesseract() {
        if (window.Tesseract) return Promise.resolve(window.Tesseract);
        return new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = 'https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js';
            sc.onload = () => window.Tesseract ? resolve(window.Tesseract) : reject(new Error('no Tesseract'));
            sc.onerror = () => reject(new Error('sin conexión'));
            document.head.appendChild(sc);
        });
    }

    UI.register({
        'imp.file': async (el) => {
            const file = el.files && el.files[0];
            if (!file) return;
            if (/\.xlsx?$/i.test(file.name)) { UI.toast('Ese es un archivo de Excel. Ábrelo y guárdalo como CSV, luego elígelo aquí.', 'error'); el.value = ''; return; }
            UI.text('imp-file-name', `${file.name} · ${file.size < 1024 ? file.size + ' bytes' : Math.round(file.size / 1024) + ' KB'}`);
            startSession(file.name, await readText(file));
        },
        'imp.headerRow': (el) => {
            if (!session) return;
            session.headerRow = Math.max(0, Math.min(session.all.length - 2, (parseInt(el.value, 10) || 1) - 1));
            session.include = {}; session.catOverride = {};
            applyHeader();
        },
        'imp.map': (el) => {
            if (!session) return;
            const k = el.dataset.key;
            session.mapping[k] = ['mode', 'dateFormat', 'decimal', 'expensesAre'].includes(k) ? el.value : Number(el.value);
            session.include = {};
            recompute();
            renderSetup();
        },
        'imp.catMap': (el) => {
            if (!session) return;
            if (el.value) session.catMap[el.dataset.value] = el.value; else delete session.catMap[el.dataset.value];
            recompute();
        },
        'imp.cat': (el) => { if (!session) return; session.catOverride[Number(el.dataset.i)] = el.value; recompute(); },
        'imp.toggle': (el) => { if (!session) return; session.include[Number(el.dataset.i)] = el.checked; recompute(); },
        'imp.toggleAll': (el) => { if (!session) return; session.rows.forEach((r, i) => { if (!r.error) session.include[i] = el.checked; }); recompute(); },
        'imp.cancel': () => endSession(),
        'imp.commit': () => {
            if (!session) return;
            const s = session;
            const rows = s.rows.filter(r => r.include);
            const txns = Store.state.transactions;
            let id = Store.nextId(txns);
            rows.forEach(r => {
                const t = { id: id++, type: r.type, description: r.description.slice(0, 120), store: (r.store || '').slice(0, 80), parentCategory: r.category, category: r.sub || '', amount: r.amount, date: r.date, paymentType: r.payment || 'Transferencia', source: s.source };
                if (r.budgetLine && r.type !== 'Ingreso') t.budgetLine = String(r.budgetLine);
                if (r.invoice) t.invoice = r.invoice;
                txns.push(t);
            });
            // Remember how this kind of file maps (not the file): next time it's automatic.
            if (s.source === 'csv') {
                const profiles = Store.state.settings.importProfiles || (Store.state.settings.importProfiles = {});
                const { date, description, amount, debit, credit, store, category, mode, dateFormat, decimal, expensesAre } = s.mapping;
                profiles[s.signature] = { mapping: { date, description, amount, debit, credit, store, category, mode, dateFormat, decimal, expensesAre }, catMap: s.catMap, name: s.name, savedAt: new Date().toISOString().slice(0, 10) };
            }
            const skipped = s.rows.length - rows.length;
            endSession();
            App.changed({ structural: true, step: true });
            UI.toast(`${rows.length} movimiento${rows.length === 1 ? '' : 's'} importado${rows.length === 1 ? '' : 's'}${skipped ? ` (${skipped} omitido${skipped === 1 ? '' : 's'})` : ''}. Revísalos en Transacciones.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        },
        'imp.xml': async (el) => {
            const files = Array.from(el.files || []);
            if (!files.length) return;
            const rows = [];
            const bad = [];
            for (const f of files) {
                const inv = Importers.parseSriXml(await readText(f));
                if (!inv || !inv.date || !inv.total) { bad.push(f.name); continue; }
                const credit = inv.kind === 'notaCredito';
                rows.push({ date: inv.date, description: inv.supplier, store: inv.legalName !== inv.supplier ? inv.legalName : '', amount: Math.round(inv.total * 100) / 100, type: credit ? 'Ingreso' : 'Gasto', payment: inv.payment, items: inv.items, iva: inv.iva,
                    invoice: { ruc: inv.ruc, number: inv.number, accessKey: inv.accessKey, iva: inv.iva, subtotal: inv.subtotal } });
            }
            if (bad.length) UI.toast(`No parece${bad.length === 1 ? '' : 'n'} factura${bad.length === 1 ? '' : 's'} del SRI: ${bad.join(', ')}`, 'error');
            if (!rows.length) { el.value = ''; return; }
            session = { source: 'sri', name: `${rows.length} factura${rows.length === 1 ? '' : 's'} electrónica${rows.length === 1 ? '' : 's'}`, rows, include: {}, catOverride: {}, catMap: {} };
            // Same invoice twice → duplicate by its access key too.
            session.rows = rows.map(r => Object.assign(r, { dupKey: Store.state.transactions.some(t => t.invoice && t.invoice.accessKey && t.invoice.accessKey === r.invoice.accessKey) }));
            recompute();
            session.rows.forEach((r, i) => { if (rows[i].dupKey) { r.dup = true; r.include = false; session.include[i] = false; } });
            renderSetup();
            renderPreview();
            document.getElementById('imp-preview-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
        },
        'imp.photo': async (el) => {
            const file = el.files && el.files[0];
            if (!file) return;
            const status = (t) => UI.html('imp-photo-status', t);
            status('<i class="fa-solid fa-spinner fa-spin"></i> Preparando el lector de texto…');
            try {
                const T = await loadTesseract();
                const worker = await T.createWorker('spa', 1, { logger: m => { if (m.status === 'recognizing text') status(`<i class="fa-solid fa-spinner fa-spin"></i> Leyendo la foto… ${Math.round((m.progress || 0) * 100)}%`); } });
                const { data } = await worker.recognize(file);
                await worker.terminate();
                const r = Importers.parseReceiptText(data.text);
                const res = resolve({ type: 'Gasto', description: r.merchant, store: '' }, {});
                status(r.total ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> Leímos ${r.merchant ? `<strong>${esc(r.merchant)}</strong>, ` : ''}total <strong>${money(r.total)}</strong>${r.date ? `, fecha ${esc(r.date)}` : ''}. Revisa y guarda.` : '<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> No encontramos el total en la foto. Completa los datos a mano.');
                TxnForm.prefill({ type: 'Gasto', description: r.merchant || 'Factura', amount: r.total || '', date: r.date || '', parent: res.category, sub: res.sub });
            } catch (e) {
                status('<i class="fa-solid fa-triangle-exclamation text-red-600"></i> No se pudo leer la foto (se necesita internet la primera vez). Puedes registrar la factura a mano en Transacciones.');
            } finally { el.value = ''; }
        },
        'rule.add': async () => {
            const cats = Object.keys(expenseTax()).map(c => ({ value: 'G|' + c, label: c })).concat(Object.keys(incomeTax()).map(c => ({ value: 'I|' + c, label: `${c} (ingreso)` })));
            const items = Engine.monthItems(Store.effective(Store.state.activeYear), 'base');
            const r = await UI.form({
                title: 'Nueva regla automática',
                fields: [
                    { name: 'contains', label: 'Si la descripción o el lugar contiene…', placeholder: 'Ej: supermaxi' },
                    { name: 'cat', label: 'Poner la categoría', options: cats },
                    { name: 'line', label: 'Y contar en el rubro (opcional)', options: [{ value: '', label: 'Automático (según la categoría)' }].concat(items.map(i => ({ value: String(i.id), label: i.name }))) }
                ],
                confirmText: 'Crear regla',
                validate: v => v.contains.trim().length < 2 ? 'Escribe al menos 2 letras.' : null
            });
            if (!r) return;
            const rules = Store.state.rules || (Store.state.rules = []);
            rules.push({ id: Store.nextId(rules), contains: r.contains.trim(), category: r.cat.slice(2), budgetLine: r.line || undefined });
            App.changed({ structural: true, step: true });
        },
        'rule.delete': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Regla eliminada', () => { Store.state.rules = Store.state.rules.filter(r => r.id !== id); });
        }
    });

    App.defineView('presupuesto/importar', { render, update: render });
    // For tests and for other views.
    window.ImportSession = { get: () => session, start: startSession, resolve };
})();
