// Language sweep: both editions in both languages, every screen (its folded sections open) and the
// dialogs and sheets its buttons open, with the example family. Lists what's in the wrong language:
// Spanish in English, English in Spanish. Names people type (data-i18n-skip) are left alone.
// `node tests/e2e/lang-sweep.js ["us en"]` runs the combinations whose label has that text.
const { launch, ROOT, tailwind, OUT } = require('./harness');
const path = require('path');
const fs = require('fs');

const VIEWS = ['resumen', 'presupuesto/plan', 'presupuesto/ingresos', 'transacciones/lista', 'transacciones/importar', 'transacciones/reportes',
    'futuro/metas', 'futuro/proyeccion', 'futuro/polizas', 'futuro/hipoteca', 'futuro/jubilacion', 'futuro/calculadoras', 'patrimonio', 'config'];
// Buttons not pressed: what deletes, erases, leaves, needs a file or switches language or theme.
const SKIP_BUTTON = /delete|\.del$|del\b|remove|purge|erase|wipe|reset|startOwn|lockNow|setPin|removePin|exclude|upload|openVault|fileChosen|print|download|csv|app\.undo|app\.redo|import\.|scan|ocr|photo|camera|share|copyQuick|example|baseline\.restore|sample|copyYear|propagate|lang|theme|cam\./i;
// Meant to stay as they are, in either language: names of institutions, programs and forms, the
// language switch itself.
const ALLOWED = {
    en: [/^Cambiar a español$/, /^Español$/, /^ES$/, /^[A-Z]{2,5}$/, /^Capital One$/, /^Cable\/TV$/, /Manicure\/Pedicure/, /^“[^”]+”$/, /Superintendencia de Bancos/, /^(SEPS|COSEDE|IESS|SRI|BIESS|SBU|RUC|RIMPE|DPF)\b/],
    es: [/^Switch to English$/, /^English$/, /^EN$/, /^[A-Z]{2,5}$/, /^ZeroDebtPlan$/, /^Ideas:?$/,
        // US legal and tax terms kept in English next to the Spanish (what the forms say).
        /\((will|durable power of attorney|living will|health care proxy)\)/, /"transfer on death"/]
};

// In the page: the visible text in the wrong language (`want`: the language it should be in).
const wrong = (want) => {
    const tokens = (s) => String(s).toLowerCase().split(/[^a-z0-9áéíóúñü]+/).filter(w => w && !/\d/.test(w));
    const words = (arr) => new Set([].concat(...arr.map(tokens)).filter(w => w.length >= 4));
    const was = I18n.lang;
    // Spanish: the Spanish source texts and every Spanish translation; English: the English texts.
    const enKeys = I18n.keys('es');
    if (was !== 'es') I18n.setLang('es');
    // (Only real translations: a text left as it is says nothing about its language.)
    const esVals = enKeys.map(k => I18n.t(k)).filter((v, i) => v !== enKeys[i]);
    I18n.setLang('en');
    const esKeys = I18n.keys('en');
    const enVals = esKeys.map(k => I18n.t(k)).filter((v, i) => v !== esKeys[i]);
    I18n.setLang(was);
    const ES = words(I18n.keys('en').concat(esVals)), EN = words(enKeys.concat(enVals));
    const onlyES = new Set([...ES].filter(w => !EN.has(w))), onlyEN = new Set([...EN].filter(w => !ES.has(w)));
    const SHORT_ES = new Set(['de', 'del', 'la', 'las', 'los', 'el', 'para', 'con', 'por', 'que', 'una', 'tus', 'sus', 'mes', 'al', 'es', 'tu', 'su', 'sin', 'más', 'muy', 'hay']);
    const SHORT_EN = new Set(['the', 'and', 'your', 'you', 'with', 'for', 'this', 'that', 'from', 'are', 'will', 'have', 'what', 'when', 'than', 'each', 'only', 'just', 'also', 'into', 'been', 'does', 'they', 'them', 'their', 'there', 'here', 'which', 'would', 'should', 'could', 'about', 'per', 'its', 'of', 'to', 'is', 'it', 'or', 'an', 'in', 'on', 'at', 'by', 'be', 'do', 'if', 'we', 'up']);
    // Names people typed (the example family's lines, stores, accounts, goals…) stay as typed in
    // either language: taken out of the text first. Saved Spanish identifiers ('Alimentación')
    // have a translation, so they stay in and are checked.
    const typed = new Set();
    const walk = (o, d) => {
        if (!o || typeof o !== 'object' || d > 8) return;
        if (Array.isArray(o)) { o.forEach(x => walk(x, d + 1)); return; }
        ['name', 'description', 'store'].forEach(k => { const v = o[k]; if (typeof v === 'string' && v.length >= 3 && v.length < 120 && /[A-Za-z]/.test(v) && I18n.t(v) === v) typed.add(v); });
        Object.keys(o).forEach(k => { if (o[k] && typeof o[k] === 'object') walk(o[k], d + 1); });
    };
    walk(Store.state, 0);
    const reEsc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const names = [...typed].sort((a, b) => b.length - a.length);
    // Whole names only (never a piece of a word).
    const typedRe = names.length ? new RegExp('(?<![\\p{L}\\d])(?:' + names.map(reEsc).join('|') + ')(?![\\p{L}\\d])', 'gu') : null;
    const strip = (t) => (typedRe ? t.replace(typedRe, ' ') : t);
    const isBad = want === 'en'
        ? (t) => /[áéíóúñ¿¡]/.test(t) || tokens(t).some(w => onlyES.has(w) || SHORT_ES.has(w))
        : (t) => tokens(t).some(w => onlyEN.has(w) || SHORT_EN.has(w));
    const bad = (t) => isBad(strip(t));
    const out = [];
    const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && (r.width > 0 || r.height > 0); };
    const roots = [document.querySelector('header'), document.querySelector('main'), ...document.querySelectorAll('.modal-backdrop:not(.hidden)'), document.getElementById('toast-host')].filter(Boolean);
    for (const r of roots) {
        const w = document.createTreeWalker(r, NodeFilter.SHOW_TEXT);
        let n;
        while ((n = w.nextNode())) {
            const t = n.nodeValue.replace(/\s+/g, ' ').trim();
            const el = n.parentElement;
            if (!t || !el || el.closest('[data-i18n-skip], script, style, textarea, .hidden') || !/[a-zA-Záéíóúñ]{2}/.test(t)) continue;
            if (el.tagName !== 'OPTION' && !vis(el)) continue;
            if (bad(t)) out.push(t.slice(0, 160));
        }
        r.querySelectorAll('[placeholder], [title], [aria-label]').forEach(el => {
            if (el.closest('[data-i18n-skip]') || !vis(el)) return;
            ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v && bad(v)) out.push('@' + a + ': ' + v.slice(0, 140)); });
        });
    }
    return out;
};

async function open(browser, file, lang) {
    const ctx = await browser.newContext({ viewport: { width: 1366, height: 900 } });
    await ctx.route(/^https?:/, r => {
        const u = r.request().url();
        if (/cdn\.tailwindcss\.com/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' });
        if (/chart\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'mobile/node_modules/chart.js/dist/chart.umd.js')) });
        return r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('dialog', d => d.dismiss().catch(() => {}));
    await page.goto('file://' + path.join(ROOT, file));
    await page.addStyleTag({ content: tailwind() });
    await page.waitForTimeout(500);
    await page.evaluate((l) => { window.open = () => null; Device.setLang(l); }, lang);
    return { ctx, page, errors };
}

const fresh = (page, v) => page.evaluate((k) => {
    document.querySelectorAll('.modal-backdrop').forEach(m => m.remove());
    Store.reset('example'); Store.state.settings.welcomeDismissed = true; Store.ui.trends = null;
    App.changed({ structural: true }); App.go(k, { scroll: false });
    document.querySelectorAll('main details').forEach(d => { d.open = true; });
}, v).then(() => page.waitForTimeout(120));

(async () => {
    const browser = await launch();
    const only = (process.argv[2] || '').toLowerCase();
    const runs = [['US en', 'dist/zerodebtplan-usa.html', 'en'], ['Ecuador es', 'dist/plan-financiero-ecuador.html', 'es'],
        ['US es', 'dist/zerodebtplan-usa.html', 'es'], ['Ecuador en', 'dist/plan-financiero-ecuador.html', 'en']].filter(r => !only || r[0].toLowerCase().includes(only));
    let total = 0;
    for (const [label, file, lang] of runs) {
        const { ctx, page, errors } = await open(browser, file, lang);
        const found = new Map();
        const take = async (where) => {
            const list = await page.evaluate(wrong, lang);
            list.filter(t => !ALLOWED[lang].some(re => re.test(t.replace(/^@[a-z-]+: /, '')))).forEach(t => { if (!found.has(t)) found.set(t, where); });
        };
        for (const v of VIEWS) {
            await fresh(page, v);
            await take(v);
            const actions = await page.evaluate(() => [...new Set([...document.querySelectorAll('main [data-action]')].filter(b => b.offsetParent !== null && !b.disabled).map(b => b.dataset.action))]);
            for (const a of actions.filter(x => !SKIP_BUTTON.test(x))) {
                const clicked = await page.evaluate((act) => { const b = [...document.querySelectorAll(`main [data-action="${act}"]`)].find(x => x.offsetParent !== null); if (!b) return false; b.click(); return true; }, a).catch(() => false);
                if (!clicked) continue;
                await page.waitForTimeout(150);
                await take(`${v} → ${a}`);
                await fresh(page, v);
            }
        }
        if (errors.length) console.log(label, 'page errors:', errors.slice(0, 3));
        const lines = [...found.entries()].map(([t, w]) => `${w}\t${t}`);
        fs.writeFileSync(path.join(OUT, `lang-${label.replace(/\s+/g, '-').toLowerCase()}.txt`), lines.join('\n') + '\n');
        console.log(`${label}: ${lines.length} in the wrong language`);
        if (lines.length) console.log(lines.slice(0, 200).join('\n'));
        total += lines.length;
        await ctx.close();
    }
    await browser.close();
    process.exit(total ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
