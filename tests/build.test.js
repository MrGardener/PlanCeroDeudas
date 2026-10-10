// The committed single-file build must match the sources (run `npm run build` after edits).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { build, EDITIONS, outFor } = require('../scripts/build.js');

Object.keys(EDITIONS).forEach(ed => {
    test(`dist/${EDITIONS[ed].file} is up to date with the sources`, () => {
        assert.ok(fs.existsSync(outFor(ed)), 'run: npm run build');
        assert.equal(fs.readFileSync(outFor(ed), 'utf8'), build(ed), 'dist is stale — run: npm run build');
    });
});

test('each edition is fixed in its file', () => {
    assert.match(build('ec'), /APP_EDITION \|\| \(false/);
    assert.match(build('us'), /APP_EDITION \|\| \(true/);
    assert.match(build('us'), /<title>ZeroDebtPlan<\/title>/);
});

test('the single-file build references no local files', () => {
    const html = build();
    assert.doesNotMatch(html, /src="js\//);
    assert.doesNotMatch(html, /href="css\//);
});

// Sealed (docs/ROADMAP.md, security): nothing comes from other servers, and a Content Security
// Policy lets only the file's own scripts run.
test('the single-file build loads nothing from other servers', () => {
    const html = build('us');
    assert.doesNotMatch(html, /<script[^>]+src=/i);
    assert.doesNotMatch(html, /<link[^>]+href="https?:/i);
    assert.doesNotMatch(html, /@import|url\(\s*["']?https?:/i);
    assert.doesNotMatch(html, /cdn\.tailwindcss|fonts\.googleapis|cdnjs\.cloudflare/);
});

test('its Content Security Policy comes first and lists every script by its hash', () => {
    const crypto = require('crypto');
    const html = build('us');
    const csp = (html.match(/<meta http-equiv="Content-Security-Policy" content="([^"]+)">/) || [])[1];
    assert.ok(csp, 'no policy');
    assert.ok(html.indexOf('Content-Security-Policy') < html.indexOf('<script'), 'the policy must come before the first script');
    assert.match(csp, /default-src 'none'/);
    assert.doesNotMatch(csp, /'unsafe-inline'[^;]*;?\s*$|script-src[^;]*'unsafe-(inline|eval)'/);
    assert.match(csp, /connect-src [^;]*https:\/\/finnhub\.io/);
    assert.match(csp, /form-action 'none'/);
    const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map(m => m[1]);
    assert.ok(scripts.length > 30);
    scripts.forEach(code => assert.ok(csp.includes(`'sha256-${crypto.createHash('sha256').update(code, 'utf8').digest('base64')}'`), 'a script without its hash: ' + code.slice(0, 60)));
});

test('the readers are pinned to exact versions, each main file checked by its hash', () => {
    const cfg = JSON.parse(build('us').match(/window\.APP_READERS = (\{.*?\});<\/script>/)[1]);
    assert.match(cfg.pdf.src, /pdfjs-dist@\d+\.\d+\.\d+\//);
    assert.match(cfg.ocr.src, /tesseract\.js@\d+\.\d+\.\d+\//);
    assert.match(cfg.ocr.corePath, /tesseract\.js-core@\d+\.\d+\.\d+$/);
    [cfg.pdf.integrity, cfg.pdf.workerIntegrity, cfg.ocr.integrity].forEach(h => assert.match(h, /^sha384-[A-Za-z0-9+/]{64}$/));
});
