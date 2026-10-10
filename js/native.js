/*
 * Phone app bridge. The same page runs in a browser and inside the Android / iOS app (Capacitor,
 * see mobile/). In the browser everything here falls back to what the web does; in the app:
 *  - files (backups, CSV reports) go to the phone's share sheet: save to Drive, Files, email…
 *  - the Android back button closes the open dialog, then returns to the Summary, then exits;
 *  - every save is also copied to the app's native storage, so the plan survives the system
 *    clearing the web view's storage, and it is put back on the next start.
 * Only Capacitor's own plugins are used; nothing leaves the phone.
 */
(function (root) {
    'use strict';
    const cap = root.Capacitor;
    const isApp = !!(cap && cap.isNativePlatform && cap.isNativePlatform());
    // Native plugins are reached through Capacitor's core (mobile/www/vendor/capacitor.js).
    const plugin = (name) => {
        if (!isApp || !cap.isPluginAvailable || !cap.isPluginAvailable(name)) return null;
        return (cap.Plugins && cap.Plugins[name]) || (cap.registerPlugin ? cap.registerPlugin(name) : null);
    };
    const KEY = root.APP_EDITION && root.APP_EDITION.storageKey;
    if (isApp) {
        document.documentElement.classList.add('is-native');
        document.documentElement.dataset.platform = cap.getPlatform();
    }

    // Was the plan already in the web view's storage before the app started? (Read now, before
    // the store writes its first default save.)
    let hadLocal = true;
    try { hadLocal = !!(KEY && localStorage.getItem(KEY)); } catch (e) { /* no storage */ }

    function download(name, text, type) {
        const url = URL.createObjectURL(new Blob([text], { type }));
        const a = document.createElement('a');
        a.href = url; a.download = name;
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
    }

    // The share sheet, the camera, the fingerprint prompt: the app's own trips outside, which
    // don't count as leaving it (the PIN lock's "right away", js/device.js).
    const outside = () => { if (root.Device && Device.outside) Device.outside(); };
    // Save a text file: a download in the browser, the share sheet in the app.
    async function saveFile(name, text, type = 'text/plain') {
        const fs = plugin('Filesystem'), share = plugin('Share');
        if (!fs || !share) { download(name, text, type); return 'download'; }
        const res = await fs.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
        outside();
        try { await share.share({ title: name, files: [res.uri] }); } catch (e) {
            // Closing the share sheet without choosing is not an error.
            if (!/cancel/i.test(String(e && e.message))) throw e;
        }
        return 'share';
    }

    // Every file that leaves the app is encrypted: ask for a password (twice), encrypt (js/vault.js)
    // and save "<name>.enc.json". Returns false when the person cancels.
    async function askPassword({ title = 'Encrypt the file', confirm = true, message } = {}) {
        const min = root.Vault ? Vault.MIN_PASSWORD : 8;
        const fields = [{ name: 'pw', label: 'Password', type: 'password', help: `At least ${min} characters. Without it the file can't be opened: keep it somewhere safe.` }];
        if (confirm) fields.push({ name: 'pw2', label: 'Type it again', type: 'password' });
        const r = await root.UI.form({ title, icon: 'fa-lock', message: message || 'Files leave the app encrypted (AES-256). You need this password to open the file again.', fields, confirmText: confirm ? 'Encrypt and save' : 'Open',
            validate: (v) => (String(v.pw || '').length < min ? `The password needs at least ${min} characters.` : confirm && v.pw !== v.pw2 ? 'The passwords don\'t match.' : null) });
        return r ? r.pw : null;
    }
    async function saveSecure(name, text, type = 'text/plain', opts = {}) {
        const pw = await askPassword(opts);
        if (!pw) return false;
        const env = await root.Vault.encrypt(text, pw, { name, type });
        return saveFile(name + root.Vault.EXT, env, 'application/json');
    }
    // Erase everything this app keeps on the device: its storage entries and the phone's copy.
    async function wipe(keys) {
        keys.forEach(k => { try { localStorage.removeItem(k); } catch (e) { /* gone */ } });
        try { sessionStorage.clear(); } catch (e) { /* none */ }
        const prefs = plugin('Preferences');
        if (prefs) { try { await Promise.all(keys.map(k => prefs.remove({ key: k }))); } catch (e) { /* best effort */ } }
    }

    // Android back button.
    function onBack() {
        const dlg = document.querySelector('.modal-backdrop:not(.hidden) [data-dialog-cancel]');
        if (dlg) { dlg.click(); return; }
        if (document.documentElement.classList.contains('app-locked')) { exit(); return; }
        const app = root.App, store = root.Store;
        if (app && store && store.ui && store.ui.tab !== 'resumen') { app.go('resumen'); return; }
        exit();
    }
    function exit() { const a = plugin('App'); if (a && a.exitApp) a.exitApp(); }

    // Keep a copy of every save in native storage; put it back if the web view lost it.
    let pendingCopy = Promise.resolve();
    function startMirror() {
        const prefs = plugin('Preferences');
        if (!prefs || !KEY || !root.Store) return;
        prefs.get({ key: KEY }).then(({ value }) => {
            if (!hadLocal && value) {
                // Stop the store from writing the empty plan back on the way out.
                try { localStorage.setItem(KEY, value); root.Store.storage = null; location.reload(); return; } catch (e) { /* fall through */ }
            }
            // The copy is what's on the device (encrypted when there's a PIN), never the plan in memory.
            let last = null;
            const mirror = () => {
                let data = null;
                try { data = localStorage.getItem(KEY); } catch (e) { data = null; }
                if (!data || data === last) return;
                last = data;
                pendingCopy = prefs.set({ key: KEY, value: data }).catch(() => { last = null; });
            };
            root.Store.onChange(mirror);
            document.addEventListener('zdp:stored', mirror);
            mirror();
        }).catch(() => { /* the web view copy still works */ });
    }

    // ------------------------------------------------------------ the app's own plugin (DeviceKey)
    // mobile/android/…/DeviceKeyPlugin.java and mobile/ios/App/App/SceneDelegate.swift.
    const dk = () => plugin('DeviceKey');
    // The data key the phone keeps in its secure hardware (Android Keystore / iOS Keychain, this
    // device only): the plan is saved encrypted with it even without a PIN (js/device.js).
    const hasDeviceKey = () => !!dk();
    async function deviceKey() {
        const p = dk();
        if (!p) return null;
        try { const r = await p.getKey(); return (r && r.key) || null; } catch (e) { return null; }
    }
    // Fingerprint / Face ID: whether the phone has it, and asking for it. The PIN is kept by the
    // phone and handed back only after it's verified.
    const bio = {
        available: async () => { const p = dk(); if (!p) return false; try { return !!(await p.canVerify()).available; } catch (e) { return false; } },
        verify: async (opts) => { const p = dk(); if (!p) return false; outside(); try { await p.verify(opts || {}); return true; } catch (e) { return false; } },
        setSecret: async (value) => { const p = dk(); if (p) await p.setSecret({ value: String(value) }); },
        getSecret: async () => { const p = dk(); if (!p) return null; try { return (await p.getSecret()).value || null; } catch (e) { return null; } },
        clearSecret: async () => { const p = dk(); if (p) { try { await p.clearSecret(); } catch (e) { /* none */ } } }
    };
    async function forgetDevice() { const p = dk(); if (p) { try { await p.clearAll(); } catch (e) { /* none */ } } }
    // Opened from the home-screen shortcut ("Add expense"): quick entry, through the same #rapido
    // link a bookmark uses (js/app.js). Asked at start and each time the app comes back.
    async function takeAction() {
        const p = dk();
        if (!p) return;
        // From a widget: the budget or the goals screen.
        const to = { quick: '#rapido', budget: '#presupuesto/plan', goals: '#futuro/metas' };
        try { const r = await p.takeAction(); if (r && to[r.action]) location.hash = to[r.action]; } catch (e) { /* none */ }
    }

    // A photo straight from the camera (pay stubs, receipts), as a File for the same readers as a
    // picked file. null when cancelled or not in the app.
    async function takePhoto() {
        const cam = plugin('Camera');
        if (!cam) return null;
        outside();
        try {
            const r = await cam.getPhoto({ source: 'CAMERA', resultType: 'base64', quality: 85, correctOrientation: true, saveToGallery: false });
            if (!r || !r.base64String) return null;
            const bin = atob(r.base64String), bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            return new File([bytes], 'photo.' + (r.format || 'jpeg'), { type: 'image/' + (r.format || 'jpeg') });
        } catch (e) { return null; }
    }

    // Reminders on the phone (no server): bills a day before they're due, the weekly review, and
    // the person's own reminders (repeating: `on` = { hour, minute, weekday? }). Ids 9000–9999 are
    // this app's; each schedule replaces them.
    const notifications = {
        available: () => !!plugin('LocalNotifications'),
        allow: async () => {
            const ln = plugin('LocalNotifications');
            if (!ln) return false;
            outside();
            try { const p = await ln.requestPermissions(); return p && p.display === 'granted'; } catch (e) { return false; }
        },
        schedule: async (list) => {
            const ln = plugin('LocalNotifications');
            if (!ln) return false;
            try {
                const pending = await ln.getPending();
                const ours = ((pending && pending.notifications) || []).filter(n => n.id >= 9000 && n.id < 10000).map(n => ({ id: n.id }));
                if (ours.length) await ln.cancel({ notifications: ours });
                if (list.length) await ln.schedule({ notifications: list.slice(0, 60).map((n, i) => ({ id: 9000 + i, title: n.title, body: n.body, schedule: n.on ? { on: n.on, allowWhileIdle: true } : { at: n.at, allowWhileIdle: true } })) });
                return true;
            } catch (e) { return false; }
        }
    };

    // Home-screen widgets (Android): what they show is prepared by the app (percentages and dates,
    // no amounts) and kept by the phone until the next update; clear() blanks them.
    const widgets = {
        available: () => !!plugin('Widgets'),
        update: async (data) => {
            const p = plugin('Widgets');
            if (!p) return false;
            try { await p.update({ budget: JSON.stringify(data.budget || null), goal: JSON.stringify(data.goal || null) }); return true; } catch (e) { return false; }
        },
        clear: async () => { const p = plugin('Widgets'); if (p) { try { await p.clear(); } catch (e) { /* none */ } } }
    };

    if (isApp) {
        const app = plugin('App');
        if (app && app.addListener) app.addListener('backButton', onBack);
        document.addEventListener('DOMContentLoaded', () => { setTimeout(startMirror, 0); setTimeout(takeAction, 300); });
        document.addEventListener('visibilitychange', () => { if (!document.hidden) takeAction(); });
    }

    root.Native = { isApp, saveFile, saveSecure, askPassword, wipe, exit, flush: () => pendingCopy, platform: isApp ? cap.getPlatform() : 'web',
        hasDeviceKey, deviceKey, bio, forgetDevice, takePhoto, notifications, widgets };
})(this);
