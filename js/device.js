/*
 * Settings that belong to this device, not to the budget: the colour theme and the PIN lock.
 * They live in their own localStorage entry, so they are never part of a backup file, never
 * undone with Ctrl+Z, and loading someone else's backup doesn't change them.
 *
 * The PIN lock hides the app until the PIN is typed. Wrong PINs are counted on the device (a
 * reload doesn't reset them): after 5, a 30-second wait before each try; the 10th wrong PIN erases
 * everything this app keeps on the device and closes it. A backup file brings the data back.
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
                <p class="lock-sub">Type your PIN to get in.</p>
                <input id="lock-pin" class="lock-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" aria-label="PIN" autofocus>
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

    async function setPin(pin) {
        const salt = randomSalt();
        const d = read();
        d.lock = { salt, hash: await hashPin(pin, salt) };
        return write(d);
    }
    function removePin() { const d = read(); delete d.lock; write(d); }

    document.addEventListener('visibilitychange', () => {
        if (document.hidden) hiddenAt = Date.now();
        else if (hiddenAt && Date.now() - hiddenAt >= IDLE_MS) showLock();
    });
    document.addEventListener('DOMContentLoaded', () => { applyLang(); applyTheme(); showLock(); });

    root.Device = { WIPE_AT, MAX_TRIES, wipeAll, read, applyTheme, setTheme, getLang, setLang, applyLang, hasPin, setPin, removePin, lockNow: showLock, hashPin, KEY };
})(this);
