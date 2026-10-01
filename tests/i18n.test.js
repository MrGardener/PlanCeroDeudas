// Every Spanish text the app can show has an English translation (js/i18n/en.js).
// New text without one fails here: add it to the dictionary.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Internal names that look like words but are never shown.
const IGNORE = /^[a-z0-9-]+(\/[a-z]+)?$|^[.\[]|^es-|^en-|^pt-|total|^no (lib|Tesseract)$|^ya$|^ón|^disabled title|Alianza del Valle|Cooperativa Politécnica|Jardín Azuayo/;

test('every Spanish text has an English translation', () => {
    const keys = Object.keys(JSON.parse(execFileSync('node', [path.join(__dirname, '..', 'scripts', 'i18n-extract.js')], { encoding: 'utf8', maxBuffer: 1 << 24 })));
    global.I18n = { d: {}, add(l, e) { Object.assign(this.d, e); } };
    require('../js/i18n/en.js');
    const have = new Set(Object.keys(global.I18n.d).map(k => k.replace(/\s+/g, ' ').trim()));
    const missing = keys.filter(k => !have.has(k) && !IGNORE.test(k));
    assert.deepEqual(missing, [], `Missing English for:\n${missing.join('\n')}`);
});

test('translations keep their placeholders', () => {
    global.I18n = { d: {}, add(l, e) { Object.assign(this.d, e); } };
    delete require.cache[require.resolve('../js/i18n/en.js')];
    require('../js/i18n/en.js');
    const bad = Object.entries(global.I18n.d).filter(([k, v]) => {
        const need = (k.match(/\{\d+\}/g) || []).map(x => x.slice(1, -1));
        // A value may be dropped on purpose only when it's a Spanish word ending (handled by {n|…}).
        return need.some(n => !new RegExp(`\\{${n}(\\|[^}]*)?\\}`).test(v) && !/[a-z]\{\d+\}/i.test(k));
    }).map(([k]) => k);
    assert.deepEqual(bad, []);
});
