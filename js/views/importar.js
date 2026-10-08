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

    const expenseTax = () => Store.state.taxonomy.expense;
    const incomeTax = () => Store.state.taxonomy.income;
    const taxFor = (type) => (type === 'Ingreso' ? incomeTax() : expenseTax());
    const firstSub = (tax, cat) => (tax[cat] || [])[0] || '';
    const tr = (x) => (window.I18n ? I18n.t(x) : x);

    // Rules pick from the same list as Settings → Categories: each category (in that order) with
    // its subcategories, translated. Values are "G|category|sub" (expense), "I|…" (income), "T||".
    function ruleCategoryOptions() {
        const groups = [['G', expenseTax(), ''], ['I', incomeTax(), tr('Income') + ' · ']].flatMap(([k, tax, tag]) => Object.keys(tax).map(c => ({
            group: tag + tr(c),
            options: (tax[c] || []).length ? tax[c].map(sub => ({ value: `${k}|${c}|${sub}`, label: tr(sub) })) : [{ value: `${k}|${c}|`, label: tr(c) }]
        })));
        return [{ value: '', label: tr('Choose a category') }].concat(groups, { group: tr('Transfer'), options: [{ value: 'T||', label: tr('Transfer between accounts') }] });
    }
    // A rule's category as an option value; no subcategory (older rules) = the first one, as on import.
    function ruleCategoryValue(kind, cat, sub) {
        if (kind === 'T') return 'T||';
        const tax = kind === 'I' ? incomeTax() : expenseTax();
        if (!tax[cat]) return '';
        return `${kind}|${cat}|${sub && tax[cat].includes(sub) ? sub : firstSub(tax, cat)}`;
    }
    // Budget lines grouped by the category they're linked to, in the Categories screen's order.
    function ruleLineOptions() {
        const items = Engine.monthItems(Store.effective(Store.state.activeYear), 'base').filter(i => i.type !== 'Ingreso');
        const cats = Object.keys(expenseTax());
        const of = (i) => (cats.includes(i.linkedCategory) ? i.linkedCategory : '');
        const groups = cats.concat('').map(c => ({ group: c ? tr(c) : tr('Not linked to a category'), options: items.filter(i => of(i) === c).map(i => ({ value: String(i.id), label: i.name })) })).filter(g => g.options.length);
        return [{ value: '', label: tr('Automatic (by category)') }].concat(groups);
    }
    const RULE_LINE_HELP = 'Leave it on Automatic unless you want these transactions counted in a different line of your budget.';
    const ruleCategoryText = (rule) => (rule.type === 'Transferencia' ? tr('Transfer between accounts') : tr(rule.category) + (rule.sub ? ' › ' + tr(rule.sub) : ''));
    const TYPES = [{ value: 'Gasto', label: 'Gasto' }, { value: 'Ingreso', label: 'Ingreso' }, { value: 'Transferencia', label: 'Transfer' }];
    const PAYROLL = 'Sueldo/Salario';
    const fallbackCat = (type) => { const tax = taxFor(type); return type === 'Ingreso' ? (tax['Otros Ingresos'] ? 'Otros Ingresos' : Object.keys(tax)[0]) : (tax.Otros ? 'Otros' : Object.keys(tax)[0]); };
    // A subcategory the engine suggests may not be in this person's list yet (it's added on import).
    const subOk = (type, cat, sub) => !!sub && ((taxFor(type)[cat] || []).includes(sub) || !!taxFor(type)[cat]);

    // Type, category and the rest for an imported row: your rule → the file's own category
    // (mapped by you) → the engine's guess (Categorize: bank words, card category codes, stores)
    // → "Otros".
    function resolve(row, catMap, g) {
        const text = `${row.description} ${row.store} ${row.cleanName || ''}`;
        const rule = Importers.applyRules(Store.state.rules, text);
        if (rule) {
            const type = rule.type || (row.type !== 'Transferencia' && taxFor(row.type)[rule.category] ? row.type : incomeTax()[rule.category] ? 'Ingreso' : expenseTax()[rule.category] ? 'Gasto' : row.type);
            if (type === 'Transferencia') return { type, category: '', sub: '', rename: rule.rename || '', why: `By the rule «${rule.contains}»`, rule, conf: 'rule' };
            const tax = taxFor(type);
            if (tax[rule.category]) return { type, category: rule.category, sub: rule.sub && subOk(type, rule.category, rule.sub) ? rule.sub : firstSub(tax, rule.category), budgetLine: rule.budgetLine || '', rename: rule.rename || '', memberId: rule.memberId, why: `By the rule «${rule.contains}»`, rule, conf: 'rule' };
        }
        const tax = taxFor(row.type);
        const mapped = row.category && catMap ? catMap[row.category] : null;
        if (mapped && tax[mapped]) return { type: row.type, category: mapped, sub: firstSub(tax, mapped), why: 'By the file\'s category', conf: 'high' };
        if (row.category && tax[row.category]) return { type: row.type, category: row.category, sub: firstSub(tax, row.category), why: 'By the file\'s category', conf: 'high' };
        if (g) {
            if (g.type === 'Transferencia') return { type: 'Transferencia', category: '', sub: '', why: g.why, conf: g.confidence };
            const gt = taxFor(g.type);
            // The engine guesses with the original names: follow any rename.
            const n = Engine.renamedCategory(Store.state.settings, g.type === 'Ingreso' ? 'income' : 'expense', g.category, g.sub);
            if (gt[n.category]) return { type: g.type, category: n.category, sub: n.sub && (gt[n.category] || []).includes(n.sub) ? n.sub : firstSub(gt, n.category), why: g.why, conf: g.confidence, ask: g.ask };
        }
        const fb = fallbackCat(row.type);
        return { type: row.type, category: fb, sub: firstSub(tax, fb), why: '', conf: 'low' };
    }

    const NO_DESC = '(sin descripción)';
    function editRow(i, change) {
        const e = session.edits[i] || (session.edits[i] = {});
        Object.keys(change).forEach(k => { if (change[k] === undefined) delete e[k]; else e[k] = change[k]; });
    }
    function lineItems() { return Engine.monthItems(Store.effective(Store.state.activeYear), 'base').filter(i => i.type !== 'Ingreso'); }
    function bulkLabel(d) {
        return [d.description ? `«${d.description}»` : '', d.category ? d.category + (d.sub ? ` › ${d.sub}` : '') : '', d.budgetLine ? `line ${lineName(d.budgetLine)}` : ''].filter(Boolean).join(', ');
    }
    function detectedDecimal(s) {
        const m = s.mapping, cols = [m.amount, m.debit, m.credit, m.balance].filter(c => c !== undefined && c >= 0);
        return Importers.detectDecimal([].concat(...s.table.map(r => cols.map(c => r[c]))));
    }

    // Read a text file, trying UTF-8 first and falling back to Windows-1252 (common in bank exports).
    function readText(file) {
        return file.arrayBuffer().then(buf => {
            try { return new TextDecoder('utf-8', { fatal: true }).decode(buf); } catch (e) { return new TextDecoder('windows-1252').decode(buf); }
        });
    }

    // ------------------------------------------------------------------ CSV mapping
    const FIELDS = [
        { key: 'date', label: 'Date', required: true },
        { key: 'description', label: 'Description', required: true },
        { key: 'amount', label: 'Amount (one column)', mode: 'single' },
        { key: 'debit', label: 'Debit / charges (expenses)', mode: 'split' },
        { key: 'credit', label: 'Credit / deposits (income)', mode: 'split' },
        { key: 'store', label: 'Place / store (optional)' },
        { key: 'category', label: 'Category (optional)' },
        { key: 'balance', label: 'Balance (optional, updates your account)' }
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
        if (parsed.rows.length < 2) { UI.toast('We found no rows in that file. Is it a CSV?', 'error'); return; }
        const headerRow = guessHeaderRow(parsed.rows);
        session = { source: 'csv', name, all: parsed.rows, headerRow, include: {}, edits: {}, remember: true };
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
        // The account files like this one come from (checking, card…), remembered from last time.
        if (saved && saved.account && (Store.state.accounts || []).some(a => String(a.id) === String(saved.account))) s.account = String(saved.account);
        // What was applied to every row last time (e.g. "Luz eléctrica" → Servicios básicos).
        s.defaults = saved && saved.defaults ? Object.assign({}, saved.defaults) : null;
        recompute();
        renderSetup();
    }

    function recompute() {
        const cutoff = lastImportOf(session);
        const s = session;
        let rows;
        if (s.source === 'csv') rows = Importers.buildRows(s.table, Object.assign({ dateDefault: Store.COUNTRY === 'US' ? 'mdy' : 'dmy' }, s.mapping));
        else rows = s.base || s.rows;
        // The engine reads each line once: what it is, a clean name, and a guess. Files with no
        // signs at all (every amount positive) get the direction from the words (DEPOSIT, WITHDRAWAL…).
        const useEngine = s.source !== 'sri';
        const infos = rows.map(r => (useEngine && !r.error ? Categorize.parse(`${r.description}${r.store ? '\n' + r.store : ''}`) : null));
        Categorize.tidyNames(infos);
        const noSigns = s.source === 'csv' && s.mapping.mode !== 'split' && rows.some(r => !r.error) && rows.every(r => r.error || !(r.signed < 0));
        s.noSigns = noSigns;
        const guesses = Categorize.harmonize(rows.map((r, i) => {
            if (!infos[i]) return null;
            const sign = noSigns ? 0 : r.signed !== undefined && r.signed !== null ? Math.sign(r.signed) : r.type === 'Ingreso' ? 1 : -1;
            const g = Categorize.guess(infos[i], { sign, country: Store.COUNTRY });
            if (noSigns && g.type !== 'Transferencia' && infos[i].direction !== 'in' && g.type === 'Ingreso') g.type = 'Gasto';
            return g;
        }));
        // Transactions typed by hand (not from a file) can be the same money as a bank row.
        const manual = Store.state.transactions.filter(t => !t.importRef && !t.invoice && t.source !== 'csv');
        const used = new Set();
        const members = Store.state.members || [];
        s.rows = rows.map((r, i) => {
            const info = infos[i], g = guesses[i];
            const base = Object.assign({}, r, { type: g ? g.type : r.type, cleanName: info && info.name ? info.name : '' });
            const out = Object.assign(base, r.error ? { category: '', sub: '' } : resolve(base, s.catMap, g));
            out.key = out.rule ? out.rule.contains : g ? g.key || '' : out.cleanName || '';
            // Your changes: the ones for every row (saved for this kind of file) and then this row's own.
            const own = s.edits[i] || {};
            const e = Object.assign({}, s.defaults || {}, own);
            out.original = r.description;
            out.edited = Object.keys(own).some(k => ['type', 'category', 'sub', 'memberId'].includes(k));
            if (!r.error) {
                if (out.rename) out.description = out.rename;
                else if (out.cleanName) out.description = out.cleanName;
                else out.description = firstLine(r.description) || r.description;
                if (e.type && e.type !== out.type) {
                    out.type = e.type;
                    const fb = out.type === 'Transferencia' ? '' : fallbackCat(out.type);
                    Object.assign(out, { category: fb, sub: fb ? firstSub(taxFor(out.type), fb) : '', why: 'Chosen by you' });
                }
                if (out.type === 'Transferencia') Object.assign(out, { category: '', sub: '' });
                const tax = taxFor(out.type);
                if (out.type !== 'Transferencia') {
                    if (e.category && tax[e.category]) Object.assign(out, { category: e.category, sub: firstSub(tax, e.category), why: 'Chosen by you' });
                    if (e.sub && (tax[out.category] || []).includes(e.sub)) out.sub = e.sub;
                }
                if (e.description) out.description = e.description;
                if (e.budgetLine !== undefined && out.type === 'Gasto') out.budgetLine = e.budgetLine;
                if (e.memberId !== undefined) out.memberId = e.memberId || undefined;
            }
            out.ref = r.error ? '' : r.fitid ? 'ofx:' + r.fitid : Importers.importRef(r);
            const known = Store.state.transactions.concat(Store.state.excludedTxns || []);
            const dup = !r.error && (!!r.dupKey || Importers.isDuplicate(out, known) || Importers.isDuplicate(r, known) || known.some(t => t.importRef === out.ref));
            let match = null;
            if (!r.error && !dup) {
                const m = Importers.findMatch(out, manual, { exclude: used });
                if (m) { used.add(m.txn.id); match = { id: m.txn.id, description: m.txn.description, date: m.txn.date, days: m.days }; }
            }
            // On or before the account's last import: most likely already in (start unchecked).
            const before = !!(cutoff && r.date && r.date <= cutoff);
            const include = s.include[i] !== undefined ? s.include[i] : !r.error && !dup && !match && !before;
            return Object.assign(out, { dup, match, before, include: !r.error && include, isCard: !!(info && info.isCard) });
        });
        applyStreams(s, members);
        s.suggest = suggestions(s);
        renderPreview();
    }

    // ------------------------------------------------------------------ income streams
    // Each payer in the file (two employers, a side job…) is one stream of income. You say what it is —
    // your main paycheck (already counted from "Your salary"), an income line of your budget, a new
    // line, or extra money — and whose it is. Every deposit from that payer follows.
    const streamKey = (r) => Categorize.norm(r.key);
    function applyStreams(s, members) {
        const groups = {};
        s.rows.forEach((r, i) => { if (!r.error && r.type === 'Ingreso' && r.key) (groups[streamKey(r)] || (groups[streamKey(r)] = [])).push(i); });
        s.streams = s.streams || {};
        const lines = Store.active().otherIncomes || [];
        const list = Object.entries(groups).map(([k, ix]) => {
            const rs = ix.map(i => s.rows[i]);
            const total = rs.reduce((a, r) => a + r.amount, 0);
            const payroll = rs.some(r => r.sub === PAYROLL);
            return { k, ix, name: rs[0].key, count: rs.length, total, payroll, rule: rs[0].rule };
        }).filter(st => st.payroll || (st.rule && st.rule.incomeMode) || (s.streams[st.k] && s.streams[st.k].mode !== 'extra')).sort((a, b) => b.total - a.total);
        let mainTaken = Object.values(s.streams).some(x => x.mode === 'main');
        list.forEach(st => {
            if (!s.streams[st.k]) {
                const r = st.rule;
                let mode = r && r.incomeMode ? r.incomeMode : 'extra';
                if (mode === 'line' && !(lines.some(l => l.id === r.incomeId))) mode = 'new';
                if (!r && st.payroll) mode = !mainTaken ? 'main' : st.count >= 3 ? 'new' : 'extra';
                if (mode === 'main') mainTaken = true;
                s.streams[st.k] = { mode, lineId: mode === 'line' ? r.incomeId : null, memberId: r && r.memberId ? r.memberId : undefined };
            }
            const cfg = s.streams[st.k];
            st.cfg = cfg;
            st.ix.forEach(i => {
                const row = s.rows[i];
                if (!(s.edits[i] && s.edits[i].memberId !== undefined) && cfg.memberId) row.memberId = cfg.memberId;
                if (s.edits[i] && (s.edits[i].category || s.edits[i].type)) return;
                delete row.incomeId; delete row.newLine; row.countAsExtra = false;
                if (cfg.mode === 'main') Object.assign(row, { category: 'Ingresos Laborales', sub: PAYROLL });
                else if (cfg.mode === 'line' || cfg.mode === 'new') {
                    const line = cfg.mode === 'line' ? lines.find(l => l.id === cfg.lineId) : null;
                    const cat = line && incomeTax()[line.category] ? line.category : 'Ingresos Laborales';
                    Object.assign(row, { category: cat, sub: (incomeTax()[cat] || []).includes(row.sub) ? row.sub : cat === 'Ingresos Laborales' ? PAYROLL : firstSub(incomeTax(), cat), countAsExtra: true });
                    if (line) row.incomeId = line.id; else row.newLine = st.name;
                } else row.countAsExtra = row.sub === PAYROLL;
            });
        });
        s.streamList = list;
    }

    // Rules worth keeping: the same name more than once, when the guess wasn't a sure one or you
    // changed it (sure guesses come out the same next time anyway), and every income stream.
    function suggestions(s) {
        const usable = s.rows.map(r => (r.error || !r.include || r.conf === 'rule' ? Object.assign({}, r, { key: '' }) : r));
        return Categorize.suggestRules(usable, Store.state.rules).filter(g => {
            const rs = g.rows.map(i => s.rows[i]);
            return rs.some(r => r.edited || r.conf !== 'high' || (r.type === 'Ingreso' && s.streams[streamKey(r)])) && !rs.some(r => r.ask && !r.edited);
        }).map(g => {
            const r = s.rows[g.rows[0]];
            const st = r.type === 'Ingreso' ? s.streams[streamKey(r)] : null;
            return Object.assign(g, { on: !(s.ruleOff || {})[Categorize.norm(g.key)], memberId: st ? st.memberId : r.memberId, incomeMode: st ? st.mode : undefined, incomeId: st && st.mode === 'line' ? st.lineId : undefined });
        });
    }

    function renderSetup() {
        const s = session;
        UI.show('imp-setup', s.source === 'csv');
        if (s.source !== 'csv') return;
        UI.html('imp-profile-note', s.fromProfile ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> We used the setup you saved for files like this${s.defaults ? ` (and to every row: ${esc(bulkLabel(s.defaults))})` : ''}. You can change it.` : 'We read the headers and guessed what we could. Fix whatever\'s needed: the preview updates on its own.');
        const colOpts = (sel) => `<option value="-1">— None —</option>` + s.headers.map((h, i) => `<option value="${i}" ${Number(sel) === i ? 'selected' : ''}>${esc(h)}</option>`).join('');
        const m = s.mapping;
        const field = (f) => (f.mode && f.mode !== m.mode) ? '' : `<label class="field"><span class="field-label"><span>${f.label}</span>${f.required ? ' *' : ''}</span><select class="input" data-change="imp.map" data-key="${f.key}">${colOpts(m[f.key])}</select></label>`;
        const order = m.date >= 0 ? Importers.detectDateOrder(s.table.map(r => r[m.date]), Store.COUNTRY === 'US' ? 'mdy' : 'dmy') : 'dmy';
        const sel = (key, label, opts) => `<label class="field"><span class="field-label">${label}</span><select class="input" data-change="imp.map" data-key="${key}">${opts.map(([v, l]) => `<option value="${v}" ${String(m[key]) === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>`;
        UI.html('imp-map', [
            `<label class="field"><span class="field-label">Header row</span><input type="number" class="input" min="1" max="${s.all.length}" value="${s.headerRow + 1}" data-change="imp.headerRow"></label>`,
            sel('mode', 'Amounts come in…', [['single', 'One column (expenses with a sign)'], ['split', 'Two columns: debit and credit']]),
            ...FIELDS.map(field),
            m.mode === 'single' ? sel('expensesAre', 'In that column expenses are…', [['negative', 'Negative (−45.50)'], ['positive', 'Positive (everything is an expense)']]) : '',
            sel('dateFormat', 'Date format', [['auto', order === 'mdy' ? 'Detect (month first)' : 'Detect (day first)'], ['dmy', 'Day/Month/Year'], ['mdy', 'Month/Day/Year'], ['ymd', 'Year-Month-Day']]),
            sel('decimal', 'Decimal separator', [['auto', `Detectar (${{ '.': 'punto', ',': 'coma' }[detectedDecimal(s)] || 'row by row'})`], ['.', 'Dot (1,234.50)'], [',', 'Comma (1.234,50)']]),
        ].join(''));
        // First rows as they are in the file, so the columns are easy to recognize.
        UI.html('imp-raw', `<thead><tr>${s.headers.map(h => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${s.table.slice(0, 4).map(r => `<tr>${s.headers.map((_, i) => `<td class="text-xs" data-i18n-skip>${esc(r[i] || '').replace(/&lt;br\s*\/?&gt;/gi, '<br>')}</td>`).join('')}</tr>`).join('')}</tbody>`);
        // The file's own categories → ours.
        const values = m.category >= 0 ? [...new Set(s.table.map(r => r[m.category]).filter(Boolean))].slice(0, 60) : [];
        UI.show('imp-cats-panel', values.length > 0);
        if (values.length) {
            const opts = (v) => `<option value="">Automatic (rules / store)</option>` + Object.keys(expenseTax()).concat(Object.keys(incomeTax())).map(c => `<option value="${esc(c)}" ${s.catMap[v] === c || (!s.catMap[v] && Importers.norm(c) === Importers.norm(v)) ? 'selected' : ''}>${esc(c)}</option>`).join('');
            UI.html('imp-cats', values.map(v => `<label class="flex items-center gap-2 text-xs"><span class="flex-1 truncate font-semibold" title="${esc(v)}">${esc(v)}</span><i class="fa-solid fa-arrow-right text-slate-400"></i><select class="cell-input" style="width:14rem" data-change="imp.catMap" data-value="${esc(v)}">${opts(v)}</select></label>`).join(''));
        }
    }

    function renderPreview() {
        const s = session;
        UI.show('imp-preview-card', !!s);
        if (!s) return;
        const ok = s.rows.filter(r => r.include);
        const dups = s.rows.filter(r => r.dup).length, errs = s.rows.filter(r => r.error).length;
        const links = s.rows.filter(r => r.match && !r.include).length, matches = s.rows.filter(r => r.match).length;
        UI.html('imp-summary', `<strong>${esc(s.name)}</strong>: ${s.rows.length} row${s.rows.length === 1 ? '' : 's'} · <span class="text-emerald-700 font-bold">${ok.length} to import</span>${dups ? ` · ${dups} row${dups === 1 ? '' : 's'} already logged (unchecked)` : ''}${matches ? ` · <span class="text-amber-700 font-bold">${matches} look${matches === 1 ? 's' : ''} like what you already typed by hand</span>` : ''}${errs ? ` · <span class="text-red-600">${errs} with errors (skipped)</span>` : ''}`);
        document.getElementById('imp-commit').innerHTML = `<i class="fa-solid fa-file-import"></i> Importar ${ok.length}${links ? ` · vincular ${links}` : ''}`;
        document.getElementById('imp-commit').disabled = ok.length === 0 && links === 0;
        const members = Store.state.members || [];
        const ms = document.getElementById('imp-member');
        UI.show(ms, members.length > 0);
        if (members.length && !ms.options.length) ms.innerHTML = Views.whoOptions('', 'Whose? (no one)');
        renderBulk(ok.length);
        renderAccountPick(s);
        renderStreams();
        renderSuggest();
        const opt = (list, sel) => list.map(x => { const v = typeof x === 'string' ? x : x.value, l = typeof x === 'string' ? x : x.label; return `<option value="${esc(v)}" ${v === sel ? 'selected' : ''}>${esc(l)}</option>`; }).join('');
        const catOptions = (r) => opt(Object.keys(taxFor(r.type)), r.category);
        const subOptions = (r) => { const subs = (taxFor(r.type)[r.category] || []).slice(); if (r.sub && !subs.includes(r.sub)) subs.push(r.sub); return opt(subs, r.sub); };
        const whoOptions = (r) => `${Views.whoOptions(r.memberId || '')}<option value="new">+ Add a person…</option>`;
        const conf = (r) => r.conf === 'low' ? '<span class="badge badge-warn">Check</span> ' : '';
        const incomeNote = (r) => r.type !== 'Ingreso' ? '' : r.incomeId ? `<div class="text-[11px] text-emerald-700">Budget income: ${esc(((Store.active().otherIncomes || []).find(l => l.id === r.incomeId) || {}).name || '')}</div>` : r.newLine ? `<div class="text-[11px] text-emerald-700">New budget income: ${esc(r.newLine)}</div>` : r.sub === PAYROLL && !r.countAsExtra ? '<div class="text-[11px] text-slate-500">Your main paycheck (already counts in your budget)</div>' : '';
        UI.html('imp-rows', s.rows.slice(0, 500).map((r, i) => `<tr class="${r.error ? 'opacity-60' : ''}">
                <td class="text-center c-check"><input type="checkbox" class="w-4 h-4 accent-emerald-600" data-change="imp.toggle" data-i="${i}" ${r.include ? 'checked' : ''} ${r.error ? 'disabled' : ''} aria-label="Import"></td>
                <td class="whitespace-nowrap text-xs" data-label="Date">${esc(r.date || '—')}</td>
                <td class="c-wide" data-label="Description">${r.error ? `<div class="font-semibold text-xs">${esc(firstLine(r.description))}</div>` : `<input class="cell-input text-xs font-semibold imp-desc" value="${r.description === NO_DESC ? '' : esc(r.description)}" placeholder="No description: type one" data-change="imp.desc" data-i="${i}" aria-label="Description">${r.original && r.original !== NO_DESC && firstLine(r.original) !== r.description ? `<div class="text-[11px] text-slate-500">In the file: ${esc(firstLine(r.original).slice(0, 90))}</div>` : ''}${r.original && r.original !== NO_DESC && r.conf !== 'rule' && r.type !== 'Transferencia' ? `<button type="button" class="link text-[11px]" data-action="rule.add" data-contains="${esc((r.key || firstLine(r.original)).slice(0, 40))}" data-rename="${r.description !== firstLine(r.original) ? esc(r.description) : ''}" data-cat="${r.type === 'Ingreso' ? 'I' : 'G'}|${esc(r.category)}|${esc(r.sub || '')}" title="So next time it's named and categorized on its own">+ rule</button>` : ''}`}${r.store ? `<div class="text-[11px] text-slate-500">${esc(r.store)}</div>` : ''}${r.items && r.items.length ? `<div class="text-[11px] text-slate-500">${r.items.length} producto${r.items.length === 1 ? '' : 's'}${r.iva ? ` · IVA ${money(r.iva)}` : ''}</div>` : ''}</td>
                <td class="c-wide" data-label="Type and category">${r.error ? '—' : `<div class="imp-cat-grid">
                    <select class="cell-input text-xs" data-change="imp.type" data-i="${i}" aria-label="Type">${opt(TYPES, r.type)}</select>
                    ${r.type === 'Transferencia' ? '<span class="text-[11px] text-slate-500 self-center">Between your accounts: neither spending nor income</span>' : `<select class="cell-input text-xs" data-change="imp.cat" data-i="${i}" aria-label="Category">${catOptions(r)}</select>
                    <select class="cell-input text-xs" data-change="imp.sub" data-i="${i}" aria-label="Subcategory">${subOptions(r)}</select>`}
                </div>${r.why ? `<div class="text-[11px] text-slate-400">${conf(r)}${esc(r.why)}</div>` : conf(r) ? `<div class="text-[11px]">${conf(r)}</div>` : ''}${incomeNote(r)}${r.budgetLine && r.type === 'Gasto' ? `<div class="text-[11px] text-blue-600">Line: ${esc(lineName(r.budgetLine))}</div>` : ''}`}</td>
                <td data-label="Whose?">${r.error ? '' : `<select class="cell-input text-xs" data-change="imp.who" data-i="${i}" aria-label="Whose">${whoOptions(r)}</select>`}</td>
                <td class="num font-bold ${r.type === 'Ingreso' ? 'text-emerald-700' : ''}" data-label="Amount">${r.error ? '' : (r.type === 'Ingreso' ? '+' : r.type === 'Transferencia' ? '' : '−') + money(r.amount)}</td>
                <td class="text-xs" data-label="Status">${r.error ? `<span class="badge badge-bad">${esc(r.error)}</span>` : r.dup ? '<span class="badge badge-warn">Already exists</span>' : r.match ? matchCell(r, i) : r.before && !r.include ? '<span class="badge badge-info" title="On or before the last import into this account">Before last import</span>' : '<span class="badge badge-ok">New</span>'}</td>
            </tr>`).join('') + (s.rows.length > 500 ? `<tr><td colspan="7" class="text-xs text-slate-500">Showing 500 of ${s.rows.length}; all checked rows are imported.</td></tr>` : ''));
    }

    const firstLine = (t) => String(t || '').split(/<br\s*\/?>|\r?\n/i)[0].trim();

    function renderStreams() {
        const s = session, list = s.streamList || [];
        if (!list.length) { UI.html('imp-streams', ''); return; }
        const lines = Store.active().otherIncomes || [];
        const members = Store.state.members || [];
        const modes = (st) => [{ value: 'main', label: 'My main paycheck (already in «Your salary»)' }]
            .concat(lines.map(l => ({ value: 'line:' + l.id, label: `Budget income: ${l.name}` })))
            .concat([{ value: 'new', label: `New income in my budget: «${st.name}»` }, { value: 'extra', label: 'Extra income (not planned every month)' }]);
        const cur = (st) => st.cfg.mode === 'line' ? 'line:' + st.cfg.lineId : st.cfg.mode;
        UI.html('imp-streams', `<div class="panel tone-blue">
            <div class="section-label"><i class="fa-solid fa-sack-dollar text-emerald-600"></i> Your income in this file (${list.length})</div>
            <p class="help mb-2">If more than one paycheck comes into your household, say what each one is and whose. Your main paycheck already counts from «Your salary»; the others go in as budget income, so you can see when each one arrived.</p>
            <div class="space-y-2">${list.map(st => `<div class="imp-stream">
                <div class="min-w-0"><div class="font-bold text-sm truncate" data-i18n-skip>${esc(st.name)}</div><div class="text-[11px] text-slate-500"><span>${st.count} deposit${st.count === 1 ? '' : 's'}</span> · <span>${money(st.total)} in total</span></div></div>
                <select class="cell-input text-xs" data-change="imp.streamMode" data-k="${esc(st.k)}" aria-label="What it is">${modes(st).map(m => `<option value="${esc(m.value)}" ${m.value === cur(st) ? 'selected' : ''}>${esc(m.label)}</option>`).join('')}</select>
                <select class="cell-input text-xs" data-change="imp.streamWho" data-k="${esc(st.k)}" aria-label="Whose">${Views.whoOptions(st.cfg.memberId || '', 'Whose? —')}<option value="new">+ Add a person…</option></select>
            </div>`).join('')}</div></div>`);
    }

    function renderSuggest() {
        const s = session, list = s.suggest || [];
        if (!list.length) { UI.html('imp-suggest', ''); return; }
        const label = (g) => g.type === 'Transferencia' ? 'Transfer between accounts' : `${g.category}${g.sub ? ' › ' + g.sub : ''}`;
        const on = list.filter(g => g.on).length;
        const was = document.querySelector('#imp-suggest details');
        UI.html('imp-suggest', `<details class="panel tone-slate" ${was && was.open ? 'open' : ''}>
            <summary class="cursor-pointer text-sm font-bold"><i class="fa-solid fa-wand-magic-sparkles text-purple-600"></i> <span>Rules for next time</span> <span class="badge badge-info">${on} of ${list.length}</span></summary>
            <p class="help mt-2 mb-2">The checked ones are saved when you import: next time those names are categorized on their own. Change the category on a row and the rule follows your change.</p>
            <div class="space-y-1">${list.map(g => `<label class="flex items-center gap-2 text-xs"><input type="checkbox" class="w-4 h-4 accent-emerald-600" data-change="imp.ruleToggle" data-k="${esc(Categorize.norm(g.key))}" ${g.on ? 'checked' : ''}>
                <span class="font-semibold" data-i18n-skip>«${esc(g.key)}»</span><i class="fa-solid fa-arrow-right text-slate-400"></i><span>${esc(label(g))}</span><span class="text-slate-400">(${g.count})</span></label>`).join('')}</div>
        </details>`);
    }

    // A bank row that looks like something typed by hand: unchecked (it's the same money) until
    // you say it's a different purchase.
    function matchCell(r, i) {
        const when = r.match.days === 0 ? 'the same day' : `${r.match.days} día${r.match.days === 1 ? '' : 's'} ${r.match.date < r.date ? 'antes' : 'después'}`;
        return r.include
            ? `<span class="badge badge-ok">New</span><div class="text-[11px] text-slate-500 mt-1">You'll import both. <button type="button" class="link" data-action="imp.same" data-i="${i}">It's the same one</button></div>`
            : `<span class="badge badge-warn" title="Same amount, ${when}">Already logged it?</span><div class="text-[11px] text-slate-600 mt-1 imp-match">Same as «${esc(r.match.description)}» (${esc(r.match.date)}, typed by hand). It won't be duplicated. <button type="button" class="link" data-action="imp.other" data-i="${i}">It's a different expense</button></div>`;
    }

    // One change for every checked row: category, budget line and/or your own description.
    function renderBulk(n) {
        const s = session;
        const host = document.getElementById('imp-bulk');
        if (!host.dataset.ready || host.dataset.session !== s.name) {
            const cats = (tax, pre) => Object.keys(tax).map(c => `<option value="${pre}|${esc(c)}">${esc(c)}</option>`).join('');
            host.innerHTML = `
                <div class="section-label"><i class="fa-solid fa-layer-group text-blue-600"></i> Change all checked rows at once</div>
                <div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2">
                    <label class="field"><span class="field-label">Description</span><input id="imp-bulk-desc" class="input" placeholder="E.g. Electric bill" autocomplete="off" maxlength="120"></label>
                    <label class="field"><span class="field-label">Category</span><select id="imp-bulk-cat" class="input" data-change="imp.bulkCat"><option value="">— No change —</option><optgroup label="Expenses">${cats(expenseTax(), 'G')}</optgroup><optgroup label="Income">${cats(incomeTax(), 'I')}</optgroup></select></label>
                    <label class="field"><span class="field-label">Subcategory</span><select id="imp-bulk-sub" class="input" disabled><option value="">— Choose category —</option></select></label>
                    <label class="field"><span class="field-label">Budget line</span><select id="imp-bulk-line" class="input"><option value="-">— No change —</option><option value="">Automatic (by category)</option>${lineItems().map(i => `<option value="${i.id}">${esc(i.name)}</option>`).join('')}</select></label>
                </div>
                <div class="flex flex-wrap items-center gap-3 mt-2">
                    <button type="button" class="btn btn-primary btn-sm" data-action="imp.bulkApply" id="imp-bulk-apply"></button>
                    ${s.source === 'csv' ? `<label class="check text-xs"><input type="checkbox" data-change="imp.remember" ${s.remember ? 'checked' : ''}> Remember for files like this</label>` : ''}
                    <span class="help">You can still change any row on its own afterwards.</span>
                </div>`;
            host.dataset.ready = '1';
            host.dataset.session = s.name;
        }
        document.getElementById('imp-bulk-apply').innerHTML = `<i class="fa-solid fa-check-double"></i> Apply to ${n} checked row${n === 1 ? '' : 's'}`;
        document.getElementById('imp-bulk-apply').disabled = n === 0;
    }

    function endSession() {
        const bulk = document.getElementById('imp-bulk');
        if (bulk) { bulk.innerHTML = ''; delete bulk.dataset.ready; }
        session = null;
        UI.html('imp-member', '');
        ['imp-file', 'imp-xml'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        UI.show('imp-setup', false);
        UI.show('imp-preview-card', false);
        UI.text('imp-file-name', 'Your bank only gives Excel (.xlsx)? Open it and use "Save as → CSV".');
    }

    // ------------------------------------------------------------------ account
    // Which account the file is from: each transaction remembers it, and its balance follows the
    // file (its balance column) or the imported amounts. A card's balance is what you owe (below 0).
    const ACCOUNT_KINDS = { corriente: 'Checking', ahorros: 'Savings', efectivo: 'Cash', retiro: 'Retirement', tarjeta: 'Credit card' };
    // The date of the last import into the chosen account (unless "include them anyway").
    function lastImportOf(s) {
        if (!s || !s.account || s.ignoreLast) return '';
        const a = (Store.state.accounts || []).find(x => String(x.id) === String(s.account));
        return (a && a.lastImport) || '';
    }
    function fileBalance(s) { return s.source === 'csv' ? Importers.latestBalance(s.rows) : s.source === 'ofx' ? s.ofxBalance : null; }
    function renderAccountPick(s) {
        const el = document.getElementById('imp-ofx-account');
        if (!el) return;
        el.classList.toggle('hidden', s.source === 'xml');
        if (s.source === 'xml') return;
        const accts = Store.state.accounts || [];
        const opts = [['', 'No account (don\'t track a balance)']].concat(accts.map(a => [String(a.id), `${a.name} · ${ACCOUNT_KINDS[a.kind] || ACCOUNT_KINDS.corriente}`]),
            [['new:corriente', '+ New checking account'], ['new:ahorros', '+ New savings account'], ['new:tarjeta', '+ New credit card']]);
        const lb = fileBalance(s);
        const ok = s.rows.filter(r => r.include);
        const net = Engine.balanceAfterRows(0, ok);
        const acct = accts.find(a => String(a.id) === String(s.account));
        const before = s.rows.filter(r => r.before).length;
        const last = acct && acct.lastImport ? (s.ignoreLast
            ? `<p class="text-xs mt-2"><i class="fa-solid fa-circle-info text-blue-600"></i> <span>Last import into this account: ${esc(acct.lastImport)}.</span> <span>Rows before it are treated like the others.</span> <button type="button" class="link" data-action="imp.useLast">Uncheck them again</button></p>`
            : `<p class="text-xs mt-2"><i class="fa-solid fa-lock text-amber-600"></i> <span>Last import into this account: ${esc(acct.lastImport)}.</span> ${before ? `<span>${before} row${before === 1 ? '' : 's'} on or before that date start unchecked.</span> <button type="button" class="link" data-action="imp.ignoreLast">Include them anyway</button>` : '<span>Everything in this file is newer.</span>'}</p>`) : '';
        el.innerHTML = `<label class="field max-w-md"><span class="field-label">Which account is this file from?</span><select class="input" data-change="imp.account">${opts.map(([v, l]) => `<option value="${esc(v)}" ${String(s.account || '') === v ? 'selected' : ''}>${esc(l)}</option>`).join('')}</select>
            ${last}<span class="help">${!s.account ? 'Pick it to keep its balance and know where each transaction was made (your card or your checking).' : lb ? `The file's balance (${money(lb.balance)} as of ${esc(lb.date || '')}) becomes the account's balance.` : `No balance in the file: the account's balance moves by what you import (${(net >= 0 ? '+' : '−') + money(Math.abs(net))}).`}</span></label>`;
    }

    // ------------------------------------------------------------------ rules
    function renderRules() {
        const rules = Store.state.rules || [];
        UI.html('rule-body', rules.length ? rules.map(r => `<tr>
                <td class="font-semibold">“${esc(r.contains)}”</td>
                <td>${r.rename ? esc(r.rename) : '<span class="text-slate-400">—</span>'}</td>
                <td>${r.type === 'Transferencia' ? 'Transfer between accounts' : `<span>${esc(tr(r.category))}</span>${r.sub ? ` <span class="text-slate-400">› <span>${esc(tr(r.sub))}</span></span>` : ''}`}${r.incomeMode === 'main' ? '<div class="text-[11px] text-slate-500">Main paycheck</div>' : r.incomeId ? `<div class="text-[11px] text-emerald-700">Income: ${esc(((Store.active().otherIncomes || []).find(l => l.id === r.incomeId) || {}).name || '')}</div>` : ''}${r.memberId ? `<div class="text-[11px] text-slate-500">${esc(Views.whoName(r.memberId))}</div>` : ''}</td>
                <td class="text-xs">${r.budgetLine ? esc(lineName(r.budgetLine)) : '<span class="text-slate-400">Automatic</span>'}</td>
                <td class="text-center whitespace-nowrap"><button class="row-edit" data-action="rule.edit" data-id="${r.id}" title="Edit rule" aria-label="Edit rule"><i class="fa-solid fa-pen"></i></button><button class="row-del" data-action="rule.delete" data-id="${r.id}" title="Delete rule" aria-label="Delete rule"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No rules. Example: if it contains “SQ *COZ” → it\'s called “Cozy Coffee”, category Food.</td></tr>');
    }

    function lineName(id) {
        const items = Engine.monthItems(Store.effective(Store.state.activeYear), 'base');
        const it = items.find(i => String(i.id) === String(id));
        return it ? it.name : `(line ${id})`;
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
            sc.onerror = () => reject(new Error('offline'));
            document.head.appendChild(sc);
        });
    }

    // A new person of the household, from the import screen (same as Settings → Household).
    const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
    async function addMember() {
        const r = await UI.form({ title: 'Add person', message: 'Someone in your household who earns or spends money (shown in Settings → Your household).', fields: [{ name: 'name', label: 'Name', placeholder: 'E.g. Ana' }], confirmText: 'Add', validate: v => v.name.trim() ? null : 'Type a name.' });
        if (!r) return null;
        const list = Store.state.members || (Store.state.members = []);
        const used = new Set(list.map(p => p.color));
        const p = { id: Store.nextId(list), name: r.name.trim().slice(0, 30), color: MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[list.length % MEMBER_COLORS.length] };
        list.push(p);
        Store.scheduleSave();
        const ms = document.getElementById('imp-member');
        if (ms) ms.innerHTML = '';
        return p.id;
    }

    UI.register({
        'imp.file': async (el) => {
            const file = el.files && el.files[0];
            if (!file) return;
            if (/\.xlsx?$/i.test(file.name)) { UI.toast('That\'s an Excel file. Open it and save it as CSV, then pick it here.', 'error'); el.value = ''; return; }
            UI.text('imp-file-name', `${file.name} · ${file.size < 1024 ? file.size + ' bytes' : Math.round(file.size / 1024) + ' KB'}`);
            const text = await readText(file);
            const ofx = Importers.parseOFX(text);
            if (ofx) {
                // OFX/QFX: no columns to map; each movement has a unique id (FITID).
                if (!ofx.rows.length) { UI.toast('We found no transactions in that OFX file.', 'error'); return; }
                session = { source: 'ofx', name: file.name, rows: ofx.rows, base: ofx.rows, include: {}, edits: {}, catMap: {}, ofxBalance: ofx.balance };
                recompute();
                renderSetup();
                renderPreview();
                return;
            }
            startSession(file.name, text);
        },
        'imp.headerRow': (el) => {
            if (!session) return;
            session.headerRow = Math.max(0, Math.min(session.all.length - 2, (parseInt(el.value, 10) || 1) - 1));
            session.include = {}; session.edits = {};
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
        // Rows you checked or unchecked yourself keep your choice; the others follow the account.
        'imp.account': (el) => { if (session) { session.account = el.value; recompute(); } },
        'imp.ignoreLast': () => { if (session) { session.ignoreLast = true; recompute(); } },
        'imp.useLast': () => { if (session) { session.ignoreLast = false; recompute(); } },
        'imp.cat': (el) => { if (!session) return; editRow(Number(el.dataset.i), { category: el.value, sub: undefined }); recompute(); },
        'imp.sub': (el) => { if (!session) return; const i = Number(el.dataset.i); editRow(i, { category: session.rows[i].category, sub: el.value }); recompute(); },
        'imp.type': (el) => { if (!session) return; editRow(Number(el.dataset.i), { type: el.value, category: undefined, sub: undefined }); recompute(); },
        'imp.who': async (el) => {
            if (!session) return;
            const id = el.value === 'new' ? await addMember() : el.value ? Number(el.value) : 0;
            if (id === null) { renderPreview(); return; }
            editRow(Number(el.dataset.i), { memberId: id });
            recompute();
        },
        'imp.streamMode': (el) => {
            if (!session) return;
            const st = session.streams[el.dataset.k];
            if (!st) return;
            const [mode, id] = el.value.split(':');
            if (mode === 'main') Object.values(session.streams).forEach(x => { if (x !== st && x.mode === 'main') x.mode = 'new'; });
            Object.assign(st, { mode, lineId: mode === 'line' ? Number(id) : null });
            recompute();
        },
        'imp.streamWho': async (el) => {
            if (!session) return;
            const st = session.streams[el.dataset.k];
            if (!st) return;
            const id = el.value === 'new' ? await addMember() : el.value ? Number(el.value) : undefined;
            if (id === null) { renderStreams(); return; }
            st.memberId = id || undefined;
            recompute();
        },
        'imp.ruleToggle': (el) => { if (!session) return; (session.ruleOff || (session.ruleOff = {}))[el.dataset.k] = !el.checked; session.suggest.forEach(g => { if (Categorize.norm(g.key) === el.dataset.k) g.on = el.checked; }); renderSuggest(); },
        'imp.desc': (el) => { if (!session) return; editRow(Number(el.dataset.i), { description: el.value.trim().slice(0, 120) }); recompute(); },
        'imp.bulkCat': (el) => {
            const sub = document.getElementById('imp-bulk-sub');
            const cat = el.value.slice(2), tax = el.value.startsWith('I|') ? incomeTax() : expenseTax();
            sub.innerHTML = cat ? (tax[cat] || []).map(c => `<option>${esc(c)}</option>`).join('') : '<option value="">— Choose category —</option>';
            sub.disabled = !cat;
        },
        'imp.bulkApply': () => {
            if (!session) return;
            const s = session;
            const catVal = document.getElementById('imp-bulk-cat').value;
            const change = {};
            if (catVal) { change.category = catVal.slice(2); change.sub = document.getElementById('imp-bulk-sub').value || undefined; }
            const line = document.getElementById('imp-bulk-line').value;
            if (line !== '-') change.budgetLine = line;
            const desc = document.getElementById('imp-bulk-desc').value.trim().slice(0, 120);
            if (desc) change.description = desc;
            if (!Object.keys(change).length) { UI.toast('Pick a category, a line or type a description to apply.', 'error'); return; }
            const targets = s.rows.map((r, i) => (r.include ? i : -1)).filter(i => i >= 0);
            if (!targets.length) { UI.toast('Check at least one row.', 'error'); return; }
            let skipped = 0;
            targets.forEach(i => {
                const r = s.rows[i];
                const tax = r.type === 'Ingreso' ? incomeTax() : expenseTax();
                const c = Object.assign({}, change);
                if (c.category && !tax[c.category]) { delete c.category; delete c.sub; skipped++; }
                editRow(i, c);
            });
            // Kept for next time (only when it was applied to the whole file).
            s.bulk = targets.length === s.rows.filter(r => !r.error).length ? Object.assign({}, s.bulk || {}, change) : null;
            recompute();
            UI.toast([`Applied to ${targets.length} row${targets.length === 1 ? '' : 's'}.`, skipped ? `The category wasn't changed on ${skipped} (${change.category} isn't that type).` : ''].filter(Boolean).map(x => (window.I18n ? I18n.t(x) : x)).join(' '));
        },
        'imp.remember': (el) => { if (session) session.remember = el.checked; },
        'imp.same': (el) => { if (!session) return; session.include[Number(el.dataset.i)] = false; recompute(); },
        'imp.other': (el) => { if (!session) return; session.include[Number(el.dataset.i)] = true; recompute(); },
        'imp.toggle': (el) => { if (!session) return; session.include[Number(el.dataset.i)] = el.checked; recompute(); },
        'imp.toggleAll': (el) => { if (!session) return; session.rows.forEach((r, i) => { if (!r.error) session.include[i] = el.checked; }); recompute(); },
        'imp.cancel': () => endSession(),
        'imp.commit': () => {
            if (!session) return;
            const s = session;
            const rows = s.rows.filter(r => r.include);
            const txns = Store.state.transactions;
            let id = Store.nextId(txns);
            const memberId = Number(document.getElementById('imp-member').value) || undefined;
            // Income streams you marked as a new budget income: one line each (this year's budget),
            // planned at what arrived per month on average.
            const yd = Store.active();
            const lines = yd.otherIncomes || (yd.otherIncomes = []);
            const newLines = {};
            let newLineCount = 0;
            rows.filter(r => r.type === 'Ingreso' && r.newLine).forEach(r => {
                const k = Categorize.norm(r.newLine);
                if (!newLines[k]) newLines[k] = { name: r.newLine, rows: [] };
                newLines[k].rows.push(r);
            });
            Object.values(newLines).forEach(n => {
                const months = new Set(n.rows.map(r => r.date.slice(0, 7))).size || 1;
                const line = { id: Store.nextId(lines), name: n.name.slice(0, 60), amount: Math.round(n.rows.reduce((a, r) => a + r.amount, 0) / months * 100) / 100, category: 'Ingresos Laborales' };
                lines.push(line);
                n.id = line.id;
                newLineCount++;
                // Next time, deposits from this payer go to this line (the rule saved below says so).
                const st = (s.streams || {})[Categorize.norm(n.name)];
                if (st && st.mode === 'new') Object.assign(st, { mode: 'line', lineId: line.id });
            });
            // The account the file is from (created now if new).
            const accts = Store.state.accounts || (Store.state.accounts = []);
            let acct = null;
            if (s.account && s.account.startsWith('new:')) {
                const kind = s.account.slice(4);
                acct = { id: Store.nextId(accts), name: (s.name || '').replace(/\.[^.]+$/, '').slice(0, 40) || ACCOUNT_KINDS[kind], kind, balance: 0, updatedAt: Engine.isoDate(new Date()) };
                accts.push(acct);
            } else if (s.account) acct = accts.find(a => String(a.id) === String(s.account)) || null;
            const year = String(Store.state.activeYear);
            rows.forEach(r => {
                const desc = r.description && r.description !== NO_DESC ? r.description : (r.store || r.category || r.type);
                const tr = r.type === 'Transferencia';
                const t = { id: id++, type: r.type, description: firstLine(desc).slice(0, 120), store: (r.store || '').slice(0, 80), parentCategory: tr ? 'Transferencia' : r.category, category: tr ? '' : r.sub || '', amount: r.amount, date: r.date,
                    paymentType: tr ? 'Transferencia' : r.payment || (r.isCard ? 'Tarjeta de Crédito' : 'Transferencia'), source: s.source };
                if (r.budgetLine && r.type === 'Gasto') t.budgetLine = String(r.budgetLine);
                // The bank's own text, shown under the payee in the transaction's details.
                if (r.original && r.original !== NO_DESC && firstLine(r.original) !== t.description) t.original = firstLine(r.original).slice(0, 120);
                // A transfer keeps its direction (into or out of the account) for the account's activity.
                if (tr && Number(r.signed)) t.signed = Math.sign(Number(r.signed)) * Math.abs(Number(r.amount) || 0);
                if (acct) { t.accountId = acct.id; if (acct.kind === 'tarjeta' && !tr) t.paymentType = 'Tarjeta de Crédito'; }
                if (r.invoice) t.invoice = r.invoice;
                if (r.ref) t.importRef = r.ref;
                if (r.type === 'Ingreso') {
                    const lineId = r.incomeId || (r.newLine && (newLines[Categorize.norm(r.newLine)] || {}).id);
                    // A line of this year's budget only receives this year's deposits.
                    if (lineId && r.date.slice(0, 4) === year) t.incomeId = lineId;
                    if (r.countAsExtra) t.countAsExtra = true;
                }
                // Bills (housing, utilities, insurance) are the household's when no person is chosen.
                const who = r.memberId || memberId || ((Store.state.members || []).length && !tr && Engine.HOUSEHOLD_CATEGORIES.includes(t.parentCategory) ? Engine.HOUSEHOLD : undefined);
                if (who) t.memberId = who;
                // A subcategory the engine suggested that isn't in your list yet ("Inversiones (bolsa)").
                if (!tr && t.category) { const tax = taxFor(r.type); if (tax[t.parentCategory] && !tax[t.parentCategory].includes(t.category)) tax[t.parentCategory].push(t.category); }
                txns.push(t);
            });
            // The rules you kept checked: next time these names sort themselves.
            const rules = Store.state.rules || (Store.state.rules = []);
            let ruleCount = 0;
            (s.suggest || []).filter(g => g.on).forEach(g => {
                if (rules.some(x => Categorize.norm(x.contains) === Categorize.norm(g.key))) return;
                const rule = { id: Store.nextId(rules), contains: g.key.slice(0, 60), category: g.type === 'Transferencia' ? '' : g.category, type: g.type };
                if (g.sub) rule.sub = g.sub;
                if (g.memberId) rule.memberId = g.memberId;
                if (g.type === 'Ingreso' && g.incomeMode) {
                    const st = Object.entries(s.streams || {}).find(([k]) => k === Categorize.norm(g.key));
                    const cfg = st ? st[1] : null;
                    rule.incomeMode = cfg ? cfg.mode : g.incomeMode;
                    if (cfg && cfg.mode === 'line') rule.incomeId = cfg.lineId;
                }
                rules.push(rule);
                ruleCount++;
            });
            // Remember how this kind of file maps (not the file): next time it's automatic.
            if (s.source === 'csv') {
                const profiles = Store.state.settings.importProfiles || (Store.state.settings.importProfiles = {});
                const { date, description, amount, debit, credit, store, category, mode, dateFormat, decimal, expensesAre } = s.mapping;
                const prev = profiles[s.signature];
                const defaults = s.remember ? (s.bulk ? Object.assign({}, s.defaults || {}, s.bulk) : s.defaults) : null;
                profiles[s.signature] = { mapping: { date, description, amount, debit, credit, store, category, mode, dateFormat, decimal, expensesAre }, catMap: s.catMap, name: s.name, savedAt: new Date().toISOString().slice(0, 10) };
                if (acct) profiles[s.signature].account = acct.id;
                if (defaults && Object.keys(defaults).length) profiles[s.signature].defaults = defaults;
                else if (prev && prev.defaults && s.remember && !s.bulk) profiles[s.signature].defaults = prev.defaults;
            }
            // The account's balance: the statement's own (a card statement's is what you owe), or
            // moved by what came in and went out. A card linked to a debt keeps that debt in step.
            let balanceNote = '';
            if (acct) {
                const lb = fileBalance(s);
                if (lb) { acct.balance = acct.kind === 'tarjeta' ? -Math.abs(lb.balance) : lb.balance; acct.updatedAt = lb.date || acct.updatedAt; }
                else if (rows.length) { acct.balance = Engine.balanceAfterRows(acct.balance, rows); acct.updatedAt = rows.reduce((d, r) => (r.date > d ? r.date : d), acct.updatedAt || ''); }
                const debt = acct.kind === 'tarjeta' && acct.debtId ? (Store.state.debts || []).find(d => d.id === acct.debtId) : null;
                if (debt) debt.balance = Math.max(0, -acct.balance);
                // The newest imported date: next time, rows up to it start unchecked.
                const newest = rows.reduce((d, r) => (r.date > d ? r.date : d), '');
                if (newest && newest > (acct.lastImport || '')) acct.lastImport = newest;
                balanceNote = ` "${acct.name}" balance: ${acct.balance < 0 ? '−' : ''}${money(Math.abs(acct.balance))}.`;
            }
            // Rows that are the same money as a hand-typed transaction: nothing new is added, but the
            // manual one remembers the bank row so the next statement recognizes it right away.
            let linked = 0;
            s.rows.forEach(r => {
                if (r.include || !r.match) return;
                const t = txns.find(x => x.id === r.match.id);
                if (t && !t.importRef) { t.importRef = r.ref; if (r.invoice && !t.invoice) t.invoice = r.invoice; linked++; }
            });
            const skipped = s.rows.length - rows.length - linked;
            endSession();
            App.changed({ structural: true, step: true });
            // Short sentences, one per fact (each one is translated on its own).
            const pl = (n) => (n === 1 ? '' : 's');
            const parts = [`${rows.length} transaction${pl(rows.length)} imported.`];
            if (skipped) parts.push(`${skipped} row${pl(skipped)} skipped.`);
            if (linked) parts.push(`${linked} transaction${pl(linked)} already typed by hand: not duplicated.`);
            if (ruleCount) parts.push(`${ruleCount} rule${pl(ruleCount)} saved.`);
            if (newLineCount) parts.push(`${newLineCount} new income line${pl(newLineCount)} in your budget.`);
            if (balanceNote) parts.push(balanceNote.trim());
            parts.push('Review them in Transactions.');
            UI.toast(parts.map(x => (window.I18n ? I18n.t(x) : x)).join(' · '), 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
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
            if (bad.length) UI.toast(`${bad.length === 1 ? 'This doesn\'t look like an SRI invoice' : 'These don\'t look like SRI invoices'}: ${bad.join(', ')}`, 'error');
            if (!rows.length) { el.value = ''; return; }
            session = { source: 'sri', name: `${rows.length} electronic invoice${rows.length === 1 ? '' : 's'}`, rows, base: rows, include: {}, edits: {}, catMap: {} };
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
            status('<i class="fa-solid fa-spinner fa-spin"></i> Getting the text reader ready…');
            try {
                const T = await loadTesseract();
                const worker = await T.createWorker('spa', 1, { logger: m => { if (m.status === 'recognizing text') status(`<i class="fa-solid fa-spinner fa-spin"></i> Reading the photo… ${Math.round((m.progress || 0) * 100)}%`); } });
                const { data } = await worker.recognize(file);
                await worker.terminate();
                const r = Importers.parseReceiptText(data.text);
                const res = resolve({ type: 'Gasto', description: r.merchant, store: '' }, {}, r.merchant ? Categorize.guess(Categorize.parse(r.merchant), { sign: -1, country: Store.COUNTRY }) : null);
                status(r.total ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> We read ${r.merchant ? `<strong>${esc(r.merchant)}</strong>, ` : ''}total <strong>${money(r.total)}</strong>${r.date ? `, date ${esc(r.date)}` : ''}. Review and save.` : '<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> We couldn\'t find the total in the photo. Fill in the details by hand.');
                TxnForm.prefill({ type: 'Gasto', description: r.merchant || 'Factura', amount: r.total || '', date: r.date || '', parent: res.category, sub: res.sub });
            } catch (e) {
                status('<i class="fa-solid fa-triangle-exclamation text-red-600"></i> Couldn\'t read the photo (internet is needed the first time). You can log the receipt by hand in Transactions.');
            } finally { el.value = ''; }
        },
        'rule.add': async (el) => {
            const pre = (el && el.dataset) || {};
            const [pk, pc, ps] = (pre.cat || '').split('|');
            const r = await UI.form({
                title: 'New automatic rule',
                message: 'It\'s an exact text match you define: no guessing.',
                fields: [
                    { name: 'contains', label: 'If the description or place contains…', placeholder: 'E.g. SQ *COZ or walmart', value: pre.contains || '' },
                    { name: 'rename', label: 'Rename to (optional)', placeholder: 'E.g. Cozy Coffee', value: pre.rename || '' },
                    { name: 'cat', label: 'Category › subcategory', options: ruleCategoryOptions(), value: pk ? ruleCategoryValue(pk, pc, ps) : undefined, help: 'The same list as Settings → Categories.' },
                    { name: 'line', label: 'Budget line', options: ruleLineOptions(), more: true, help: RULE_LINE_HELP }
                ],
                confirmText: 'Create rule',
                validate: v => v.contains.trim().length < 2 ? 'Type at least 2 letters.' : !v.cat ? 'Pick a category.' : null
            });
            if (!r) return;
            const [k, cat, sub] = r.cat.split('|');
            const rules = Store.state.rules || (Store.state.rules = []);
            const rule = { id: Store.nextId(rules), contains: r.contains.trim().slice(0, 60) };
            if (k === 'T') Object.assign(rule, { type: 'Transferencia', category: '' });
            else Object.assign(rule, { type: k === 'I' ? 'Ingreso' : 'Gasto', category: cat }, sub ? { sub } : {}, r.line && k === 'G' ? { budgetLine: r.line } : {});
            if (r.rename.trim()) rule.rename = r.rename.trim().slice(0, 80);
            rules.push(rule);
            // Transactions you already have that the rule would have caught: offer to fix them too.
            const hits = Store.state.transactions.filter(t => Importers.applyRules([rule], `${t.description} ${t.store || ''}`));
            let fixed = 0;
            if (hits.length && await UI.confirm({ title: 'Apply to what you already have', message: `${hits.length === 1 ? 'A transaction you already have contains' : `${hits.length} transactions you already have contain`} «${rule.contains}». Apply the rule to ${hits.length === 1 ? 'it' : 'them'} (${[rule.rename ? `name «${rule.rename}»` : '', k === 'T' ? '' : `category ${ruleCategoryText(rule)}`].filter(Boolean).map(x => tr(x)).join(', ')})?`, confirmText: `Apply to ${hits.length}` })) {
                hits.forEach(t => {
                    const tax = (t.type || 'Gasto') === 'Ingreso' ? incomeTax() : expenseTax();
                    if (rule.rename) t.description = rule.rename;
                    // No subcategory in the rule: one already in that category stays.
                    if (k !== 'T' && tax[rule.category]) { const subs = tax[rule.category]; t.category = rule.sub && subs.includes(rule.sub) ? rule.sub : t.parentCategory === rule.category && subs.includes(t.category) ? t.category : firstSub(tax, rule.category); t.parentCategory = rule.category; }
                    if (rule.budgetLine && (t.type || 'Gasto') !== 'Ingreso') t.budgetLine = String(rule.budgetLine);
                    fixed++;
                });
            }
            if (session) recompute();
            App.changed({ structural: true, step: true });
            UI.toast(`Rule created${fixed ? `  and applied to ${fixed} transaction${fixed === 1 ? '' : 's'}` : ''}.`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
        },
        // Change any part of a rule (a typo in the text, the wrong category, person or line).
        'rule.edit': async (el) => {
            const rule = (Store.state.rules || []).find(r => String(r.id) === el.dataset.id);
            if (!rule) return;
            const kind = rule.type === 'Transferencia' ? 'T' : (rule.type === 'Ingreso' || (!expenseTax()[rule.category] && incomeTax()[rule.category])) ? 'I' : 'G';
            const cats = ruleCategoryOptions();
            const cur = ruleCategoryValue(kind, rule.category, rule.sub);
            // A category that was deleted since: keep it as it is until another is picked.
            if (!cur) cats.unshift({ value: `${kind}|${rule.category}|${rule.sub || ''}`, label: ruleCategoryText(rule) });
            const members = Store.state.members || [];
            const r = await UI.form({
                title: 'Edit rule',
                fields: [
                    { name: 'contains', label: 'If the description or place contains…', value: rule.contains },
                    { name: 'rename', label: 'Rename to (optional)', value: rule.rename || '' },
                    { name: 'cat', label: 'Category › subcategory', options: cats, value: cur || `${kind}|${rule.category}|${rule.sub || ''}`, help: 'The same list as Settings → Categories.' },
                    { name: 'member', label: 'Whose', options: [{ value: '', label: '—' }, { value: String(Engine.HOUSEHOLD), label: 'Household (shared)' }].concat(members.map(p => ({ value: String(p.id), label: p.name }))), value: rule.memberId ? String(rule.memberId) : '', more: true },
                    { name: 'line', label: 'Budget line', options: ruleLineOptions(), value: rule.budgetLine ? String(rule.budgetLine) : '', more: true, help: RULE_LINE_HELP }
                ],
                confirmText: 'Save',
                validate: v => v.contains.trim().length < 2 ? 'Type at least 2 letters.' : !v.cat ? 'Pick a category.' : null
            });
            if (!r) return;
            App.undoable('Rule updated', () => {
                const [k, cat, sub] = r.cat.split('|');
                rule.contains = r.contains.trim().slice(0, 60);
                if (r.rename.trim()) rule.rename = r.rename.trim().slice(0, 80); else delete rule.rename;
                if (k === 'T') { rule.type = 'Transferencia'; rule.category = ''; delete rule.sub; }
                else {
                    rule.type = k === 'I' ? 'Ingreso' : 'Gasto';
                    rule.category = cat;
                    if (sub) rule.sub = sub; else delete rule.sub;
                }
                // Income links only make sense for income.
                if (k !== 'I') { delete rule.incomeMode; delete rule.incomeId; }
                if (r.member) rule.memberId = Number(r.member); else delete rule.memberId;
                if (r.line && k === 'G') rule.budgetLine = r.line; else delete rule.budgetLine;
            });
            if (session) recompute();
        },
        'rule.delete': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Rule deleted', () => { Store.state.rules = Store.state.rules.filter(r => r.id !== id); });
        }
    });

    App.defineView('transacciones/importar', { render, update: render });
    // For tests and for other views.
    window.ImportSession = { get: () => session, start: startSession, resolve };
})();
