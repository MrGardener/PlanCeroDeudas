/* What only the phone app does (js/native.js talks to the phone):
 * - Reminders (no server): a bill due tomorrow and the weekly review on Sundays, scheduled on the
 *   phone from the budget (Engine.reminderSchedule). The notification says no amounts or names:
 *   it can show on a locked screen. And the person's own reminders, in their words, daily or on
 *   one day of the week (Engine.personalReminders; saved with the plan, encrypted).
 * - Home-screen widgets (Android, turned on in Settings): this month's categories at 90%+ of their
 *   plan, and the goal closest to done with the month it's done and the pace it needs — only
 *   percentages and dates (Engine.widgetData), prepared here in the app's language.
 * - A camera button beside the pay stub and receipt pickers: the photo goes to the same reader.
 * - Settings → This device: fingerprint / Face ID unlock, reminders, widgets. */
(function () {
    'use strict';
    const t = (x) => I18n.t(x);

    const mine = () => (Store.state && Store.state.settings.myReminders) || [];
    // Schedule the next weeks' reminders again (after a budget change, a few seconds later): the
    // person's own first (repeating), then bills and the weekly review when those are on.
    async function sync() {
        if (!Native.isApp || !Native.notifications.available()) return;
        if (!Store.state) { await Native.notifications.schedule([]); return; }
        const own = Engine.personalReminders(mine()).slice(0, 10).map(r => ({ on: r.weekday ? { weekday: r.weekday, hour: r.hour, minute: r.minute } : { hour: r.hour, minute: r.minute }, title: t('Your reminder'), body: r.text }));
        if (!Device.remindersOn()) { await Native.notifications.schedule(own); return; }
        const today = new Date(), y = today.getFullYear(), m = String(today.getMonth() + 1);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, Store.state.transactions, y, m);
        const paid = (id) => { const b = Engine.billsDue({ items, spend, year: y, month: m, today }).find(x => String(x.item.id) === String(id)); return !!(b && b.paid); };
        const list = Engine.reminderSchedule({ itemsFor: (yy, mm) => Engine.monthItems(Store.effective(yy), mm), today, paid })
            .map(r => r.kind === 'bill' ? { at: r.at, title: t('A bill is due tomorrow'), body: t('Open the app to see it and check it\'s covered.') }
                : { at: r.at, title: t('Weekly review'), body: t('A few minutes to keep your budget true to real life.') });
        await Native.notifications.schedule(own.concat(list));
    }

    // The widgets' content, in the app's language: percentages and dates, never amounts or goal
    // names (category names do show, so you know where to stop).
    function widgetContent(today = new Date()) {
        const y = today.getFullYear(), m = String(today.getMonth() + 1);
        const items = Engine.monthItems(Store.effective(y), m);
        const spend = Engine.lineSpend(items, Store.state.transactions, y, m);
        const d = Engine.widgetData({ items, spentOf: id => (spend.byLine[String(id)] || {}).spent || 0, goals: Store.state.goals, today });
        const month = (k) => Fmt.monthYear(new Date(Number(k.slice(0, 4)), Number(k.slice(5, 7)) - 1, 1));
        const n = (v) => Number(v).toLocaleString(I18n.lang === 'en' ? 'en-US' : 'es-EC', { maximumFractionDigits: 1 });
        const updated = t(`Updated ${Fmt.dayMonth(today)}`);
        const b = d.budget;
        const budget = {
            title: b.over ? t('Over budget: hold off here') : b.near ? t('Almost used up') : t('Budget on track'),
            rows: b.items.map(x => ({ name: t(x.category), pct: `${x.pct}%`, level: x.over ? 'over' : 'near' })),
            empty: b.items.length ? '' : t('Every category is under 90% of its plan. Nice work!'),
            footer: updated
        };
        const g = d.goal;
        const goal = !g ? { title: t('Keep going!'), pct: 0, lines: [t('Add a savings goal to see your progress here.')], footer: updated } : {
            title: t('Keep going!'),
            pct: g.pct,
            lines: [
                g.by ? t(`You'll reach one of your goals by ${month(g.by)}.`) : t('Give your goal a monthly amount to see when you\'ll reach it.'),
                g.close ? t(`You're ${g.pct}% there. You're so close!`) : t(`You're ${g.pct}% there.`),
                g.need !== null ? (g.onTime ? t(`Saving ${n(g.pace)}% of it a month gets you there on time or sooner.`) : t(`Save ${n(g.need)}% of it a month to make it by ${month(g.date)}.`))
                    : g.pace > 0 ? t(`You're putting in ${n(g.pace)}% of it a month.`) : ''
            ].filter(Boolean),
            footer: updated
        };
        return { budget, goal };
    }
    async function widgets() {
        if (!Native.isApp || !Native.widgets.available()) return;
        if (!Device.widgetsOn() || !Store.state) { await Native.widgets.clear(); return; }
        await Native.widgets.update(widgetContent());
    }

    let timer = null;
    const later = () => { clearTimeout(timer); timer = setTimeout(() => { sync(); widgets(); }, 3000); };
    if (Native.isApp) document.addEventListener('DOMContentLoaded', () => Device.whenReady(() => setTimeout(() => { sync(); widgets(); if (Store.onChange) Store.onChange(later); }, 1500)));

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
        UI.show('cfg-widgets-row', Native.widgets.available());
        const wid = document.getElementById('cfg-widgets');
        if (wid) wid.checked = Device.widgetsOn();
        renderMine();
    }
    // Your own reminders: the words, every day or one day a week, the time.
    const WHEN = () => [['daily', t('Every day')]].concat(['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'].map((d, i) => ['w' + i, t('Every ' + d)]));
    function renderMine() {
        const host = document.getElementById('cfg-my-reminders');
        if (!host) return;
        UI.show('cfg-my-reminders', Native.notifications.available());
        const list = mine();
        host.innerHTML = `<span class="field-label">Your own reminders</span>
            <p class="help">A few words to keep you going ("The beach trip is in June!"). They show like any notification, also on a locked screen: write only what you're fine with others seeing.</p>
            <div class="space-y-2 mt-2">${list.map(r => {
                const when = r.freq === 'weekly' ? 'w' + (Number(r.day) || 0) : 'daily';
                return `<div class="flex flex-wrap gap-2 items-center" data-row="${r.id}">
                    <input class="input flex-1 min-w-0" style="min-width:12rem" maxlength="120" value="${Fmt.esc(r.text || '')}" placeholder="E.g. Every dollar saved is a step to the beach trip!" data-change="myrem.set" data-id="${r.id}" data-f="text" aria-label="Reminder">
                    <select class="input" style="width:auto" data-change="myrem.set" data-id="${r.id}" data-f="when" aria-label="How often">${WHEN().map(([v, l]) => `<option value="${v}" ${v === when ? 'selected' : ''}>${Fmt.esc(l)}</option>`).join('')}</select>
                    <input type="time" class="input" style="width:auto" value="${Fmt.esc(r.time || '20:00')}" data-change="myrem.set" data-id="${r.id}" data-f="time" aria-label="Time">
                    <button type="button" class="row-del" data-action="myrem.delete" data-id="${r.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button></div>`;
            }).join('')}</div>
            ${list.length < 10 ? '<button type="button" class="btn btn-secondary btn-sm mt-2" data-action="myrem.add"><i class="fa-solid fa-plus"></i> Add a reminder</button>' : ''}`;
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
        'device.widgets': async (el) => {
            Device.setWidgets(el.checked);
            await widgets();
            UI.toast(el.checked ? 'Widgets on: long-press the home screen → Widgets → this app.' : 'Widgets off: they show nothing now.');
        },
        'myrem.add': async () => {
            if (!await Native.notifications.allow()) { UI.toast('The phone didn\'t allow notifications: turn them on in its settings for this app.', 'error'); return; }
            const list = Store.state.settings.myReminders || (Store.state.settings.myReminders = []);
            list.push({ id: Store.nextId(list), text: '', freq: 'daily', day: 0, time: '20:00' });
            App.changed({ structural: true });
            const rows = document.querySelectorAll('#cfg-my-reminders [data-f="text"]');
            if (rows.length) rows[rows.length - 1].focus();
        },
        'myrem.set': (el) => {
            const r = mine().find(x => x.id === Number(el.dataset.id));
            if (!r) return;
            const f = el.dataset.f;
            if (f === 'text') r.text = String(el.value).trim().slice(0, 120);
            else if (f === 'time') r.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(el.value) ? el.value : '20:00';
            else if (f === 'when') { if (el.value === 'daily') r.freq = 'daily'; else { r.freq = 'weekly'; r.day = Math.min(6, Math.max(0, Number(el.value.slice(1)) || 0)); } }
            App.changed({ structural: true });
        },
        'myrem.delete': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Reminder removed', () => { Store.state.settings.myReminders = mine().filter(x => x.id !== id); });
        },
        // The camera instead of the file picker: the photo goes to that picker's own reader.
        'cam.photo': async (el) => {
            const input = document.getElementById(el.dataset.for);
            const file = await Native.takePhoto();
            if (!file || !input) return;
            UI.runWith(input.dataset.change, { files: [file], value: '', dataset: input.dataset });
        }
    });

    window.Phone = { sync, render, widgets, widgetContent };
})();
