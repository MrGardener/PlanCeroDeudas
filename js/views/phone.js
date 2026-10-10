/* What only the phone app does (js/native.js talks to the phone):
 * - Reminders (no server): a bill due tomorrow and the weekly review on Sundays, scheduled on the
 *   phone from the budget (Engine.reminderSchedule). The notification says no amounts or names:
 *   it can show on a locked screen.
 * - A camera button beside the pay stub and receipt pickers: the photo goes to the same reader.
 * - Settings → This device: fingerprint / Face ID unlock and reminders. */
(function () {
    'use strict';
    const t = (x) => I18n.t(x);

    // Schedule the next weeks' reminders again (after a budget change, a few seconds later).
    async function sync() {
        if (!Native.isApp || !Native.notifications.available()) return;
        if (!Device.remindersOn() || !Store.state) { await Native.notifications.schedule([]); return; }
        const today = new Date(), y = today.getFullYear(), m = String(today.getMonth() + 1);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, Store.state.transactions, y, m);
        const paid = (id) => { const b = Engine.billsDue({ items, spend, year: y, month: m, today }).find(x => String(x.item.id) === String(id)); return !!(b && b.paid); };
        const list = Engine.reminderSchedule({ itemsFor: (yy, mm) => Engine.monthItems(Store.effective(yy), mm), today, paid })
            .map(r => r.kind === 'bill' ? { at: r.at, title: t('A bill is due tomorrow'), body: t('Open the app to see it and check it\'s covered.') }
                : { at: r.at, title: t('Weekly review'), body: t('A few minutes to keep your budget true to real life.') });
        await Native.notifications.schedule(list);
    }
    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(sync, 3000); };
    if (Native.isApp) document.addEventListener('DOMContentLoaded', () => Device.whenReady(() => setTimeout(() => { sync(); if (Store.onChange) Store.onChange(later); }, 1500)));

    // Settings → This device (phone): fingerprint unlock (needs the PIN on) and reminders.
    async function render() {
        const box = document.getElementById('cfg-phone');
        if (!box || !Native.isApp) return;
        const bioOk = await Native.bio.available();
        const bio = document.getElementById('cfg-bio');
        UI.show('cfg-bio-row', bioOk);
        if (bio) { bio.checked = Device.bioOn(); bio.disabled = !Device.hasPin(); }
        UI.text('cfg-bio-note', Device.hasPin() ? '' : t('Turn on the PIN lock first.'));
        UI.show('cfg-reminders-row', Native.notifications.available());
        const rem = document.getElementById('cfg-reminders');
        if (rem) rem.checked = Device.remindersOn();
    }

    UI.register({
        'device.bio': async (el) => {
            if (!el.checked) { await Device.setBio(false); UI.toast('Fingerprint unlock turned off.'); return; }
            const r = await UI.form({ title: 'Unlock with fingerprint or face', message: 'Type your PIN once: the phone keeps it and gives it back only after it confirms it\'s you.', confirmText: 'Continue',
                fields: [{ name: 'pin', label: 'Your PIN or passcode', type: 'password' }] });
            if (!r || !await Native.bio.verify({ title: t('Unlock with fingerprint or face'), subtitle: t('Confirm it\'s you'), cancel: t('Cancel') })) { el.checked = false; return; }
            const on = await Device.setBio(true, r.pin);
            el.checked = on;
            UI.toast(on ? 'Fingerprint unlock is on.' : 'That\'s not your PIN.', on ? 'ok' : 'error');
        },
        'device.reminders': async (el) => {
            if (el.checked && !await Native.notifications.allow()) { el.checked = false; UI.toast('The phone didn\'t allow notifications: turn them on in its settings for this app.', 'error'); return; }
            Device.setReminders(el.checked);
            await sync();
            UI.toast(el.checked ? 'Reminders on: a bill due tomorrow and the weekly review on Sundays.' : 'Reminders off.');
        },
        // The camera instead of the file picker: the photo goes to that picker's own reader.
        'cam.photo': async (el) => {
            const input = document.getElementById(el.dataset.for);
            const file = await Native.takePhoto();
            if (!file || !input) return;
            UI.runWith(input.dataset.change, { files: [file], value: '', dataset: input.dataset });
        }
    });

    window.Phone = { sync, render };
})();
