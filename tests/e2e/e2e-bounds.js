// Boundaries: every field on every screen (and in the dialogs the screen's buttons open), in both
// editions, gets the values people get wrong — empty, zero, negative, huge, not a number, very long
// text, a script tag, impossible dates, every option of a list — and after each one:
//   no page error, nothing like NaN / Infinity / undefined on screen, every saved number finite,
//   no script run from what was typed, nothing wider than a phone screen, and no hang.
// `node tests/e2e/e2e-bounds.js` (or `node tests/e2e/run.js bounds`).
const { launch, ROOT, tailwind } = require('./harness');
const path = require('path');
const fs = require('fs');
let pass = 0, fail = 0;
const failures = new Map();
const ok = (c, key, extra) => {
    if (c) { pass++; return; }
    fail++;
    if (!failures.has(key)) { failures.set(key, extra); console.log('FAIL', key, extra !== undefined ? JSON.stringify(extra).slice(0, 400) : ''); }
};

const VIEWS = ['resumen', 'presupuesto/plan', 'presupuesto/ingresos', 'transacciones/lista', 'transacciones/importar', 'transacciones/reportes',
    'futuro/metas', 'futuro/proyeccion', 'futuro/polizas', 'futuro/hipoteca', 'futuro/jubilacion', 'futuro/calculadoras', 'patrimonio', 'config'];
// Fields left alone: this device's settings (language, theme, PIN), files, the import preview.
const SKIP_FIELD = /^(device\.|imp\.|cfg\.vault|cfg\.load|cfg\.openVault)/;
const SKIP_ID = /^(cfg-lang|cfg-theme|cfg-hide-amounts|lock-pin|imp-|cfg-quick-link)/;
// Buttons whose dialogs are filled in: everything except what deletes, erases, leaves or needs a file.
const SKIP_BUTTON = /delete|\.del$|del\b|remove|purge|erase|wipe|reset|startOwn|lockNow|setPin|removePin|exclude|upload|openVault|fileChosen|print|download|csv|app\.undo|app\.redo|import\.|scan|ocr|photo|camera|share|copyQuick|example|baseline\.restore|sample|close\.month|cierre|tools\.alertGo|copyYear|propagate|gm\.remove|hold\.refresh|setup\.open|flow\.introDone|lang|theme/i;

const XSS = '<img src=x onerror="window.__xss=1">';
const VALUES = {
    number: ['', '0', '-1', '-5000000', '0.001', '99999999999', '1e308', '12abc', '1,234.56'],
    text: ['', '   ', 'x'.repeat(300), XSS, '"quoted" & <b>bold</b>', 'Ñandú ✓ 🎉 مرحبا', '-5', '1e9'],
    date: ['', '1900-01-01', '2999-12-31', '2026-02-30'],
    month: ['', '1900-01', '2999-12'],
    url: ['', 'not a link', 'javascript:alert(1)', 'https://example.com/' + 'a'.repeat(200)]
};

function open(browser, file, [w, h]) {
    return (async () => {
        const ctx = await browser.newContext({ viewport: { width: w, height: h }, isMobile: w < 900, hasTouch: w < 900 });
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
        await page.goto('file://' + path.join(ROOT, file));
        await page.addStyleTag({ content: tailwind() });
        await page.waitForTimeout(600);
        await page.evaluate(() => { window.open = () => null; Store.reset('example'); Store.state.settings.welcomeDismissed = true; App.changed({ structural: true }); });
        return { ctx, page, errors };
    })();
}

// In the page: the fields of a screen or a dialog, each with a selector that finds it again after
// the screen is redrawn.
const collect = (scope) => {
    const root = scope ? document.querySelector(scope) : document.querySelector('main');
    if (!root) return [];
    const vis = (e) => { const r = e.getBoundingClientRect(); const s = getComputedStyle(e); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none'; };
    const ATTRS = ['data-bind', 'data-change', 'data-input', 'data-id', 'data-field', 'data-idx', 'data-ref', 'data-kind', 'data-key', 'data-f', 'data-g', 'data-status', 'name'];
    const q = (v) => JSON.stringify(String(v));
    return [...root.querySelectorAll('input, select, textarea')].filter(e => vis(e) && !e.disabled && !e.readOnly && !/^(file|password|hidden|button|submit)$/.test(e.type)).map(e => {
        let sel;
        if (e.id) sel = '#' + CSS.escape(e.id);
        else {
            sel = e.tagName.toLowerCase() + ATTRS.filter(a => e.hasAttribute(a)).map(a => `[${a}=${q(e.getAttribute(a))}]`).join('');
            const all = [...root.querySelectorAll(sel)];
            if (all.length > 1) sel += '@@' + all.indexOf(e);
        }
        const kind = e.tagName === 'SELECT' ? 'select' : e.tagName === 'TEXTAREA' ? 'text' : e.type === 'checkbox' || e.type === 'radio' ? 'check' : e.type === 'range' ? 'range'
            : e.type === 'number' || e.dataset.type === 'number' || e.inputMode === 'decimal' || e.inputMode === 'numeric' ? 'number' : e.type === 'date' ? 'date' : e.type === 'month' ? 'month' : e.type === 'url' ? 'url' : 'text';
        const handler = e.dataset.change || e.dataset.input || e.dataset.bind || '';
        return { sel, kind, handler, id: e.id, options: e.tagName === 'SELECT' ? [...e.options].map(o => o.value).slice(0, 12) : null, min: e.min, max: e.max };
    });
};

// In the page: set a value the way a person would (input, then change) and measure how long it took.
const setValue = ([scope, f, v]) => {
    const root = scope ? document.querySelector(scope) : document.querySelector('main');
    const [sel, idx] = f.sel.split('@@');
    const all = root ? [...root.querySelectorAll(sel)] : [];
    const e = all[idx === undefined ? 0 : Number(idx)];
    if (!e) return { gone: true };
    const t = performance.now();
    if (f.kind === 'check') { e.click(); }
    else {
        try { e.focus(); } catch (x) { /* fine */ }
        e.value = v;
        e.dispatchEvent(new Event('input', { bubbles: true }));
        e.dispatchEvent(new Event('change', { bubbles: true }));
        try { e.blur(); } catch (x) { /* fine */ }
    }
    return { ms: performance.now() - t };
};

// In the page: what a person would see that's wrong, and the saved plan's numbers.
const health = () => {
    const vis = (e) => e && e.offsetParent !== null;
    const text = [...document.querySelectorAll('main, .modal-backdrop')].filter(e => e.tagName === 'MAIN' || vis(e.firstElementChild || e)).map(e => e.innerText).join('\n');
    const bad = (text.match(/[^\n]{0,40}\b(NaN|Infinity|undefined|\[object Object\])\b[^\n]{0,40}/g) || []).slice(0, 3);
    const nonFinite = [];
    const walk = (o, p, d) => {
        if (d > 8 || nonFinite.length > 3 || o === null) return;
        if (typeof o === 'number') { if (!Number.isFinite(o)) nonFinite.push(p); return; }
        if (typeof o !== 'object') return;
        for (const k of Object.keys(o)) walk(o[k], p + '.' + k, d + 1);
    };
    walk(Store.state, 'state', 0);
    let saved = true;
    try { JSON.parse(Store.serialize()); } catch (e) { saved = false; }
    return { bad, nonFinite, xss: !!window.__xss, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, saved };
};

const valuesFor = (f) => f.kind === 'select' ? f.options : f.kind === 'check' ? [true, false] : f.kind === 'range' ? [f.min || '0', f.max || '100', String(Number(f.max || 100) * 10), '-1'] : VALUES[f.kind] || VALUES.text;
const short = (v) => (typeof v === 'string' ? v.slice(0, 30) : v);

// The page in use. Every call into it has a time limit: an endless loop in the app is reported as
// "freezes the app" and the page is opened again on the same screen.
const FREEZE_MS = 8000;
class Frozen extends Error {}
function tabFor(browser, file, size) {
    const tab = {
        v: VIEWS[0],
        async reopen() {
            if (tab.ctx) await tab.ctx.close().catch(() => {});
            Object.assign(tab, await open(browser, file, size));
            await tab.fresh();
        },
        run(fn, arg) {
            return Promise.race([tab.page.evaluate(fn, arg), new Promise((_, no) => setTimeout(() => no(new Frozen('frozen')), FREEZE_MS))]);
        },
        fresh() { return tab.run((k) => { document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); Store.reset('example'); Store.state.settings.welcomeDismissed = true; Store.ui.trends = null; App.changed({ structural: true }); App.go(k, { scroll: false }); document.querySelectorAll('main details').forEach(d => { d.open = true; }); }, tab.v).then(() => tab.page.waitForTimeout(150)); }
    };
    return tab;
}

async function check(tab, label, f, v, phone, ms, before) {
    const h = await tab.run(health);
    const what = `${label} ${f.sel} (${f.handler || f.kind})`;
    const newErr = tab.errors.slice(before);
    ok(!newErr.length, `${what}: no page error`, { value: short(v), errors: newErr.slice(0, 2) });
    ok(!h.bad.length, `${what}: nothing like NaN / undefined on screen`, { value: short(v), seen: h.bad });
    ok(!h.nonFinite.length && h.saved, `${what}: the saved plan keeps finite numbers`, { value: short(v), where: h.nonFinite });
    ok(!h.xss, `${what}: typed text never runs as code`, { value: short(v) });
    if (phone) ok(h.overflow <= 1, `${what}: nothing wider than the phone screen`, { value: short(v), overflow: h.overflow });
    ok(ms < 2500, `${what}: answers in time`, { value: short(v), ms: Math.round(ms) });
    if (h.xss) await tab.run(() => { window.__xss = 0; });
}

// Every boundary value in every field of a screen (scope null) or of a dialog (scope '#id').
// Returns the number of fields tried; stops early when a value froze the page.
async function fields(tab, label, phone, scope) {
    const list = await tab.run(collect, scope);
    let n = 0;
    for (const f of list) {
        if (SKIP_FIELD.test(f.handler) || SKIP_ID.test(f.id || '')) continue;
        for (const v of valuesFor(f)) {
            const before = tab.errors.length;
            try {
                const r = await tab.run(setValue, [scope, f, v]);
                if (r.gone) break;                              // the screen changed under it
                await tab.page.waitForTimeout(25);
                await check(tab, label, f, v, phone, r.ms || 0, before);
                // A field can open a dialog (a confirmation): answer "Cancel" and go on.
                if (!scope) await tab.run(() => { const c = document.querySelector('.modal-backdrop:not(.hidden) [data-dialog-cancel]'); if (c) c.click(); });
            } catch (e) {
                if (!(e instanceof Frozen)) throw e;
                ok(false, `${label} ${f.sel} (${f.handler || f.kind}): doesn't freeze the app`, { value: short(v) });
                await tab.reopen();
                return { n, frozen: true };
            }
        }
        n++;
        // The plan back to the example after each field (a screen's fields only).
        if (!scope) await tab.fresh().catch(() => tab.reopen());
    }
    return { n, frozen: false };
}

(async () => {
    const browser = await launch();
    const only = process.argv[2] || '';
    const runs = [
        ['US computer', 'dist/zerodebtplan-usa.html', [1366, 900], false],
        ['US phone', 'dist/zerodebtplan-usa.html', [390, 844], true],
        ['Ecuador computer', 'dist/plan-financiero-ecuador.html', [1366, 900], false]
    ].filter(r => !only || r[0].toLowerCase().includes(only.toLowerCase()));
    let nFields = 0, nDialogs = 0;
    for (const [label, file, size, phone] of runs) {
        const tab = tabFor(browser, file, size);
        await tab.reopen();
        for (const v of VIEWS) {
            const t0 = Date.now(), f0 = nFields, d0 = nDialogs;
            tab.v = v;
            await tab.fresh().catch(() => tab.reopen());
            // 1. The screen's own fields.
            nFields += (await fields(tab, `${label} ${v}`, phone, null)).n;
            // 2. The dialogs and sheets its buttons open: their fields with every value, then OK.
            if (!phone) {
                await tab.fresh().catch(() => tab.reopen());
                const actions = await tab.run(() => [...new Set([...document.querySelectorAll('main [data-action]')].filter(b => b.offsetParent !== null && !b.disabled).map(b => b.dataset.action))]);
                for (const a of actions.filter(x => !SKIP_BUTTON.test(x))) {
                    try {
                        const opened = await tab.run((act) => { document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()); const b = [...document.querySelectorAll(`main [data-action="${act}"]`)].find(x => x.offsetParent !== null); if (!b) return false; b.click(); return true; }, a);
                        if (!opened) continue;
                        await tab.page.waitForTimeout(120);
                        const modal = await tab.run(() => { const m = [...document.querySelectorAll('.modal-backdrop')].pop(); if (!m) return null; m.id = m.id || 'bounds-modal'; return '#' + m.id; });
                        if (!modal) { await tab.fresh(); continue; }
                        const r = await fields(tab, `${label} ${v} → ${a}`, false, modal);
                        if (r.n) nDialogs++;
                        if (r.frozen) continue;
                        // Confirm with whatever is in the fields now (the last boundary value of each).
                        const before = tab.errors.length;
                        await tab.run((m) => { const okb = document.querySelector(`${m} [data-dialog-ok]`); if (okb) okb.click(); }, modal);
                        await tab.page.waitForTimeout(80);
                        await check(tab, `${label} ${v} → ${a}`, { sel: '[OK]', kind: 'submit' }, 'confirm', false, 0, before);
                        await tab.fresh();
                    } catch (e) {
                        if (!(e instanceof Frozen)) throw e;
                        ok(false, `${label} ${v} → ${a}: doesn't freeze the app`, {});
                        await tab.reopen();
                    }
                }
            }
            console.log(`  ${label} ${v}: ${nFields - f0} fields, ${nDialogs - d0} dialogs, ${Math.round((Date.now() - t0) / 1000)}s`);
        }
        await tab.ctx.close();
    }
    await browser.close();
    console.log(`\n${nFields} fields and ${nDialogs} dialogs tried with boundary values.`);
    console.log(`${pass} passed, ${fail} failed (${failures.size} different problems)`);
    process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
