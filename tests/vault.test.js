// Encrypted backups and exports (js/vault.js): what goes in comes back with the right password;
// a wrong password or a changed byte fails; the envelope says nothing about the content.
const test = require('node:test');
const assert = require('node:assert/strict');
const Vault = require('../js/vault.js');
const FAST = { iter: 100000 };

test('encrypt → decrypt gives back the text, name and type', async () => {
    const text = 'date,payee,amount\n2026-10-01,Invented Grocer,42.10\n' + 'é ñ ü — €'.repeat(50);
    const env = await Vault.encrypt(text, 'correct horse', { name: 'transactions.csv', type: 'text/csv' }, FAST);
    assert.ok(Vault.isVault(env));
    assert.ok(!env.includes('Invented Grocer') && !env.includes('transactions.csv'), 'nothing readable outside');
    const out = await Vault.decrypt(env, 'correct horse');
    assert.deepEqual(out, { text, name: 'transactions.csv', type: 'text/csv' });
});

test('a wrong password or a changed file fails', async () => {
    const env = await Vault.encrypt('{"years":{}}', 'correct horse', {}, FAST);
    await assert.rejects(Vault.decrypt(env, 'wrong horse!'), e => e.code === 'bad-password');
    const o = JSON.parse(env), d = Buffer.from(o.data, 'base64');
    d[5] ^= 1;
    o.data = d.toString('base64');
    await assert.rejects(Vault.decrypt(JSON.stringify(o), 'correct horse'), e => e.code === 'bad-password');
});

test('each file gets its own salt and IV; short passwords are refused; plain JSON is not a vault', async () => {
    const a = JSON.parse(await Vault.encrypt('same', 'password1', {}, FAST)), b = JSON.parse(await Vault.encrypt('same', 'password1', {}, FAST));
    assert.notEqual(a.salt, b.salt);
    assert.notEqual(a.iv, b.iv);
    assert.notEqual(a.data, b.data);
    assert.equal(a.cipher, 'AES-256-GCM');
    await assert.rejects(Vault.encrypt('x', 'short'), /at least 8/);
    assert.equal(Vault.isVault('{"years":{}}'), false);
    assert.equal(Vault.isVault('not json'), false);
});
