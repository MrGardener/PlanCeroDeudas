/*
 * Settings that belong to this device, not to the budget: the colour theme and the PIN lock.
 * They live in their own localStorage entry, so they are never part of a backup file, never
 * undone with Ctrl+Z, and loading someone else's backup doesn't change them.
 *
 * The PIN lock hides the app until the PIN is typed. It is a screen lock, not encryption:
 * the data stays readable to anyone with full access to this browser's storage.
 */
(function (root) {
    'use strict';
    const KEY = 'plan_financiero_ec_device';
    const IDLE_MS = 5 * 60 * 1000;      // lock again after 5 minutes in the background
    const MAX_TRIES = 5, WAIT_MS = 30 * 1000;

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
            b.title = dark ? 'Usar tema claro' : 'Usar tema oscuro';
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

    let hiddenAt = null, tries = 0, waitUntil = 0;

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
                <div class="lock-title">Plan Financiero Ecuador</div>
                <p class="lock-sub">Escribe tu PIN para entrar.</p>
                <input id="lock-pin" class="lock-input" type="password" inputmode="numeric" pattern="[0-9]*" maxlength="8" aria-label="PIN" autofocus>
                <p id="lock-msg" class="lock-msg" role="alert"></p>
                <button type="submit" class="btn btn-primary w-full justify-center">Entrar</button>
                <button type="button" class="lock-forgot" id="lock-forgot">Olvidé mi PIN</button>
            </form>`;
        document.body.appendChild(el);
        const input = el.querySelector('#lock-pin'), msg = el.querySelector('#lock-msg');
        setTimeout(() => input.focus(), 30);
        el.querySelector('form').addEventListener('submit', async (e) => {
            e.preventDefault();
            if (Date.now() < waitUntil) { msg.textContent = `Demasiados intentos. Espera ${Math.ceil((waitUntil - Date.now()) / 1000)} segundos.`; return; }
            const lock = read().lock;
            if (lock && await hashPin(input.value, lock.salt) === lock.hash) {
                tries = 0;
                el.remove();
                document.documentElement.classList.remove('app-locked');
                if (root.Store && Store.ui.quickAfterUnlock && root.QuickEntry) { Store.ui.quickAfterUnlock = false; QuickEntry.open(); }
                return;
            }
            tries++;
            input.value = '';
            if (tries >= MAX_TRIES) { tries = 0; waitUntil = Date.now() + WAIT_MS; msg.textContent = 'PIN incorrecto. Espera 30 segundos para volver a intentar.'; }
            else msg.textContent = `PIN incorrecto. Te quedan ${MAX_TRIES - tries} intentos.`;
            input.focus();
        });
        el.querySelector('#lock-forgot').addEventListener('click', () => {
            // Without the PIN the only way in is to start over on this device. A backup file
            // brings the data back (backups never contain the PIN).
            const box = el.querySelector('.lock-box');
            box.innerHTML = `
                <div class="lock-title">¿Olvidaste tu PIN?</div>
                <p class="lock-sub">El PIN no se puede recuperar. Para volver a entrar hay que <b>borrar los datos de este navegador</b>. Después puedes cargar tu copia de respaldo (.json) desde Configuración.</p>
                <button type="button" class="btn btn-danger w-full justify-center mt-3" id="lock-wipe">Borrar los datos y quitar el PIN</button>
                <button type="button" class="lock-forgot" id="lock-back">Volver</button>`;
            box.querySelector('#lock-back').addEventListener('click', () => { el.remove(); showLock(); });
            box.querySelector('#lock-wipe').addEventListener('click', () => {
                const d = read(); delete d.lock; write(d);
                if (root.Store) { Store.reset('empty'); }
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

    root.Device = { read, applyTheme, setTheme, getLang, setLang, applyLang, hasPin, setPin, removePin, lockNow: showLock, hashPin, KEY };
})(this);
