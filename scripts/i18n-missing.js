// English text in the app that has no Spanish yet (js/i18n/es.js). Not a test: new work goes in
// English first and Spanish catches up in batches. Usage: npm run i18n:missing [-- --json]
const { execFileSync } = require('child_process');
const path = require('path');
const ROOT = path.join(__dirname, '..');

const keys = JSON.parse(execFileSync('node', [path.join(__dirname, 'i18n-extract.js'), '--english'], { encoding: 'utf8', maxBuffer: 1 << 24 }));
// es.js has the English; en.js and us.js keys are Spanish text the extractor can't tell apart
// from English (single words with no accent: "Abril", "Aceptar").
global.I18n = { d: {}, add(l, e) { Object.assign(this.d, e); }, country(c, e) { Object.assign(this.d, e); }, override() {} };
['es.js', 'en.js', 'us.js'].forEach(f => require(path.join(ROOT, 'js/i18n', f)));
const norm = (s) => s.replace(/\s+/g, ' ').trim();
const have = new Set(Object.keys(I18n.d).map(norm));
// Bits of code the extractor catches between quotes.
const CODE = /=>|[;{}<>]\s|\/>|\(\)|^[,:;).\/]|\/\/|^use strict$|^no (lib|Tesseract)$/;
// Names (services, plugins, keys, places) and internal words that read the same in Spanish.
const NAMES = new Set(['Alpha Vantage', 'App', 'Escape', 'Filesystem', 'Finnhub', 'Global Quote', 'Medicare', 'Michigan Treasury', 'Out',
    'Switch to English', 'Vanguard S&P 500', 'health insurance', 'life insurance', 'recognizing text', 'help block', "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif"]);
// CSS class lists ("kpi tone-amber", "help mt-2 {0}").
const CLASSES = (k) => /^(?:[a-z0-9:\[\]\/.-]+|\{\d+\})(?: (?:[a-z0-9:\[\]\/.-]+|\{\d+\}))*$/.test(k) && /-/.test(k);
// Names in the data packs (states, example budget lines, default goals) are data, not app text.
const DATA = /(^|\/)js\/(defaults(-us)?|categorize|sample)\.js$/;
const inApp = (where) => where.split(', ').some(f => !DATA.test(f.replace(/@attr$/, '')));
const missing = Object.entries(keys).filter(([k, where]) => !have.has(norm(k)) && !CODE.test(k) && !NAMES.has(k) && !CLASSES(k) && inApp(where)
    // Spanish month names in js/format.js are shown through Fmt (dates), not as text.
    && !(where === 'js/format.js' && /^[A-Z][a-z]+$/.test(k)));
if (process.argv.includes('--json')) process.stdout.write(JSON.stringify(Object.fromEntries(missing), null, 1) + '\n');
else {
    missing.forEach(([k, where]) => console.log(`${k}\n    ${where}`));
    console.log(`\n${missing.length} English text${missing.length === 1 ? '' : 's'} without Spanish (some may be names or code; add the real ones to js/i18n/es.js).`);
}
