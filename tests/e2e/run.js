// Runs every browser suite in order and fails if any fails. `npm run e2e`.
// Needs the phone build first (`npm run build:mobile`) for the phone-app suite.
const { spawnSync } = require('child_process');
const path = require('path');
const suites = ['e2e.js', 'e2e-us.js', 'e2e-mobile.js', 'e2e-sweep.js', 'i18n-scan.js', 'i18n-scan-us.js'];
const only = process.argv.slice(2);
let failed = [];
for (const s of suites.filter(x => !only.length || only.some(o => x.includes(o)))) {
    const t = Date.now();
    const r = spawnSync(process.execPath, [path.join(__dirname, s)], { encoding: 'utf8' });
    const out = (r.stdout || '') + (r.stderr || '');
    const summary = out.trim().split('\n').filter(l => /passed|left|FAIL|Error/.test(l));
    console.log(`${r.status === 0 ? 'ok  ' : 'FAIL'} ${s} (${Math.round((Date.now() - t) / 1000)}s)`);
    summary.forEach(l => console.log('     ' + l));
    if (r.status !== 0) { failed.push(s); if (!summary.length) console.log(out.slice(-2000)); }
}
if (failed.length) { console.log(`\n${failed.length} suite(s) failed: ${failed.join(', ')}`); process.exit(1); }
console.log('\nAll browser suites passed.');
