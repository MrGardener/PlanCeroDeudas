// The committed single-file build must match the sources (run `npm run build` after edits).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const { build, OUT } = require('../scripts/build.js');

test('dist/plan-financiero-ecuador.html is up to date with the sources', () => {
    assert.ok(fs.existsSync(OUT), 'run: npm run build');
    assert.equal(fs.readFileSync(OUT, 'utf8'), build(), 'dist is stale — run: npm run build');
});

test('the single-file build references no local files', () => {
    const html = build();
    assert.doesNotMatch(html, /src="js\//);
    assert.doesNotMatch(html, /href="css\//);
});
