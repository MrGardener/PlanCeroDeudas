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
