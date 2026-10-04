// Spanish text still in the code (outside the data packs). The app is written in English now:
// this list may only shrink. tests/i18n.test.js fails when something new shows up.
//   npm run i18n:spanish            what's new / what's gone since tests/i18n-spanish-left.json
//   npm run i18n:spanish -- --write  save the current list (after moving text to English)
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const LIST = path.join(__dirname, '..', 'tests', 'i18n-spanish-left.json');

// Category names, defaults and statement words are saved data: they stay Spanish.
const DATA = /(^|\/)js\/(defaults(-us)?|categorize|sample)\.js$/;
function current() {
    const keys = JSON.parse(execFileSync('node', [path.join(__dirname, 'i18n-extract.js')], { encoding: 'utf8', maxBuffer: 1 << 24 }));
    return Object.keys(keys).filter(k => keys[k].split(', ').some(f => !DATA.test(f.replace(/@attr$/, '')))).sort();
}
function compare() {
    const now = current(), allowed = new Set(JSON.parse(fs.readFileSync(LIST, 'utf8')));
    return { now, added: now.filter(k => !allowed.has(k)), gone: [...allowed].filter(k => !now.includes(k)) };
}
module.exports = { current, compare, LIST };

if (require.main === module) {
    if (process.argv.includes('--write')) {
        const now = current();
        fs.writeFileSync(LIST, JSON.stringify(now, null, 1) + '\n');
        console.log(`${now.length} Spanish texts left in the code (saved to tests/i18n-spanish-left.json).`);
    } else {
        const { now, added, gone } = compare();
        console.log(`${now.length} Spanish texts left in the code.`);
        if (added.length) console.log(`New (write these in English, or --write if they are saved data):\n  ${added.join('\n  ')}`);
        if (gone.length) console.log(`Moved to English since the list was saved (${gone.length}): run with --write.`);
    }
}
