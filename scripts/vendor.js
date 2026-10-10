// What the web file carries inside it instead of loading it from other servers (Tailwind compiled
// ahead of time, Chart.js, the Font Awesome icons and the Inter font), the readers' pinned
// addresses with their hashes, and the page's Content Security Policy. Everything comes from the
// phone app's dependencies (mobile/node_modules: `cd mobile && npm ci`), at exact versions.
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { execFileSync } = require('child_process');

const ROOT = path.join(__dirname, '..');
const MOBILE = path.join(ROOT, 'mobile');
const mod = (p) => path.join(MOBILE, 'node_modules', p);
const read = (p, enc = 'utf8') => fs.readFileSync(p, enc);
const sri = (file, algo = 'sha384') => `${algo}-${crypto.createHash(algo).update(fs.readFileSync(file)).digest('base64')}`;
const dataUri = (file, type) => `data:${type};base64,${fs.readFileSync(file).toString('base64')}`;

// Tailwind: only the classes the app uses (index.html + js/), compiled once per process.
let tw = null;
function tailwindCSS() {
    if (tw !== null) return tw;
    const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'zdp-tw-')), 'tw.css');
    execFileSync(process.execPath, [mod('tailwindcss/lib/cli.js'), '-c', path.join(MOBILE, 'tailwind.config.js'), '-i', path.join(MOBILE, 'tailwind.css'), '-o', out, '--minify'],
        { cwd: MOBILE, stdio: 'pipe' });
    tw = read(out);
    fs.rmSync(path.dirname(out), { recursive: true, force: true });
    return tw;
}

// Font Awesome with its fonts inside (solid and regular; the brand icons aren't used).
function fontAwesomeCSS() {
    const fa = mod('@fortawesome/fontawesome-free');
    return read(path.join(fa, 'css/all.min.css')).replace(/url\(\.\.\/webfonts\/([\w-]+)\.woff2\) format\("woff2"\),url\(\.\.\/webfonts\/[\w-]+\.ttf\) format\("truetype"\)/g, (_, name) =>
        (/^fa-(solid-900|regular-400)$/.test(name) ? `url(${dataUri(path.join(fa, 'webfonts', name + '.woff2'), 'font/woff2')}) format("woff2")` : 'url(data:font/woff2;base64,) format("woff2")'));
}

// Inter 400–800, Latin + Latin Extended, inside the page (woff2 only).
function interCSS() {
    const inter = mod('@fontsource/inter');
    let css = '';
    [400, 500, 600, 700, 800].forEach(w => ['latin', 'latin-ext'].forEach(s => { css += read(path.join(inter, `${s}-${w}.css`)) + '\n'; }));
    return css.replace(/url\(\.\/files\/([\w-]+\.woff2)\) format\('woff2'\),\s*url\(\.\/files\/[\w-]+\.woff\) format\('woff'\)/g, (_, f) =>
        `url(${dataUri(path.join(inter, 'files', f), 'font/woff2')}) format('woff2')`);
}

const chartJS = () => read(mod('chart.js/dist/chart.umd.js'));

// The readers (js/readers.js) for the web file: jsDelivr serves npm packages byte for byte, so the
// hashes of the pinned packages here are the hashes of what the browser will get.
function readersConfig() {
    const J = 'https://cdn.jsdelivr.net/npm/';
    return {
        pdf: { src: J + 'pdfjs-dist@3.11.174/build/pdf.min.js', integrity: sri(mod('pdfjs-dist/build/pdf.min.js')),
            worker: J + 'pdfjs-dist@3.11.174/build/pdf.worker.min.js', workerIntegrity: sri(mod('pdfjs-dist/build/pdf.worker.min.js')) },
        ocr: { src: J + 'tesseract.js@5.1.1/dist/tesseract.min.js', integrity: sri(mod('tesseract.js/dist/tesseract.min.js')),
            workerPath: J + 'tesseract.js@5.1.1/dist/worker.min.js', corePath: J + 'tesseract.js-core@5.1.1' }
    };
}

// The page's Content Security Policy: only its own scripts run (each one by its hash, so a script
// slipped into the page never does), and it can connect only where it has to: the price services
// you turn on and, while reading a file, the pinned readers. No frames, forms, plugins or images
// from anywhere. `self`: the phone app, whose page and vendor files come from the app itself.
function csp(html, { self = false } = {}) {
    const hashes = [];
    html.replace(/<script>([\s\S]*?)<\/script>/g, (_, code) => { hashes.push(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`); return ''; });
    const J = 'https://cdn.jsdelivr.net/npm/';
    const readers = self ? [] : [J + 'pdfjs-dist@3.11.174/', J + 'tesseract.js@5.1.1/', J + 'tesseract.js-core@5.1.1/'];
    const prices = ['https://www.alphavantage.co', 'https://finnhub.io', 'https://docs.google.com', 'https://*.googleusercontent.com'];
    const policy = [
        "default-src 'none'",
        `script-src ${[self ? "'self'" : '', ...hashes, ...readers, "'wasm-unsafe-eval'"].filter(Boolean).join(' ')}`,
        `worker-src blob:${self ? " 'self'" : ''}`,
        "style-src 'unsafe-inline'" + (self ? " 'self'" : ''),
        `font-src data:${self ? " 'self'" : ''}`,
        'img-src data: blob:' + (self ? " 'self'" : ''),
        `connect-src ${[self ? "'self'" : '', ...prices, ...(self ? [] : [J + 'pdfjs-dist@3.11.174/', J + 'tesseract.js-core@5.1.1/', J + '@tesseract.js-data/'])].filter(Boolean).join(' ')}`,
        "media-src 'none'", "object-src 'none'", "frame-src 'none'", "base-uri 'none'", "form-action 'none'"
    ].join('; ');
    return `<meta http-equiv="Content-Security-Policy" content="${policy}">`;
}

module.exports = { tailwindCSS, fontAwesomeCSS, interCSS, chartJS, readersConfig, csp, sri, mod };
