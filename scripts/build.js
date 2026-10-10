// Builds dist/plan-financiero-ecuador.html and dist/zerodebtplan-usa.html: the whole app in one
// file that can be copied to a USB stick and opened with a double click. Sealed: everything it
// needs is inside (styles, Chart.js, icons, font), nothing is loaded from other servers, and a
// Content Security Policy lets only its own scripts run (scripts/vendor.js).
// Usage: node scripts/build.js        (needs the phone app's packages: cd mobile && npm ci)
const fs = require('fs');
const path = require('path');
const V = require('./vendor.js');

const ROOT = path.join(__dirname, '..');
// One codebase, one file per edition: Ecuador (Spanish) and the US (ZeroDebtPlan, English).
const EDITIONS = {
    ec: { file: 'plan-financiero-ecuador.html', us: false },
    us: { file: 'zerodebtplan-usa.html', us: true }
};
const OUT = path.join(ROOT, 'dist', EDITIONS.ec.file);
const outFor = (ed) => path.join(ROOT, 'dist', EDITIONS[ed].file);

// The page with the app's own code inlined (it still names the outside libraries: the phone build
// swaps them for its own copies; `build` puts them inside).
function page(ed = 'ec') {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
    // Fix the edition (in development it comes from ?edition=us).
    const marker = '/[?&]edition=us\\b/i.test(location.search)';
    if (!html.includes(marker)) throw new Error('edition marker not found in index.html');
    html = html.replace(marker, EDITIONS[ed].us ? 'true' : 'false');
    if (EDITIONS[ed].us) html = html.replace('<title>Plan Financiero Ecuador</title>', '<title>ZeroDebtPlan</title>').replace('<html lang="es">', '<html lang="en">');
    html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, file) =>
        `<style>\n${fs.readFileSync(path.join(ROOT, file), 'utf8')}</style>`);
    html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => {
        const code = fs.readFileSync(path.join(ROOT, file), 'utf8');
        if (/<\/script/i.test(code)) throw new Error(`${file} contains "</script" and can't be inlined`);
        return `<script>/* ${file} */\n${code}</script>`;
    });
    return html;
}

// Swap one tag of the page; fail loudly if index.html changed and the tag isn't there.
function swap(html, from, to) {
    if (!html.includes(from)) throw new Error('not found in the page: ' + from);
    return html.split(from).join(to);
}
// Inline code must not close its own <script> early.
const inlineScript = (code, name) => { if (/<\/script/i.test(code)) throw new Error(`${name} contains "</script"`); return `<script>${code}</script>`; };

// The sealed single file (dist/).
function build(ed = 'ec') {
    let html = page(ed);
    html = swap(html, '<script src="https://cdn.tailwindcss.com"></script>\n', '');
    html = swap(html, '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>', inlineScript(V.chartJS(), 'Chart.js'));
    html = swap(html, '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">', `<style>${V.fontAwesomeCSS()}</style>`);
    html = swap(html, '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">', `<style>${V.interCSS()}</style>`);
    // Tailwind after app.css, as the CDN did.
    html = swap(html, '</head>', `<style>${V.tailwindCSS()}</style>\n</head>`);
    html = swap(html, 'document.title = APP_EDITION.appName;', 'APP_EDITION.offline = true;\n    document.title = APP_EDITION.appName;');
    // The readers' pinned addresses and hashes, before js/readers.js.
    html = swap(html, '<script>/* js/readers.js */', `<script>window.APP_READERS = ${JSON.stringify(V.readersConfig())};</script>\n<script>/* js/readers.js */`);
    if (/<script src=|<link [^>]*href="https?:/.test(html)) throw new Error('an outside script or stylesheet is left in the page');
    return swap(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${V.csp(html)}`);
}

if (require.main === module) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    Object.keys(EDITIONS).forEach(ed => {
        fs.writeFileSync(outFor(ed), build(ed));
        console.log('Escrito', path.relative(ROOT, outFor(ed)));
    });
}

module.exports = { build, page, swap, OUT, EDITIONS, outFor };
