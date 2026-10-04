// Lists the pieces of text the app can show, as translation keys:
//   static text            → "Monthly net income"
//   text with values in it → "{0} left for {1} day{2}." ({n} = a value filled in at runtime)
// Usage: node scripts/i18n-extract.js [--english] > /tmp/keys.json        (no dependencies)
// By default it lists the text that is still Spanish (js/i18n/en.js translates it; tests/i18n.test.js
// checks). With --english it lists the English text (js/i18n/es.js translates it; see
// scripts/i18n-missing.js).
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');

// Spanish: accents or Spanish words that aren't also English ("no", "total", "balance" are both).
const SPANISH = /[áéíóúñ¿¡]|\b(de|del|la|las|el|los|tu|tus|que|para|con|por|sin|una?|mes|meses|año|años|día|días|hoy|cada|cuánto|qué|más|menos|aquí|ver|agregar|guardar|cancelar|quitar|eliminar|nueva?|nuevo|gasto|gastos|ingresos?|deudas?|ahorros?|cuentas?|presupuesto|sueldo|pago|pagos|monto|fecha|descripción|categoría|rubro|metas|resumen|saldo|neto|bruto|semana|semanas|todos?|todas?|también|aún|ya|si|es|está|están|tiene|tienes|puedes|hay|cuando|como|cómo|desde|hasta|entre|sobre|bajo|tipo|lugar|forma|hogar|regla|reglas|y|en|al|o|valor|cierre|vencimiento|fuentes|aportes|pensiones|ninguno|tomar|elegir|escanear|enlazado|lista|grupos|impuestos|viajes|ropa|libros|salidas|remesas?|regalos|financiero|suscripciones|entretenimiento)\b/i;
const ENGLISH_MODE = process.argv.includes('--english');
// Natural-language text: words, not code (ids, classes, actions, CSS, URLs, file names).
const CODE = /^[a-z0-9]+([.\-_/:#][a-z0-9]+)+$|^[a-z]+[A-Z]\w*$|^[.#\[]|^https?:|\.(js|css|json|png|csv|xml|html)$|^fa-|^(btn|text|bg|card|input|cell|badge|tone|link|row|kpi|field|help|modal|chip|bs|txn|cal|safe|wi|pay|ded|imp|rule|acct|hold|nw|cfg|dash|bud|inc|ret|pol|road|metas|ahorro|presupuesto|hipoteca|jubilacion|patrimonio|config|resumen)[-_.\w]*$/;
const WORDY = /^[¿¡"«(]?[A-Za-zÁÉÍÓÚÑáéíóúñ][A-Za-zÁÉÍÓÚÑáéíóúñü]+/;
const isText = (s) => {
    if (!/[A-Za-zÁÉÍÓÚáéíóúñÑ]{2}/.test(s) || CODE.test(s.trim())) return false;
    if (ENGLISH_MODE) return !SPANISH.test(s) && (/[A-Za-z]{2,}\s+[A-Za-z]/.test(s) || /^[A-Z][a-z]+[.:!?…]?$/.test(s.trim()));
    if (SPANISH.test(s)) return true;
    // Single words and short labels in Spanish without accents ("Hipoteca", "Guardado").
    return ALL && WORDY.test(s.trim()) && !/[{}=;]|=>|\(\)/.test(s);
};
const ALL = process.argv.includes('--all');
const clean = (s) => s.replace(/\s+/g, ' ').trim();

const keys = new Map();   // key → [where]
const add = (k, where) => {
    k = clean(k.replace(/&nbsp;/g, ' '));
    if (!k || k.length > 400 || !isText(k)) return;
    if (/^[{}\d\s.,:;()$%+−-]*$/.test(k)) return;
    if (!keys.has(k)) keys.set(k, []);
    if (keys.get(k).length < 3) keys.get(k).push(where);
};

// Split a chunk of HTML-ish text into the text runs between tags.
function textRuns(s) {
    return s.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ')
        .split(/<[^>]*>/).map(clean).filter(Boolean);
}
function attrs(s) {
    const out = [];
    s.replace(/\b(placeholder|title|aria-label|label)="([^"]*)"/g, (_, a, v) => { out.push(v); return ''; });
    return out;
}

// ---- index.html
const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8').replace(/<script[\s\S]*?<\/script>/gi, '');
textRuns(html).forEach(t => add(t, 'index.html'));
attrs(html).forEach(t => add(t, 'index.html@attr'));

// ---- JS: string literals and template literals ('…', "…", `…${x}…`)
function scanJs(file) {
    const src = fs.readFileSync(file, 'utf8');
    const rel = path.relative(ROOT, file);
    let i = 0;
    const n = src.length;
    while (i < n) {
        const c = src[i];
        // comments
        if (c === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); if (i < 0) break; continue; }
        if (c === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 2; if (i < 2) break; continue; }
        if (c === "'" || c === '"') {
            let j = i + 1, s = '';
            while (j < n && src[j] !== c) { if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } s += src[j++]; }
            handle(s, rel);
            i = j + 1; continue;
        }
        if (c === '`') {
            // Template literal: replace ${…} (balanced) with {n}.
            let j = i + 1, s = '', k = 0;
            while (j < n && src[j] !== '`') {
                if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; }
                if (src[j] === '$' && src[j + 1] === '{') {
                    let depth = 1; j += 2;
                    while (j < n && depth) {
                        if (src[j] === '`') { // nested template: skip it
                            let q = j + 1, d2 = 0;
                            while (q < n && !(src[q] === '`' && d2 === 0)) { if (src[q] === '$' && src[q + 1] === '{') d2++; else if (src[q] === '}' && d2) d2--; q++; }
                            // scan the nested template separately
                            scanTemplate(src.slice(j, q + 1), rel);
                            j = q + 1; continue;
                        }
                        if (src[j] === "'" || src[j] === '"') { const qch = src[j]; let q = j + 1, lit = ''; while (q < n && src[q] !== qch) { if (src[q] === '\\') { lit += src[q + 1]; q += 2; continue; } lit += src[q++]; } handle(lit, rel); j = q + 1; continue; }
                        if (src[j] === '{') depth++;
                        else if (src[j] === '}') depth--;
                        j++;
                    }
                    s += '\u0000';
                    continue;
                }
                s += src[j++];
            }
            handleTemplate(s, rel);
            i = j + 1; continue;
        }
        i++;
    }
}
function scanTemplate(t, rel) { const tmp = path.join(require('os').tmpdir(), 'i18n-nested.js'); fs.writeFileSync(tmp, t); scanJs(tmp); }
function handle(s, rel) {
    if (/<[a-z]/i.test(s)) { textRuns(s).forEach(t => add(t, rel)); attrs(s).forEach(t => add(t, rel + '@attr')); return; }
    add(s, rel);
}
function handleTemplate(s, rel) {
    // Text runs between tags; each ${…} becomes {0}, {1}… within its run.
    const runs = s.replace(/<[^>]*>/g, (m) => m.includes('\u0000') ? '\u0001' : '\u0001').split('\u0001');
    runs.forEach(run => {
        let k = 0;
        const key = run.replace(/\u0000/g, () => `{${k++}}`);
        add(key, rel);
    });
    s.replace(/\b(placeholder|title|aria-label)="([^"]*)"/g, (_, a, v) => { let k = 0; add(v.replace(/\u0000/g, () => `{${k++}}`), rel + '@attr'); return ''; });
}

const files = [];
(function walk(dir) {
    fs.readdirSync(dir).forEach(f => {
        const p = path.join(dir, f);
        if (fs.statSync(p).isDirectory()) { if (!/i18n/.test(f)) walk(p); }
        // js/sample.js is the example family's own data (their names, stores, notes), not app text.
        else if (/\.js$/.test(f) && f !== 'sample.js') files.push(p);
    });
})(path.join(ROOT, 'js'));
files.forEach(scanJs);

const out = {};
[...keys.keys()].sort().forEach(k => { out[k] = keys.get(k).join(', '); });
process.stdout.write(JSON.stringify(out, null, 1));
