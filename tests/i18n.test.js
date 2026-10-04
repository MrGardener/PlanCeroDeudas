// The app is written in English; Spanish is js/i18n/es.js (English → Spanish). Text that is still
// Spanish in the code (saved data, older code) needs English in js/i18n/en.js: that fails here.
// English without Spanish yet is not a failure: `npm run i18n:missing` lists it.
const test = require('node:test');
const assert = require('node:assert/strict');
const { execFileSync } = require('node:child_process');
const path = require('node:path');

// Internal names that look like words but are never shown.
const IGNORE = /^[A-Z]{2}$|^[a-z0-9-]+(\/[a-z]+)?$|^[.\[]|^es-|^en-|^pt-|total|^no (lib|Tesseract)$|^ya$|^ón|^disabled title|Alianza del Valle|Cooperativa Politécnica|Jardín Azuayo/;

test('every text still in Spanish has an English translation', () => {
    const keys = Object.keys(JSON.parse(execFileSync('node', [path.join(__dirname, '..', 'scripts', 'i18n-extract.js')], { encoding: 'utf8', maxBuffer: 1 << 24 })));
    global.I18n = { d: {}, add(l, e) { Object.assign(this.d, e); } };
    require('../js/i18n/en.js');
    const have = new Set(Object.keys(global.I18n.d).map(k => k.replace(/\s+/g, ' ').trim()));
    // The US edition's own Spanish wording (js/i18n/us.js) needs English too.
    const country = {};
    global.I18n.country = (c, e) => Object.assign(country, e);
    require('../js/i18n/us.js');
    keys.push(...Object.values(country));
    // English text that looks Spanish to the extractor ("Redo (Ctrl+Y)") is in es.js.
    global.I18n.add = (l, e) => { if (l === 'es') Object.keys(e).forEach(k => have.add(k)); };
    global.I18n.override = () => {};
    require('../js/i18n/es.js');
    const missing = [...new Set(keys)].filter(k => !have.has(k.replace(/\s+/g, ' ').trim()) && !IGNORE.test(k));
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

test('Spanish (es.js) and Ecuador wording (ec.js) keep their placeholders', () => {
    const d = {}, o = {};
    global.I18n = { add(l, e) { Object.assign(d, e); }, override(c, l, e) { o[c + l] = Object.assign(o[c + l] || {}, e); } };
    ['../js/i18n/es.js', '../js/i18n/ec.js'].forEach(f => { delete require.cache[require.resolve(f)]; require(f); });
    const bad = [d, o.ECen, o.ECes].flatMap(dict => Object.entries(dict).filter(([k, v]) =>
        (k.match(/\{\d+\}/g) || []).some(p => !new RegExp(`\\{${p.slice(1, -1)}(\\|[^}]*)?\\}`).test(v))).map(([k]) => k));
    assert.deepEqual(bad, []);
    // Ecuador's own wording is for text the app has.
    assert.deepEqual(Object.keys(o.ECen).concat(Object.keys(o.ECes)).filter(k => d[k] === undefined), []);
});
