/*
 * Encrypted files. Backups and exports leave the device only encrypted with a password the
 * person picks: AES-GCM (256-bit) with a key from PBKDF2-SHA-256 (600,000 rounds), a random salt
 * and IV per file. GCM also detects a changed file: a wrong password or a modified byte both fail.
 * The file is a small JSON envelope, so it can be recognized and opened again here
 * (Settings → Open an encrypted file). Nothing about the password is kept.
 */
(function (root) {
    'use strict';
    const MAGIC = 'zerodebtplan-vault', VERSION = 1, ITER = 600000, MIN_PASSWORD = 8;
    const subtle = () => {
        const c = root.crypto || (typeof globalThis !== 'undefined' && globalThis.crypto);
        if (!c || !c.subtle) throw new Error('This browser can\'t encrypt files (it needs a secure page).');
        return c;
    };
    const enc = new TextEncoder(), dec = new TextDecoder();

    function toB64(bytes) {
        if (typeof Buffer !== 'undefined' && typeof window === 'undefined') return Buffer.from(bytes).toString('base64');
        let s = '';
        for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
        return btoa(s);
    }
    function fromB64(s) {
        if (typeof Buffer !== 'undefined' && typeof window === 'undefined') return new Uint8Array(Buffer.from(s, 'base64'));
        const bin = atob(s), out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    async function keyFrom(password, salt, iter) {
        const c = subtle();
        const base = await c.subtle.importKey('raw', enc.encode(String(password)), 'PBKDF2', false, ['deriveKey']);
        return c.subtle.deriveKey({ name: 'PBKDF2', salt, iterations: iter, hash: 'SHA-256' }, base, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }

    // text → the envelope (a JSON string). meta: { name, type } of the original file.
    async function encrypt(text, password, meta = {}, { iter = ITER } = {}) {
        if (!password || String(password).length < MIN_PASSWORD) throw new Error(`The password needs at least ${MIN_PASSWORD} characters.`);
        const c = subtle();
        const salt = c.getRandomValues(new Uint8Array(16)), iv = c.getRandomValues(new Uint8Array(12));
        const key = await keyFrom(password, salt, iter);
        // The name and type ride inside the encrypted part, so the envelope says nothing about it.
        const body = enc.encode(JSON.stringify({ name: meta.name || '', type: meta.type || 'text/plain', text: String(text) }));
        const data = new Uint8Array(await c.subtle.encrypt({ name: 'AES-GCM', iv }, key, body));
        return JSON.stringify({ app: MAGIC, v: VERSION, kdf: 'PBKDF2-SHA256', iter, cipher: 'AES-256-GCM', salt: toB64(salt), iv: toB64(iv), data: toB64(data) });
    }

    function isVault(text) {
        if (typeof text !== 'string' || text.length > 1e9 || !/^\s*\{/.test(text) || text.indexOf(MAGIC) < 0) return false;
        try { const o = JSON.parse(text); return o && o.app === MAGIC && typeof o.data === 'string'; } catch (e) { return false; }
    }

    // The envelope → { text, name, type }. A wrong password or a changed file throws.
    async function decrypt(envelope, password) {
        const o = typeof envelope === 'string' ? JSON.parse(envelope) : envelope;
        if (!o || o.app !== MAGIC) throw new Error('This isn\'t an encrypted file from this app.');
        if (o.v !== VERSION) throw new Error('This file was made by a newer version of the app.');
        const iter = Math.max(100000, Math.min(10000000, Number(o.iter) || ITER));
        const key = await keyFrom(password, fromB64(o.salt), iter);
        let plain;
        try { plain = await subtle().subtle.decrypt({ name: 'AES-GCM', iv: fromB64(o.iv) }, key, fromB64(o.data)); } catch (e) {
            const err = new Error('Wrong password, or the file was changed.');
            err.code = 'bad-password';
            throw err;
        }
        const body = JSON.parse(dec.decode(plain));
        return { text: body.text, name: body.name, type: body.type };
    }

    const Vault = { encrypt, decrypt, isVault, MIN_PASSWORD, EXT: '.enc.json' };
    if (typeof module !== 'undefined' && module.exports) module.exports = Vault;
    else root.Vault = Vault;
})(typeof window !== 'undefined' ? window : this);
