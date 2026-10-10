/*
 * Settings that belong to this device, not to the budget: the colour theme and the PIN lock.
 * They live in their own localStorage entry, so they are never part of a backup file, never
 * undone with Ctrl+Z, and loading someone else's backup doesn't change them.
 *
 * The PIN lock hides the app until the PIN is typed. Wrong PINs are counted on the device (a
 * reload doesn't reset them): after 5, a 30-second wait before each try; the 10th wrong PIN erases
 * everything this app keeps on the device and closes it. A backup file brings the data back.
 *
 * With a PIN the saved plan is also encrypted on the device (AES-256-GCM): a random data key,
 * kept only wrapped by a key made from the PIN (PBKDF2-SHA-256). Until the PIN is typed the plan
 * isn't even read; after, it lives decrypted in memory only and every save is encrypted again.
 */
(function (root) {
    'use strict';
    const KEY = (root.APP_EDITION && root.APP_EDITION.deviceKey) || 'plan_financiero_ec_device';
    const IDLE_MS = 5 * 60 * 1000;      // lock again after 5 minutes in the background
    const MAX_TRIES = 5, WAIT_MS = 30 * 1000, WIPE_AT = 10;

    function read() { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } }
    function write(d) { try { localStorage.setItem(KEY, JSON.stringify(d)); return true; } catch (e) { return false; } }

    // ------------------------------------------------------------------ theme
    const media = root.matchMedia ? root.matchMedia('(prefers-color-scheme: dark)') : null;
    const isDark = (t) => t === 'dark' || (t === 'auto' && !!(media && media.matches));

    function applyTheme() {
        const t = read().theme || 'light';
        const dark = isDark(t);
        document.documentElement.dataset.theme = dark ? 'dark' : 'light';
        if (typeof Chart !== 'undefined') {
            Chart.defaults.color = dark ? '#94a3b8' : '#64748b';
            Chart.defaults.borderColor = dark ? 'rgba(148,163,184,.16)' : 'rgba(15,23,42,.08)';
        }
        const b = document.getElementById('theme-toggle');
        if (b) {
            b.innerHTML = `<i class="fa-solid ${dark ? 'fa-sun' : 'fa-moon'}"></i>`;
            b.title = dark ? 'Use light theme' : 'Use dark theme';
        }
        const sel = document.getElementById('cfg-theme');
        if (sel) sel.value = t;
        return dark;
    }

    function setTheme(t) {
        const d = read();
        d.theme = t;
        write(d);
        applyTheme();
        // Charts pick up the new axis colours when they redraw.
        if (root.App && App.render) App.render();
    }
    if (media && media.addEventListener) media.addEventListener('change', () => { if ((read().theme || 'light') === 'auto') setTheme('auto'); });

    // ------------------------------------------------------------------ language
    // Spanish or English, per device. The edition sets the default (Ecuador: Spanish, US: English).
    const defaultLang = () => (root.APP_EDITION && root.APP_EDITION.lang) || 'es';
    const getLang = () => read().lang || defaultLang();
    function applyLang() {
        if (!root.I18n) return;
        I18n.setCountry((root.APP_EDITION && APP_EDITION.country) || 'EC');
        I18n.setLang(getLang());
        const b = document.getElementById('lang-toggle');
        if (b) { b.textContent = getLang() === 'en' ? 'ES' : 'EN'; b.title = getLang() === 'en' ? 'Cambiar a español' : 'Switch to English'; }
        const sel = document.getElementById('cfg-lang');
        if (sel) sel.value = getLang();
    }
    function setLang(l) {
        const d = read();
        d.lang = l;
        write(d);
        applyLang();
        // Redraw what was built with month names and chart labels.
        if (root.App && App.render) App.render();
    }

    // ------------------------------------------------------------------ hide amounts
    // For when someone can see your screen: amounts show as •••. Per device, like the theme.
    function applyPrivacy() {
        const on = !!read().hideAmounts;
        if (root.Fmt && Fmt.setHidden) Fmt.setHidden(on);
        document.documentElement.classList.toggle('amounts-hidden', on);
        const b = document.getElementById('privacy-toggle');
        if (b) { b.innerHTML = `<i class="fa-solid ${on ? 'fa-eye-slash' : 'fa-eye'}"></i>`; b.title = on ? 'Show amounts' : 'Hide amounts'; b.setAttribute('aria-pressed', String(on)); }
        const c = document.getElementById('cfg-hide-amounts');
        if (c) c.checked = on;
    }
    function setPrivacy(on) {
        const d = read();
        if (on) d.hideAmounts = true; else delete d.hideAmounts;
        write(d);
        applyPrivacy();
        if (root.App && App.render) App.render();
    }

    // ------------------------------------------------------------------ PIN
    function randomSalt() {
        const a = new Uint8Array(16);
        (root.crypto && crypto.getRandomValues) ? crypto.getRandomValues(a) : a.forEach((_, i) => { a[i] = Math.floor(Math.random() * 256); });
        return Array.from(a, x => x.toString(16).padStart(2, '0')).join('');
    }
    async function hashPin(pin, salt) {
        if (root.crypto && crypto.subtle) {
            const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(pin), 'PBKDF2', false, ['deriveBits']);
            const bits = await crypto.subtle.deriveBits({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 150000, hash: 'SHA-256' }, key, 256);
            return 'pbkdf2:' + Array.from(new Uint8Array(bits), x => x.toString(16).padStart(2, '0')).join('');
        }
        // Very old browsers: a plain (weak) hash still keeps the PIN itself out of storage.
        let h = 2166136261;
        for (const c of salt + pin) { h ^= c.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
        return 'fnv:' + h.toString(16);
    }
    const hasPin = () => !!(read().lock && read().lock.hash);

    // ------------------------------------------------------------------ data encrypted at rest
    const ENC = 'zdpenc1:';
    const DATA_KEY = () => (root.APP_EDITION && root.APP_EDITION.storageKey) || (root.Store && Store.KEY) || 'plan_financiero_ec_v7_store';
    const c = () => root.crypto && root.crypto.subtle ? root.crypto : null;
    const b64 = (u8) => { let x = ''; for (let i = 0; i < u8.length; i += 0x8000) x += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(x); };
    const unb64 = (str) => { const bin = atob(str), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
    let dataKey = null;            // the data key, in memory only while unlocked
    let pending = [];              // App.init waiting for the PIN (the plan can't be read yet)
    const isEncrypted = (v) => typeof v === 'string' && v.startsWith(ENC);
    function storedRaw() { try { return localStorage.getItem(DATA_KEY()); } catch (e) { return null; } }
    // The plan is on the device but encrypted and the data key isn't in memory: wait for the PIN.
    const dataLocked = () => isEncrypted(storedRaw()) && !dataKey;

    async function kek(pin, salt) {
        const k = await c().subtle.importKey('raw', new TextEncoder().encode(String(pin)), 'PBKDF2', false, ['deriveKey']);
        return c().subtle.deriveKey({ name: 'PBKDF2', salt: new TextEncoder().encode(salt), iterations: 310000, hash: 'SHA-256' }, k, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
    }
    async function wrapKey(pin, raw) {
        const salt = randomSalt(), iv = c().getRandomValues(new Uint8Array(12));
        const data = new Uint8Array(await c().subtle.encrypt({ name: 'AES-GCM', iv }, await kek(pin, salt), raw));
        return { salt, iv: b64(iv), data: b64(data) };
    }
    async function unwrapKey(pin, w) {
        const raw = await c().subtle.decrypt({ name: 'AES-GCM', iv: unb64(w.iv) }, await kek(pin, w.salt), unb64(w.data));
        return c().subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    async function encryptText(text) {
        const iv = c().getRandomValues(new Uint8Array(12));
        const data = new Uint8Array(await c().subtle.encrypt({ name: 'AES-GCM', iv }, dataKey, new TextEncoder().encode(text)));
        return ENC + b64(iv) + '.' + b64(data);
    }
    async function decryptText(v) {
        const [iv, data] = v.slice(ENC.length).split('.');
        return new TextDecoder().decode(await c().subtle.decrypt({ name: 'AES-GCM', iv: unb64(iv) }, dataKey, unb64(data)));
    }
    // What the store saves through while encrypted: reads come from memory; each write is encrypted
    // (in order) before it reaches the device's storage. Other keys pass straight through.
    function secureStorage(plain) {
        let cache = plain, chain = Promise.resolve();
        const KEYN = DATA_KEY();
        return {
            getItem: (k) => (k === KEYN ? cache : localStorage.getItem(k)),
            setItem: (k, v) => {
                if (k !== KEYN) { localStorage.setItem(k, v); return; }
                cache = v;
                chain = chain.then(() => (dataKey ? encryptText(v) : null)).then(enc => { if (enc && cache === v) { localStorage.setItem(KEYN, enc); document.dispatchEvent(new Event('zdp:stored')); } }).catch(() => { /* next save retries */ });
            },
            removeItem: (k) => { if (k === KEYN) cache = null; localStorage.removeItem(k); },
            flush: () => chain
        };
    }
    // The storage the store starts with: the decrypted plan (after the PIN), else the device's own.
    function storage() { return boot || root.localStorage; }
    let boot = null;
    // After the right PIN: get the data key (or make one for a plan saved before encryption),
    // decrypt the plan into memory and let the app start.
    async function openData(pin) {
        if (!c()) { const waiting = pending; pending = []; waiting.forEach(fn => fn()); return; }
        const d = read();
        if (d.lock && d.lock.wrap) { try { dataKey = await unwrapKey(pin, d.lock.wrap); } catch (e) { dataKey = null; } }
        if (!dataKey) await startEncryption(pin);
        const raw = storedRaw();
        let plain = raw;
        if (isEncrypted(raw)) { try { plain = await decryptText(raw); } catch (e) { plain = null; } }
        const st = secureStorage(plain);
        if (root.Store && Store.state) {
            // The app was already running (a lock after being away): just keep saving encrypted.
            Store.storage = st; Store._lastSaved = null; Store.saveNow();
        } else boot = st;
        if (raw && !isEncrypted(raw) && plain) st.setItem(DATA_KEY(), plain);   // an older plain save: encrypt it now
        const waiting = pending; pending = [];
        waiting.forEach(fn => fn());
    }
    // Turning the PIN on (or a plan saved before encryption): a new data key, wrapped by the PIN.
    async function startEncryption(pin) {
        const raw = c().getRandomValues(new Uint8Array(32));
        const d = read();
        if (!d.lock) return;
        d.lock.wrap = await wrapKey(pin, raw);
        write(d);
        dataKey = await c().subtle.importKey('raw', raw, 'AES-GCM', false, ['encrypt', 'decrypt']);
    }
    // App.init calls this: run now, or once the PIN has opened the data. With a PIN the app never
    // starts before it, so nothing of the plan is in memory behind the lock screen.
    function whenReady(fn) { if (dataLocked() || hasPin()) pending.push(fn); else fn(); }

    let hiddenAt = null;
    // Wrong tries and the wait live with the lock, so closing or reloading the app doesn't reset them.
    const fails = () => (read().lock && read().lock.fails) || 0;
    const waitUntil = () => (read().lock && read().lock.waitUntil) || 0;
    function setFails(n, wait) { const d = read(); if (!d.lock) return; d.lock.fails = n; if (wait) d.lock.waitUntil = wait; else delete d.lock.waitUntil; write(d); }
    // Everything this app keeps on this device: the budget, the device settings (PIN included) and
    // the phone's copy. Then the app closes (on a phone) or starts empty (in a browser).
    async function wipeAll() {
        const keys = [KEY];
        if (root.Store && Store.KEY) keys.push(Store.KEY);
        if (root.APP_EDITION && APP_EDITION.storageKey) keys.push(APP_EDITION.storageKey);
        try { for (let i = localStorage.length - 1; i >= 0; i--) { const k = localStorage.key(i); if (keys.some(x => k === x || k.startsWith(x + ':'))) keys.push(k); } } catch (e) { /* no storage */ }
        // Stop the store from writing the plan back (on unload, or the phone's copy).
        if (root.Store) { Store.storage = null; Store._lastSaved = null; }
        if (root.Native && Native.wipe) await Native.wipe([...new Set(keys)]);
        else [...new Set(keys)].forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* gone */ } });
    }

    function showLock() {
        if (!hasPin() || document.getElementById('lock-screen')) return;
        document.documentElement.classList.add('app-locked');
        const el = document.createElement('div');
        el.id = 'lock-screen';
        el.className = 'lock-screen';
        el.setAttribute('role', 'dialog');
        el.setAttribute('aria-modal', 'true');
        el.innerHTML = `
            <form class="lock-box" autocomplete="off">
                <div class="brand-logo mx-auto mb-3"><i class="fa-solid fa-lock"></i></div>
                <div class="lock-title" data-i18n-skip>${(root.APP_EDITION && APP_EDITION.appName) || 'Plan Financiero Ecuador'}</div>
                ${read().lock && read().lock.kind === 'passcode'
                    ? '<p class="lock-sub">Type your passcode to get in.</p><input id="lock-pin" class="lock-input" type="password" maxlength="64" autocomplete="current-password" aria-label="Passcode" autofocus>'
                    : '<p class="lock-sub">Type your PIN to get in.</p><input id="lock-pin" class="lock-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" aria-label="PIN" autofocus>'}
                <p id="lock-msg" class="lock-msg" role="alert"></p>
                <button type="submit" class="btn btn-primary w-full justify-center">Enter</button>
                <button type="button" class="lock-forgot" id="lock-forgot">I forgot my PIN</button>
            </form>`;
        document.body.appendChild(el);
        // Shown before the app starts translating the page: translate it here, in the device's language.
        const tr = (node) => { if (root.I18n && I18n.apply) { applyLang(); I18n.apply(node); } };
        tr(el);
        const input = el.querySelector('#lock-pin'), msg = el.querySelector('#lock-msg');
        const say = (text) => { msg.textContent = root.I18n ? I18n.t(text) : text; };
        setTimeout(() => input.focus(), 30);
        const left = () => {
            const n = fails();
            if (!n) return '';
            return n < MAX_TRIES ? `Wrong PIN. Tries left before a 30-second wait: ${MAX_TRIES - n}.`
                : `Wrong PIN. Tries left before everything on this device is erased: ${WIPE_AT - n}.`;
        };
        if (fails()) say(left());
        el.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (Date.now() < waitUntil()) { say(`Too many tries. Wait ${Math.ceil((waitUntil() - Date.now()) / 1000)} seconds.`); return; }
            const lock = read().lock;
            if (lock && await hashPin(input.value, lock.salt) === lock.hash) {
                setFails(0);
                await openData(input.value);
                el.remove();
                document.documentElement.classList.remove('app-locked');
                if (root.Store && Store.ui.quickAfterUnlock && root.QuickEntry) { Store.ui.quickAfterUnlock = false; QuickEntry.open(); }
                return;
            }
            const n = fails() + 1;
            input.value = '';
            if (n >= WIPE_AT) {
                await wipeAll();
                const box = el.querySelector('.lock-box');
                box.innerHTML = `<div class="brand-logo mx-auto mb-3"><i class="fa-solid fa-shield-halved"></i></div>
                    <div class="lock-title">Data erased</div>
                    <p class="lock-sub">The PIN was wrong ${WIPE_AT} times, so everything this app kept on this device was erased. Load your backup file to get it back.</p>`;
                tr(box);
                setTimeout(() => { if (root.Native && Native.isApp && Native.exit) Native.exit(); else location.reload(); }, 2500);
                return;
            }
            setFails(n, n >= MAX_TRIES ? Date.now() + WAIT_MS : 0);
            const t = (x) => (root.I18n ? I18n.t(x) : x);
            msg.textContent = n >= MAX_TRIES ? `${t(left())} ${t('Wait 30 seconds to try again.')}` : t(left());
            input.focus();
        });
        el.querySelector('#lock-forgot').addEventListener('click', () => {
            // Without the PIN the only way in is to start over on this device. A backup file
            // brings the data back (backups never contain the PIN).
            const box = el.querySelector('.lock-box');
            box.innerHTML = `
                <div class="lock-title">Forgot your PIN?</div>
                <p class="lock-sub">The PIN can't be recovered. To get back in you need to <b>erase this browser's data</b>. Then you can load your backup (.json) from Settings.</p>
                <button type="button" class="btn btn-danger w-full justify-center mt-3" id="lock-wipe">Erase the data and remove the PIN</button>
                <button type="button" class="lock-forgot" id="lock-back">Back</button>`;
            tr(box);
            box.querySelector('#lock-back').addEventListener('click', () => { el.remove(); showLock(); });
            box.querySelector('#lock-wipe').addEventListener('click', async () => {
                await wipeAll();
                location.reload();
            });
        });
    }

    // Turning the PIN on encrypts the saved plan; changing it re-wraps the same data key.
    // kind: 'pin' (4–8 digits) or 'passcode' (8+ characters, letters too: much harder to guess).
    async function setPin(pin, kind = 'pin') {
        // Only from the open app: while locked (someone typing in the browser's console) it would
        // only make the plan unreadable.
        if (locked()) return false;
        const salt = randomSalt();
        const d = read();
        const keep = d.lock && d.lock.wrap && dataKey;
        d.lock = { salt, hash: await hashPin(pin, salt) };
        if (kind === 'passcode') d.lock.kind = 'passcode';
        if (!write(d)) return false;
        if (!c()) return true;
        if (keep) {
            // A new data key wrapped by the new PIN; the plan is saved again with it just below.
            const fresh = c().getRandomValues(new Uint8Array(32));
            dataKey = await c().subtle.importKey('raw', fresh, 'AES-GCM', false, ['encrypt', 'decrypt']);
            const dd = read(); dd.lock.wrap = await wrapKey(pin, fresh); write(dd);
        } else await startEncryption(pin);
        if (root.Store && Store.state) { Store.storage = secureStorage(null); Store._lastSaved = null; Store.saveNow(); await Store.storage.flush(); }
        return true;
    }
    // Removing the PIN saves the plan readable again (it's this device's choice).
    function removePin() {
        if (locked()) return false;
        const d = read(); delete d.lock; write(d);
        dataKey = null;
        if (root.Store && Store.state) { Store.storage = root.localStorage; Store._lastSaved = null; Store.saveNow(); }
        return true;
    }

    // Locked = the lock screen is up, or the plan hasn't been opened with the PIN.
    const locked = () => hasPin() && (!!document.getElementById('lock-screen') || dataLocked() || pending.length > 0);

    // Locking again ("Lock now", or 5 minutes away) forgets the open plan: it's saved (encrypted),
    // then the page starts over and waits for the PIN. A lock screen over a running app could be
    // removed with the browser's developer tools; this way nothing readable is left in memory.
    let relocking = false;
    async function relock() {
        if (!hasPin() || relocking) return;
        relocking = true;
        document.documentElement.classList.add('app-covered');
        try {
            if (root.Store && Store.state && Store.storage) { Store.saveNow(); if (Store.storage.flush) await Store.storage.flush(); }
            if (root.Native && Native.flush) await Native.flush();
        } catch (e) { /* start over anyway */ }
        dataKey = null;
        if (root.Store) Store.storage = null;              // nothing is written on the way out
        location.reload();
    }
    // Away from the app: covered at once (no flash of the plan when coming back), and after 5
    // minutes it locks again, even while still in the background.
    let idleTimer = null;
    document.addEventListener('visibilitychange', () => {
        if (!hasPin()) return;
        if (document.hidden) {
            hiddenAt = Date.now();
            document.documentElement.classList.add('app-covered');
            clearTimeout(idleTimer);
            idleTimer = setTimeout(relock, IDLE_MS);
        } else {
            clearTimeout(idleTimer);
            if (hiddenAt && Date.now() - hiddenAt >= IDLE_MS) relock();
            else document.documentElement.classList.remove('app-covered');
        }
    });
    // An encrypted plan whose key is gone (device settings cleared): it can't be opened here.
    function showLost() {
        const el = document.createElement('div');
        el.id = 'lock-screen'; el.className = 'lock-screen'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true');
        el.innerHTML = `<div class="lock-box"><div class="brand-logo mx-auto mb-3"><i class="fa-solid fa-lock"></i></div>
            <div class="lock-title">Your plan is locked</div>
            <p class="lock-sub">It's saved encrypted, and this device no longer has its PIN. Erase it and load your backup file to start again.</p>
            <button type="button" class="btn btn-danger w-full justify-center mt-3" id="lock-wipe">Erase the data</button></div>`;
        document.body.appendChild(el);
        document.documentElement.classList.add('app-locked');
        if (root.I18n && I18n.apply) { applyLang(); I18n.apply(el); }
        el.querySelector('#lock-wipe').addEventListener('click', async () => { await wipeAll(); location.reload(); });
    }
    document.addEventListener('DOMContentLoaded', () => { applyLang(); applyTheme(); applyPrivacy(); if (dataLocked() && !hasPin()) showLost(); else showLock(); });

    // "Protect it later": the reminder to set a passcode waits a week (this device only).
    function protectLater(days = 7) { const d = read(); d.protectLater = Date.now() + days * 86400000; write(d); }
    const protectDue = () => !hasPin() && !(Number(read().protectLater) > Date.now());
    root.Device = { protectLater, protectDue, applyPrivacy, setPrivacy, hidden: () => !!read().hideAmounts, isPasscode: () => !!(read().lock && read().lock.kind === 'passcode'), storage, whenReady, dataLocked, isEncrypted, WIPE_AT, MAX_TRIES, wipeAll, read, applyTheme, setTheme, getLang, setLang, applyLang, hasPin, setPin, removePin, lockNow: relock, locked, hashPin, KEY };
})(this);
