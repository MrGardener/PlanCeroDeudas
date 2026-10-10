// Builds mobile/www: the web app for the phone app (Capacitor). Same page as dist/, but with
// everything it needs on the phone itself, so it works without internet:
// Tailwind compiled ahead of time, Chart.js, FontAwesome, the Inter font, Capacitor's core, and the
// readers for pay stubs and receipts (pdf.js, Tesseract with English and Spanish): nothing is
// downloaded, ever. The page's Content Security Policy lets only its own scripts run.
// Usage: node build-www.js            → ZeroDebtPlan (US edition, English with Spanish switch)
//        EDITION=ec node build-www.js → Plan Financiero Ecuador
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const { page } = require('../scripts/build.js');
const V = require('../scripts/vendor.js');

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

    // The readers, offline: pdf.js and its worker; Tesseract, its worker, its LSTM cores (with and
    // without SIMD) and the English and Spanish data.
    copy(mod('pdfjs-dist/build/pdf.min.js'), path.join(VENDOR, 'pdfjs/pdf.min.js'));
    copy(mod('pdfjs-dist/build/pdf.worker.min.js'), path.join(VENDOR, 'pdfjs/pdf.worker.min.js'));
    copy(mod('tesseract.js/dist/tesseract.min.js'), path.join(VENDOR, 'tesseract/tesseract.min.js'));
    copy(mod('tesseract.js/dist/worker.min.js'), path.join(VENDOR, 'tesseract/worker.min.js'));
    ['tesseract-core-simd-lstm.wasm.js', 'tesseract-core-lstm.wasm.js'].forEach(f => copy(mod('tesseract.js-core/' + f), path.join(VENDOR, 'tesseract/core', f)));
    ['eng', 'spa'].forEach(l => copy(mod(`@tesseract.js-data/${l}/4.0.0_best_int/${l}.traineddata.gz`), path.join(VENDOR, 'tesseract/lang', `${l}.traineddata.gz`)));
    const readers = { pdf: { src: 'vendor/pdfjs/pdf.min.js', worker: 'vendor/pdfjs/pdf.worker.min.js' },
        ocr: { src: 'vendor/tesseract/tesseract.min.js', workerPath: 'vendor/tesseract/worker.min.js', corePath: 'vendor/tesseract/core', langPath: 'vendor/tesseract/lang', local: true } };

    let html = page(edition);
    html = swap(html, '<script src="https://cdn.tailwindcss.com"></script>\n', '');
    html = swap(html, '<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.1/dist/chart.umd.min.js"></script>', '<script src="vendor/chart.umd.min.js"></script>');
    html = swap(html, '<link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">', '<link rel="stylesheet" href="vendor/fontawesome/css/all.min.css">');
    html = swap(html, '<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap" rel="stylesheet">', '<link rel="stylesheet" href="vendor/inter/inter.css">');
    html = swap(html, '</head>', '<link rel="stylesheet" href="vendor/tailwind.css">\n</head>');
    // Capacitor's core first, then mark the edition as carrying its own styles.
    html = swap(html, '<script>/* Edition:', '<script src="vendor/capacitor.js"></script>\n    <script>/* Edition:');
    html = swap(html, 'document.title = APP_EDITION.appName;', 'APP_EDITION.offline = true;\n    document.title = APP_EDITION.appName;');
    html = swap(html, '<script>/* js/readers.js */', `<script>window.APP_READERS = ${JSON.stringify(readers)};</script>\n<script>/* js/readers.js */`);
    if (/https:\/\/cdn\.tailwindcss|fonts\.googleapis/.test(html)) throw new Error('a CDN link is left in the page');
    html = swap(html, '<meta charset="UTF-8">', `<meta charset="UTF-8">\n    ${V.csp(html, { self: true })}`);
    fs.writeFileSync(path.join(WWW, 'index.html'), html);
    console.log(`mobile/www built (${edition === 'ec' ? 'Plan Financiero Ecuador' : 'ZeroDebtPlan'})`);
}

main();
