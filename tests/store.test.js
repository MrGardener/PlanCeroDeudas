// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

global.Defaults = require('../js/defaults.js');
global.Engine = require('../js/engine.js');
const Store = require('../js/store.js');

const legacy = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures/v7-backup.json'), 'utf8'));

function memoryStorage() {
    const m = new Map();
    return { getItem: k => (m.has(k) ? m.get(k) : null), setItem: (k, v) => m.set(k, String(v)), removeItem: k => m.delete(k), _m: m };
}

test('pre-refactor backups migrate without losing data', () => {
    const s = Store.migrate(JSON.parse(JSON.stringify(legacy)));
    assert.equal(s.version, 8);
    assert.equal(s.years[2026].sueldo, 2200);
    assert.equal(s.years[2026].d3, true);
    assert.equal(s.years[2026].monthOverrides['12'][5].real, 400);
    assert.equal(s.assets.find(a => a.name === 'Carro').saleYear, 2027);
    assert.ok(s.transactions.some(t => t.description.includes('Cena')));
    assert.deepEqual(s.taxonomy.expense['Mi Categoría'], ['Sub 1']);
    assert.equal(s.goals[0].name, 'Fondo "Pleno"');
    assert.equal(s.settings.retireWhatIfMax, 800);
    assert.equal(s.settings.mortgageSystem, 'aleman');
    assert.equal(s.mortgage.amount, 95000);
    // Debts gain a kind so they map to the right net-worth liability.
    assert.equal(s.debts.find(d => d.id === 1).kind, 'tarjeta');
    assert.equal(s.debts.find(d => d.id === 2).kind, 'vehicular');
    assert.equal(s.debts.find(d => d.id === 3).kind, 'personal');
    // Net worth keeps its touched values and drops the dead pre-registry keys.
    assert.equal(s.years[2025].netWorth.checking, 1500);
    assert.equal(s.years[2025].netWorthTouched.creditCards, true);
    assert.equal(s.years[2025].netWorth.realEstate, undefined);
    assert.equal(Engine.netWorthField(s.years, 2030, 'checking'), 1500);
    // Retirement / debt plan didn't exist before: defaults are filled in.
    assert.equal(s.retirement.edadJubilacion, 65);
    assert.equal(s.debtPlan.strategy, 'snowball');
});

test('legacy baselines stay restorable with their original scope', () => {
    const storage = memoryStorage();
    storage.setItem(Store.KEY, JSON.stringify(legacy));
    Store.init(storage);
    assert.equal(Store.state.baselines.length, 1);
    assert.equal(Store.state.baselines[0].legacy, true);
    Store.state.polizas = [];
    Store.state.goals = [{ id: 9, name: 'keep me', target: 1, current: 0, monthly: 1, rate: 0 }];
    assert.equal(Store.restoreBaseline(111), true);
    assert.equal(Store.state.polizas.length, 2);          // restored from the baseline
    assert.equal(Store.state.goals[0].name, 'keep me');  // legacy baselines never covered goals
    assert.equal(Store.state.baselines.length, 1);
});

test('new baselines snapshot and restore the whole model', () => {
    const storage = memoryStorage();
    Store.init(storage);
    Store.state.transactions.push({ id: 99, type: 'Gasto', description: 'x', amount: 1, date: '2026-01-01', parentCategory: 'Otros' });
    const b = Store.createBaseline('antes');
    Store.state.transactions = [];
    Store.state.goals = [];
    Store.restoreBaseline(b.id);
    assert.ok(Store.state.transactions.some(t => t.id === 99));
    assert.ok(Store.state.goals.length > 0);
    assert.equal(Store.state.baselines.length, 1);
});

test('autosave writes only when something changed and round-trips', () => {
    const storage = memoryStorage();
    Store.init(storage);
    Store.saveNow();
    const first = storage.getItem(Store.KEY);
    assert.ok(first);
    Store.year(2026).sueldo = 3333;
    Store.saveNow();
    const reloaded = Store.migrate(JSON.parse(storage.getItem(Store.KEY)));
    assert.equal(reloaded.years[2026].sueldo, 3333);
});

test('reset("empty") clears every personal list and only this app\'s storage key', () => {
    const storage = memoryStorage();
    storage.setItem('other-app', 'keep');
    Store.init(storage);
    Store.reset('empty');
    ['polizas', 'goals', 'debts', 'assets', 'transactions', 'baselines'].forEach(k => assert.equal(Store.state[k].length, 0, k));
    assert.equal(storage.getItem('other-app'), 'keep');
});

test('copying a year keeps the target year\'s net worth records', () => {
    Store.init(memoryStorage());
    const a = Store.year(2025); a.sueldo = 4000; a.netWorth.checking = 1; a.netWorthTouched.checking = true;
    const b = Store.year(2026); b.netWorth.checking = 777; b.netWorthTouched.checking = true;
    Store.copyYear(2025, 2026);
    assert.equal(Store.state.years[2026].sueldo, 4000);
    assert.equal(Store.state.years[2026].netWorth.checking, 777);
});

test('peekYear never adds unconfigured years and refuses writes', () => {
    Store.init(memoryStorage());
    const before = Object.keys(Store.state.years).length;
    const d = Store.peekYear(2044);
    assert.equal(Object.keys(Store.state.years).length, before);
    assert.throws(() => { 'use strict'; d.sueldo = 1; });
});
