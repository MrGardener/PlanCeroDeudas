// Builds mobile/www: the web app for the phone app (Capacitor). Same page as dist/, but with
// everything it needs on the phone itself, so it works without internet:
// Tailwind compiled ahead of time, Chart.js, FontAwesome, the Inter font and Capacitor's core.
// (Reading pay stub PDFs / photos still downloads pdf.js or Tesseract the first time.)
// Usage: node build-www.js            → ZeroDebtPlan (US edition, English with Spanish switch)
//        EDITION=ec node build-www.js → Plan Financiero Ecuador
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { build } = require('../scripts/build.js');

const HERE = __dirname;
const WWW = path.join(HERE, 'www');
const VENDOR = path.join(WWW, 'vendor');
const mod = (p) => path.join(HERE, 'node_modules', p);
const edition = (process.env.EDITION || 'us').toLowerCase();

function copy(from, to) {
    fs.mkdirSync(path.dirname(to), { recursive: true });
    fs.copyFileSync(from, to);
}

// Swap one tag of the page; fail loudly if index.html changed and the tag isn't there.
function swap(html, from, to) {
    if (!html.includes(from)) throw new Error('not found in the page: ' + from);
    return html.replace(from, to);
}

function main() {
    fs.rmSync(WWW, { recursive: true, force: true });
    fs.mkdirSync(VENDOR, { recursive: true });

    // Tailwind: only the classes the app uses (index.html + js/), same order as the CDN (after app.css).
    execFileSync(process.execPath, [mod('tailwindcss/lib/cli.js'), '-c', path.join(HERE, 'tailwind.config.js'),
        '-i', path.join(HERE, 'tailwind.css'), '-o', path.join(VENDOR, 'tailwind.css'), '--minify'], { stdio: 'inherit' });

    copy(mod('chart.js/dist/chart.umd.js'), path.join(VENDOR, 'chart.umd.min.js'));
    copy(mod('@capacitor/core/dist/capacitor.js'), path.join(VENDOR, 'capacitor.js'));

    const fa = mod('@fortawesome/fontawesome-free');
    copy(path.join(fa, 'css/all.min.css'), path.join(VENDOR, 'fontawesome/css/all.min.css'));
    fs.readdirSync(path.join(fa, 'webfonts')).filter(f => f.endsWith('.woff2') || f.endsWith('.ttf'))
        .forEach(f => copy(path.join(fa, 'webfonts', f), path.join(VENDOR, 'fontawesome/webfonts', f)));

    // Inter 400–800, Latin + Latin Extended (Spanish and English).
    const inter = mod('@fontsource/inter');
    let css = '';
    [400, 500, 600, 700, 800].forEach(w => ['latin', 'latin-ext'].forEach(s => {
        css += fs.readFileSync(path.join(inter, `${s}-${w}.css`), 'utf8') + '\n';
    }));
    css.replace(/url\(\.\/files\/([^)]+)\)/g, (_, f) => { copy(path.join(inter, 'files', f), path.join(VENDOR, 'inter/files', f)); return ''; });
    fs.writeFileSync(path.join(VENDOR, 'inter/inter.css'), css);

    let html = build(edition);
    html = swap(html, '<script src="https://cdn.tailwindcss.com"></script>\n', '');
    html = swap(html, '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>', '<script src="vendor/chart.umd.min.js"></script>');
    html = swap(html, '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">', '<link rel="stylesheet" href="vendor/fontawesome/css/all.min.css">');
    html = swap(html, '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">', '<link rel="stylesheet" href="vendor/inter/inter.css">');
    html = swap(html, '</head>', '<link rel="stylesheet" href="vendor/tailwind.css">\n</head>');
    // Capacitor's core first, then mark the edition as carrying its own styles.
    html = swap(html, '<script>/* Edition:', '<script src="vendor/capacitor.js"></script>\n    <script>/* Edition:');
    html = swap(html, 'document.title = APP_EDITION.appName;', 'APP_EDITION.offline = true;\n    document.title = APP_EDITION.appName;');
    if (/https:\/\/cdn\.tailwindcss|fonts\.googleapis/.test(html)) throw new Error('a CDN link is left in the page');
    fs.writeFileSync(path.join(WWW, 'index.html'), html);
    console.log(`mobile/www built (${edition === 'ec' ? 'Plan Financiero Ecuador' : 'ZeroDebtPlan'})`);
}

main();
