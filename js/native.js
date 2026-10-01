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

    // Save a text file: a download in the browser, the share sheet in the app.
    async function saveFile(name, text, type = 'text/plain') {
        const fs = plugin('Filesystem'), share = plugin('Share');
        if (!fs || !share) { download(name, text, type); return 'download'; }
        const res = await fs.writeFile({ path: name, data: text, directory: 'CACHE', encoding: 'utf8' });
        try { await share.share({ title: name, files: [res.uri] }); } catch (e) {
            // Closing the share sheet without choosing is not an error.
            if (!/cancel/i.test(String(e && e.message))) throw e;
        }
        return 'share';
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
    function startMirror() {
        const prefs = plugin('Preferences');
        if (!prefs || !KEY || !root.Store) return;
        prefs.get({ key: KEY }).then(({ value }) => {
            if (!hadLocal && value) {
                // Stop the store from writing the empty plan back on the way out.
                try { localStorage.setItem(KEY, value); root.Store.storage = null; location.reload(); return; } catch (e) { /* fall through */ }
            }
            let last = null;
            const mirror = () => {
                const data = root.Store._lastSaved;
                if (!data || data === last) return;
                last = data;
                prefs.set({ key: KEY, value: data }).catch(() => { last = null; });
            };
            root.Store.onChange(mirror);
            mirror();
        }).catch(() => { /* the web view copy still works */ });
    }

    if (isApp) {
        const app = plugin('App');
        if (app && app.addListener) app.addListener('backButton', onBack);
        document.addEventListener('DOMContentLoaded', () => setTimeout(startMirror, 0));
    }

    root.Native = { isApp, saveFile, platform: isApp ? cap.getPlatform() : 'web' };
})(this);
