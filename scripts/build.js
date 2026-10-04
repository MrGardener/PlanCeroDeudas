// Builds dist/plan-financiero-ecuador.html: the whole app (CSS + JS) inlined into one file
// that can be emailed or copied to a USB stick and opened with a double click.
// Usage: node scripts/build.js        (no dependencies)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
// One codebase, one file per edition: Ecuador (Spanish) and the US (ZeroDebtPlan, English).
const EDITIONS = {
    ec: { file: 'plan-financiero-ecuador.html', us: false },
    us: { file: 'zerodebtplan-usa.html', us: true }
};
const OUT = path.join(ROOT, 'dist', EDITIONS.ec.file);
const outFor = (ed) => path.join(ROOT, 'dist', EDITIONS[ed].file);

function build(ed = 'ec') {
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

if (require.main === module) {
    fs.mkdirSync(path.dirname(OUT), { recursive: true });
    Object.keys(EDITIONS).forEach(ed => {
        fs.writeFileSync(outFor(ed), build(ed));
        console.log('Escrito', path.relative(ROOT, outFor(ed)));
    });
}

module.exports = { build, OUT, EDITIONS, outFor };
