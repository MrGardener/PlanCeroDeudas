// Browser tests: shared harness. Opens the app from disk in Chromium (Playwright) and serves
// what the page loads from the internet — Tailwind, Chart.js, Font Awesome — from the phone
// app's own dependencies (mobile/node_modules), so the tests run offline and the same in CI.
// Setup once: `npm ci` (root, Playwright) and `cd mobile && npm ci`.
const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { execFileSync } = require('child_process');

const ROOT = path.resolve(__dirname, '..', '..');
const MOBILE = path.join(ROOT, 'mobile');
const NM = path.join(MOBILE, 'node_modules');
// Screenshots and reports from the tests go here (ignored by git).
const OUT = path.join(__dirname, 'out');
fs.mkdirSync(OUT, { recursive: true });

// Chromium: the one preinstalled in this environment, or Playwright's own (CI).
const executablePath = process.env.CHROMIUM_PATH || (fs.existsSync('/opt/pw-browsers/chromium') ? '/opt/pw-browsers/chromium' : undefined);

let twCache = null;
function tailwind() {
    if (twCache !== null) return twCache;
    const out = path.join(OUT, 'tailwind.css');
    execFileSync(path.join(NM, '.bin', 'tailwindcss'), ['-i', 'tailwind.css', '-c', 'tailwind.config.js', '-o', out], { cwd: MOBILE, stdio: 'pipe' });
    twCache = fs.readFileSync(out, 'utf8');
    return twCache;
}

async function launch() { return chromium.launch(executablePath ? { executablePath } : {}); }

async function openApp({ file = 'index.html', viewport = { width: 1366, height: 900 }, styled = true, localStorageSeed = null } = {}) {
    const browser = await launch();
    const context = await browser.newContext({ viewport, acceptDownloads: true });
    const page = await context.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push('pageerror: ' + e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource/.test(m.text())) errors.push('console: ' + m.text()); });

    const tw = styled ? tailwind() : '';
    await page.route(/cdn\.tailwindcss\.com/, r => r.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' }));
    await page.route(/jsdelivr\.net\/npm\/chart\.js/, r => r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(NM, 'chart.js/dist/chart.umd.js')) }));
    await page.route(/font-awesome.*all\.min\.css/, r => r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(NM, '@fortawesome/fontawesome-free/css/all.min.css')) }));
    await page.route(/webfonts\/(.+)$/, r => {
        const name = r.request().url().split('/webfonts/')[1].split('?')[0];
        const p = path.join(NM, '@fortawesome/fontawesome-free/webfonts', name);
        return fs.existsSync(p) ? r.fulfill({ body: fs.readFileSync(p) }) : r.fulfill({ status: 404, body: '' });
    });
    await page.route(/fonts\.googleapis\.com|fonts\.gstatic\.com/, r => r.fulfill({ contentType: 'text/css', body: '' }));

    if (localStorageSeed) {
        await page.addInitScript(([k, v]) => { if (!sessionStorage.getItem('__seeded')) { localStorage.setItem(k, v); sessionStorage.setItem('__seeded', '1'); } }, localStorageSeed);
    }
    // The styles come back after every reload too (the lock reloads the page).
    let loads = 0;
    if (styled) page.on('load', () => { if (loads++) page.addStyleTag({ content: tw }).catch(() => {}); });
    await page.goto('file://' + path.join(ROOT, file));
    if (styled) await page.addStyleTag({ content: tw });
    await page.waitForTimeout(400);
    return { browser, context, page, errors };
}

// Files leave the app encrypted (js/vault.js): run `trigger`, type the password in the dialog,
// catch the download and decrypt it in the page. Returns { text, name, env }.
const VAULT_PW = 'test-pass-123';
async function secureDownload(page, trigger) {
    const dl = page.waitForEvent('download');
    await trigger();
    await page.waitForSelector('.modal input[name="pw"]');
    await page.fill('.modal input[name="pw"]', VAULT_PW);
    await page.fill('.modal input[name="pw2"]', VAULT_PW);
    await page.click('.modal [data-dialog-ok]');
    const env = fs.readFileSync(await (await dl).path(), 'utf8');
    return page.evaluate(([e, p]) => Vault.decrypt(e, p).then(r => ({ text: r.text, name: r.name, env: e })), [env, VAULT_PW]);
}

module.exports = { openApp, launch, ROOT, OUT, tailwind, secureDownload, VAULT_PW };
