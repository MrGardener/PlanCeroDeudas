// The whole app, screen by screen, in the phone app (mobile/www, simulated Android) and in the
// computer file (dist/zerodebtplan-usa.html), in portrait and landscape: no page errors, nothing
// wider than the screen, every visible control has a name, the same controls in both, and every
// button that doesn't delete or leave can be tapped without an error. `node tests/e2e/e2e-sweep.js`
const { launch, ROOT, OUT, tailwind } = require('./harness');
const path = require('path');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (c, m, extra) => { if (c) pass++; else { fail++; console.log('FAIL', m, extra !== undefined ? JSON.stringify(extra).slice(0, 600) : ''); } };

const SIZES = { 'phone portrait': [390, 844], 'phone landscape': [844, 390], 'tablet portrait': [820, 1180], 'tablet landscape': [1180, 820], computer: [1366, 900] };
const VIEWS = ['resumen', 'presupuesto/plan', 'presupuesto/ingresos', 'transacciones/lista', 'transacciones/importar', 'transacciones/reportes',
    'futuro/metas', 'futuro/proyeccion', 'futuro/polizas', 'futuro/hipoteca', 'futuro/jubilacion', 'futuro/calculadoras', 'patrimonio', 'config'];
// Buttons the tap test leaves alone: they delete, erase, leave the page, lock, or need a file.
const SKIP = /delete|\.del$|del\b|remove|purge|erase|wipe|reset|startOwn|lockNow|setPin|removePin|exclude|upload|openVault|fileChosen|print|download|csv|txns$|rep\.txns|app\.undo|app\.redo|importar|import\.|scan|ocr|photo|camera|share|copyQuick|example|baseline\.restore|baseline\.del|sample|close\.month|cierre|tools\.alertGo|member\.|flow\.introDone|copyYear|propagate|gm\.remove|tdt\.split|split/i;

const bridge = () => {
    window.__prefs = {};
    window.androidBridge = { postMessage() {} };
    const m = (names) => names.map(name => ({ name, rtype: 'promise' }));
    window.Capacitor = {
        PluginHeaders: [{ name: 'Filesystem', methods: m(['writeFile']) }, { name: 'Share', methods: m(['share']) }, { name: 'Preferences', methods: m(['get', 'set', 'remove']) }, { name: 'App', methods: m(['exitApp']).concat([{ name: 'addListener', rtype: 'callback' }]) }],
        nativePromise(plugin, method, opts) {
            if (plugin === 'Filesystem') return Promise.resolve({ uri: 'file:///cache/' + opts.path });
            if (plugin === 'Preferences' && method === 'get') return Promise.resolve({ value: window.__prefs[opts.key] ?? null });
            if (plugin === 'Preferences' && method === 'set') { window.__prefs[opts.key] = opts.value; return Promise.resolve(); }
            return Promise.resolve({});
        },
        nativeCallback() { return 'cb1'; }
    };
};

async function open(browser, which, [w, h]) {
    const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900, acceptDownloads: true });
    await ctx.route(/^https?:/, r => {
        const u = r.request().url();
        if (/cdn\.tailwindcss\.com/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: 'window.tailwind = window.tailwind || {};' });
        if (/chart\.js/.test(u)) return r.fulfill({ contentType: 'application/javascript', body: fs.readFileSync(path.join(ROOT, 'mobile/node_modules/chart.js/dist/chart.umd.js')) });
        if (/font-awesome.*all\.min\.css/.test(u)) return r.fulfill({ contentType: 'text/css', body: fs.readFileSync(path.join(ROOT, 'mobile/node_modules/@fortawesome/fontawesome-free/css/all.min.css')) });
        return r.fulfill({ status: 404, body: '' });
    });
    const page = await ctx.newPage();
    const errors = [];
    page.on('pageerror', e => errors.push(e.message));
    page.on('console', m => { if (m.type() === 'error' && !/Failed to load resource|net::ERR/.test(m.text())) errors.push(m.text()); });
    page.on('dialog', d => d.dismiss().catch(() => {}));
    if (which === 'phone') await page.addInitScript(bridge);
    await page.goto('file://' + path.join(ROOT, which === 'phone' ? 'mobile/www/index.html' : 'dist/zerodebtplan-usa.html'));
    if (which !== 'phone') await page.addStyleTag({ content: tailwind() });
    await page.waitForTimeout(700);
    await page.evaluate(() => { Store.reset('example'); Store.state.settings.welcomeDismissed = true; App.changed({ structural: true }); });
    return { ctx, page, errors };
}

const closeAll = (page) => page.evaluate(() => { document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); document.documentElement.classList.remove('modal-open'); });

// What's on a screen: controls without a name, things wider than the screen, the actions offered.
const inspect = (page) => page.evaluate(() => {
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !e.closest('[hidden], .hidden, details:not([open]) > :not(summary)'); };
    const nameOf = (e) => (e.getAttribute('aria-label') || e.getAttribute('title') || e.textContent || e.value || e.placeholder || (e.labels && e.labels[0] && e.labels[0].textContent) || (e.closest('label') && e.closest('label').textContent) || (e.id && document.querySelector(`label[for="${e.id}"]`) && document.querySelector(`label[for="${e.id}"]`).textContent) || '').trim();
    const controls = [...document.querySelectorAll('main button, main a[href], main input:not([type=hidden]), main select, main textarea, #main-nav button, header button')].filter(vis);
    const unnamed = controls.filter(e => !nameOf(e) && e.type !== 'file').map(e => e.outerHTML.slice(0, 140));
    const W = document.documentElement.clientWidth;
    const clipped = (e) => { for (let a = e.parentElement; a && a !== document.body; a = a.parentElement) { const ox = getComputedStyle(a).overflowX; if (/(auto|hidden|scroll|clip)/.test(ox)) return true; } return false; };
    const wide = [...document.querySelectorAll('main *')].filter(e => vis(e) && e.getBoundingClientRect().right > W + 1 && !clipped(e)).slice(0, 5).map(e => `${e.tagName}#${e.id}.${String(e.className).slice(0, 40)}`);
    const actions = [...new Set(controls.map(e => e.dataset.action).filter(Boolean))].sort();
    return { unnamed: unnamed.slice(0, 6), wide, overflow: document.documentElement.scrollWidth - W, actions, controls: controls.length };
});

(async () => {
    const browser = await launch();
    const seen = { phone: {}, computer: {} };
    let tapped = 0;
    for (const [size, wh] of Object.entries(SIZES)) {
        for (const which of ['phone', 'computer']) {
            if (which === 'computer' && size.startsWith('phone')) continue;   // the phone app on phones; the file everywhere else
            if (which === 'phone' && size === 'computer') continue;
            const { ctx, page, errors } = await open(browser, which, wh);
            for (const v of VIEWS) {
                await closeAll(page);
                await page.evaluate((k) => App.go(k, { scroll: false }), v);
                await page.waitForTimeout(250);
                await page.evaluate(() => document.querySelectorAll('main details').forEach(d => { d.open = true; }));
                await page.waitForTimeout(100);
                const r = await inspect(page);
                ok(r.overflow <= 0 && !r.wide.length, `${which} ${size} ${v}: nothing wider than the screen`, r.wide.concat([r.overflow]));
                ok(!r.unnamed.length, `${which} ${size} ${v}: every control has a name`, r.unnamed);
                if (size.includes('portrait') || size === 'computer') seen[which][v + ' ' + (wh[0] < 600 ? 'narrow' : 'wide')] = r.actions;
                // Tap every safe button on this screen once (a fresh page state each screen).
                if (size === 'phone portrait' || size === 'tablet landscape') {
                    const names = r.actions.filter(a => !SKIP.test(a));
                    for (const a of names) {
                        const before = errors.length;
                        await page.evaluate((act) => { const b = [...document.querySelectorAll(`main [data-action="${act}"]`)].find(x => x.offsetParent !== null); if (b && !b.disabled) b.click(); }, a).catch(e => errors.push(String(e)));
                        await page.waitForTimeout(60);
                        tapped++;
                        if (errors.length > before) console.log(`  error after ${a} on ${v}:`, errors.slice(before).join(' | ').slice(0, 300));
                        await closeAll(page);
                        await page.evaluate((k) => { if (App && Store.ui && (Store.ui.tab + (Store.ui.sub[Store.ui.tab] ? '/' + Store.ui.sub[Store.ui.tab] : '')) !== k) App.go(k, { scroll: false }); }, v);
                    }
                }
            }
            // Sheets and dialogs fit the screen (landscape phones are short) and scroll inside.
            for (const [label, fn] of [['help', () => Tools.openHelp()], ['add a cash event', () => Cash.openAddEvent()], ['add a goal', () => GoalMap.open('type')], ['a dialog', () => { UI.form({ title: 'Test', fields: [{ name: 'a', label: 'A' }, { name: 'b', label: 'B' }, { name: 'c', label: 'C' }] }); }]]) {
                await closeAll(page);
                await page.evaluate(fn);
                await page.waitForTimeout(250);
                const box = await page.evaluate(() => { const m = [...document.querySelectorAll('.modal-backdrop .modal')].pop(); if (!m) return null; const r = m.getBoundingClientRect(); const sc = m.scrollHeight > m.clientHeight ? getComputedStyle(m).overflowY : 'fits'; return { top: Math.round(r.top), bottom: Math.round(r.bottom), h: innerHeight, w: innerWidth, left: Math.round(r.left), right: Math.round(r.right), sc }; });
                ok(box && box.top >= -1 && box.bottom <= box.h + 1 && box.left >= -1 && box.right <= box.w + 1 && /fits|auto|scroll/.test(box.sc), `${which} ${size}: the ${label} sheet fits the screen`, box);
            }
            await closeAll(page);
            ok(!errors.length, `${which} ${size}: no page errors`, errors.slice(0, 5));
            await page.screenshot({ path: path.join(OUT, `sweep-${which}-${size.replace(' ', '-')}.png`) });
            await ctx.close();
        }
    }
    // Parity: the phone app offers the same actions as the computer file on the same screen size.
    for (const k of Object.keys(seen.phone)) {
        if (!seen.computer[k]) continue;
        const a = seen.phone[k], b = seen.computer[k];
        // Web-only on purpose: printing and the quick-entry bookmark link (the app has its own shortcut).
        const onlyPhone = a.filter(x => !b.includes(x)), onlyFile = b.filter(x => !a.includes(x) && !/print|copyQuick/.test(x));
        ok(!onlyPhone.length && !onlyFile.length, `same actions in the phone app and the file: ${k}`, { onlyPhone, onlyFile });
    }
    console.log(`\n${tapped} buttons tapped without an error.`);
    console.log(`sweep: ${pass} passed, ${fail} failed`);
    await browser.close();
    process.exit(fail ? 1 : 0);
})();
