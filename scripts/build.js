// Builds dist/plan-financiero-ecuador.html: the whole app (CSS + JS) inlined into one file
// that can be emailed or copied to a USB stick and opened with a double click.
// Usage: node scripts/build.js        (no dependencies)
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const OUT = path.join(ROOT, 'dist', 'plan-financiero-ecuador.html');

function build() {
    let html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');
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
    fs.writeFileSync(OUT, build());
    console.log('Escrito', path.relative(ROOT, OUT));
}

module.exports = { build, OUT };
