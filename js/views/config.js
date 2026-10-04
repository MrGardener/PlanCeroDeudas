/* Configuración: legal parameters, backups, year copy, baselines, preferences, reset. */
(function () {
    'use strict';
    const { esc, parseNum } = Fmt;

    function render(ctx) {
        const s = ctx.state, yd = ctx.year;
        UI.html('cfg-guide-body', Views.guideHTML());
        renderMembers();
        renderDevice();
        const curSel = document.getElementById('cfg-currency');
        if (!curSel.options.length) curSel.innerHTML = Views.selectOptions(Fmt.CURRENCIES.map(c => ({ value: c.code, label: c.label })), s.settings.currency || 'USD');
        curSel.value = s.settings.currency || 'USD';
        if (yd.usTax) {
            const status = Store.ui.usBracketStatus || yd.filingStatus || 'single';
            const sel = document.getElementById('cfg-us-status');
            if (sel) sel.value = status;
            UI.html('cfg-us-brackets', ((yd.usTax.brackets || {})[status] || []).map(([from, rate], i) => `<tr>
                <td><input type="number" class="cell-input num" value="${from}" min="0" data-change="us.bracket" data-status="${status}" data-idx="${i}" data-field="0" aria-label="From"></td>
                <td><input type="number" class="cell-input num" step="0.1" value="${+(rate * 100).toFixed(2)}" min="0" data-change="us.bracket" data-status="${status}" data-idx="${i}" data-field="1" aria-label="Rate (%)"></td></tr>`).join(''));
        }
        UI.html('cfg-brackets', (yd.sriBrackets || []).map((b, i) => `<tr>
            <td><input type="number" class="cell-input num" value="${b.min}" data-change="cfg.bracket" data-idx="${i}" data-field="min"></td>
            <td><input type="number" class="cell-input num" value="${b.max}" data-change="cfg.bracket" data-idx="${i}" data-field="max"></td>
            <td><input type="number" class="cell-input num" value="${b.baseTax}" data-change="cfg.bracket" data-idx="${i}" data-field="baseTax"></td>
            <td><input type="number" class="cell-input num" step="0.1" value="${+(b.rate * 100).toFixed(2)}" data-change="cfg.bracket" data-idx="${i}" data-field="rate"></td>
        </tr>`).join(''));

        const years = [];
        for (let y = s.configStartYear; y <= s.configEndYear; y++) if (y !== s.activeYear) years.push(y);
        const from = document.getElementById('cfg-copy-from');
        const prev = Number(from.value);
        from.innerHTML = Views.selectOptions(years, years.includes(prev) ? prev : (years.includes(s.activeYear - 1) ? s.activeYear - 1 : years[0]));

        document.getElementById('cfg-start').value = s.configStartYear;
        document.getElementById('cfg-end').value = s.configEndYear;

        UI.html('cfg-baselines', s.baselines.length ? s.baselines.map(b => `<tr>
            <td class="font-bold text-slate-800">${esc(b.name)}${b.legacy ? ' <span class="badge badge-muted" title="Created with the previous version: stores years, CDs and banks">parcial</span>' : ''}</td>
            <td class="text-slate-500">${esc(b.timestamp)}</td>
            <td class="text-center whitespace-nowrap">
                <button class="btn btn-primary btn-sm" data-action="cfg.restoreBaseline" data-id="${b.id}"><i class="fa-solid fa-rotate-left"></i> Restore</button>
                <button class="row-del" data-action="cfg.deleteBaseline" data-id="${b.id}" title="Delete"><i class="fa-solid fa-trash-can"></i></button>
            </td></tr>`).join('') : '<tr class="empty-row"><td colspan="3">No baselines yet.</td></tr>');
    }

    // Theme and PIN belong to this device (js/device.js), outside the saved budget.
    function renderDevice() {
        const lang = document.getElementById('cfg-lang');
        if (lang) lang.value = Device.getLang();
        const link = document.getElementById('cfg-quick-link');
        if (link) link.value = location.href.split('#')[0] + '#rapido';
        const sel = document.getElementById('cfg-theme');
        if (sel) sel.value = Device.read().theme || 'light';
        UI.html('cfg-lock', Device.hasPin()
            ? `<span class="badge badge-ok"><i class="fa-solid fa-lock"></i> On</span>
               <button class="btn btn-secondary btn-sm" data-action="device.lockNow"><i class="fa-solid fa-lock"></i> Lock now</button>
               <button class="btn btn-secondary btn-sm" data-action="device.setPin">Change PIN</button>
               <button class="btn btn-ghost btn-sm" data-action="device.removePin">Remove</button>`
            : `<span class="badge badge-muted">Off</span>
               <button class="btn btn-secondary btn-sm" data-action="device.setPin"><i class="fa-solid fa-lock"></i> Turn on PIN</button>`);
    }

    async function askPin(title) {
        const r = await UI.form({
            title, confirmText: 'Save PIN',
            fields: [{ name: 'pin', label: 'PIN (4 to 8 digits)', type: 'password', inputmode: 'numeric' }, { name: 'again', label: 'Repeat the PIN', type: 'password', inputmode: 'numeric' }],
            validate: v => !/^\d{4,8}$/.test(v.pin) ? 'Use 4 to 8 digits.' : (v.pin !== v.again ? 'The two PINs don\'t match.' : null)
        });
        return r ? r.pin : null;
    }

    // Household members: fixed colors in the order they're added (color follows the person).
    const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
    function renderMembers() {
        const list = Store.state.members || [];
        UI.html('cfg-members', list.length ? list.map(p => `<span class="member-chip"><span class="member-dot" style="background:${esc(p.color)}">${esc((p.name || '?').charAt(0).toUpperCase())}</span>
            <button type="button" class="link text-xs" data-action="member.rename" data-id="${p.id}" title="Rename">${esc(p.name)}</button>
            <button type="button" class="row-del" data-action="member.delete" data-id="${p.id}" title="Remove" aria-label="Remove ${esc(p.name)}"><i class="fa-solid fa-xmark"></i></button></span>`).join('')
            : '<span class="help">Just you for now.</span>');
    }

    UI.register({
        'device.theme': (el) => Device.setTheme(el.value),
        'device.lang': (el) => Device.setLang(el.value),
        'device.toggleLang': () => Device.setLang(Device.getLang() === 'en' ? 'es' : 'en'),
        'device.toggleTheme': () => Device.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
        'device.setPin': async () => {
            if (Device.hasPin()) {
                const cur = await UI.form({ title: 'Change PIN', confirmText: 'Continue', fields: [{ name: 'pin', label: 'Your current PIN', type: 'password', inputmode: 'numeric' }] });
                if (!cur) return;
                const lock = Device.read().lock;
                if (await Device.hashPin(cur.pin, lock.salt) !== lock.hash) { UI.toast('That\'s not your current PIN.', 'error'); return; }
            }
            const pin = await askPin(Device.hasPin() ? 'New PIN' : 'Turn on PIN lock');
            if (!pin) return;
            if (!await Device.setPin(pin)) { UI.toast('Couldn\'t save the PIN in this browser.', 'error'); return; }
            renderDevice();
            UI.toast('PIN saved. The app will ask for it when it opens. If you forget it, you\'ll have to erase the data and load your backup.');
        },
        'device.removePin': async () => {
            const cur = await UI.form({ title: 'Remove the PIN', confirmText: 'Remove', fields: [{ name: 'pin', label: 'Your current PIN', type: 'password', inputmode: 'numeric' }] });
            if (!cur) return;
            const lock = Device.read().lock;
            if (await Device.hashPin(cur.pin, lock.salt) !== lock.hash) { UI.toast('That\'s not your PIN.', 'error'); return; }
            Device.removePin();
            renderDevice();
            UI.toast('PIN lock turned off.');
        },
        'device.lockNow': () => Device.lockNow(),
        'device.copyQuick': async () => {
            const el = document.getElementById('cfg-quick-link');
            try { await navigator.clipboard.writeText(el.value); UI.toast('Link copied.'); }
            catch (e) { el.select(); UI.toast('Select it and copy it (Ctrl+C).', 'warn'); }
        },
        'member.add': async () => {
            const r = await UI.form({ title: 'Add person', fields: [{ name: 'name', label: 'Name', placeholder: 'E.g. Ana' }], confirmText: 'Add', validate: v => v.name.trim() ? null : 'Type a name.' });
            if (!r) return;
            const list = Store.state.members || (Store.state.members = []);
            const used = new Set(list.map(p => p.color));
            list.push({ id: Store.nextId(list), name: r.name.trim().slice(0, 30), color: MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[list.length % MEMBER_COLORS.length] });
            App.changed({ structural: true, step: true });
        },
        'member.rename': async (el) => {
            const p = (Store.state.members || []).find(x => x.id === Number(el.dataset.id));
            if (!p) return;
            const r = await UI.form({ title: 'Rename', fields: [{ name: 'name', label: 'Name', value: p.name }], confirmText: 'Save', validate: v => v.name.trim() ? null : 'Type a name.' });
            if (!r) return;
            p.name = r.name.trim().slice(0, 30);
            App.changed({ structural: true, step: true });
        },
        'member.delete': (el) => {
            const id = Number(el.dataset.id);
            const p = (Store.state.members || []).find(x => x.id === id);
            if (!p) return;
            // Their transactions stay; they just no longer say who.
            App.undoable(`${p.name} is no longer in your household`, () => {
                Store.state.members = Store.state.members.filter(x => x.id !== id);
                Store.state.transactions.forEach(t => { if (t.memberId === id) delete t.memberId; });
            });
        },
        'us.bracketStatus': (el) => { Store.ui.usBracketStatus = el.value; App.render(); },
        'us.bracket': (el) => {
            const b = Store.active().usTax.brackets[el.dataset.status][Number(el.dataset.idx)];
            const v = Math.max(0, parseNum(el.value, 0));
            b[Number(el.dataset.field)] = el.dataset.field === '1' ? v / 100 : v;
            App.changed({ step: true });
        },
        'cfg.bracket': (el) => {
            const b = Store.active().sriBrackets[Number(el.dataset.idx)];
            const v = parseNum(el.value, 0);
            b[el.dataset.field] = el.dataset.field === 'rate' ? v / 100 : v;
            App.changed();
        },
        'cfg.download': () => {
            // The price API key is a credential: it stays in this browser, not in the file.
            const data = JSON.parse(Store.serialize());
            if (data.settings) delete data.settings.priceKey;
            const prefix = APP_EDITION.country === 'US' ? 'zerodebtplan' : 'plan_financiero_ecuador';
            const name = `${prefix}_${new Date().toISOString().slice(0, 10)}.json`;
            Native.saveFile(name, JSON.stringify(data, null, 1), 'application/json').then(how => {
                Store.state.settings.lastBackupAt = new Date().toISOString();
                Store.scheduleSave();
                App.commitHistory();  // a record, not something to undo
                UI.toast(how === 'share'
                    ? 'Backup ready. Choose where to keep it (for example Google Drive).'
                    : 'Backup downloaded. Keep it somewhere safe (for example Google Drive or a USB drive).');
            }).catch(e => UI.toast('Couldn\'t save the file: ' + (e.message || e), 'error'));
        },
        'cfg.upload': () => document.getElementById('cfg-file').click(),
        'cfg.fileChosen': (el) => {
            const file = el.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                el.value = '';
                let data;
                try { data = JSON.parse(e.target.result); } catch (err) { UI.toast('That file isn\'t a valid backup (.json).', 'error'); return; }
                if (!data || typeof data !== 'object' || !(data.years || data.multiYearStore)) { UI.toast('That file doesn\'t look like a backup from this app.', 'error'); return; }
                const ok = await UI.confirm({ title: 'Load backup', message: 'Your current data will be replaced with the backup\'s. To keep it, download a backup or create a baseline first.', confirmText: 'Replace my data', danger: true });
                if (!ok) return;
                App.commitHistory();
                Store.replaceState(data);
                App.changed({ step: true });
                App.go('resumen');
                UI.toast('Backup loaded', 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
            };
            reader.readAsText(file);
        },
        'cfg.copyYear': async () => {
            const from = Number(document.getElementById('cfg-copy-from').value);
            const to = Store.state.activeYear;
            const ok = await UI.confirm({ title: `Copiar ${from} → ${to}`, message: `${to}'s budget and parameters will be replaced with ${from}'s. Your ${to} net worth doesn't change.`, confirmText: 'Copy', danger: true });
            if (!ok) return;
            App.undoable(`${from} budget copied to ${to}`, () => Store.copyYear(from, to));
        },
        'cfg.propagate': async () => {
            const s = Store.state, from = s.activeYear;
            if (from >= s.configEndYear) { UI.toast('There are no later years in your range.', 'warn'); return; }
            const ok = await UI.confirm({ title: `Propagar ${from} → ${from + 1}–${s.configEndYear}`, message: `The budget and parameters of every later year will be replaced with ${from}'s. Each year's net worth doesn't change.`, confirmText: 'Carry forward', danger: true });
            if (!ok) return;
            App.undoable(`${from} budget carried through ${s.configEndYear}`, () => { for (let y = from + 1; y <= s.configEndYear; y++) Store.copyYear(from, y); });
        },
        'cfg.baseline': async () => {
            const r = await UI.form({ title: 'Create baseline', message: 'Save a full snapshot of your current plan.', fields: [{ name: 'name', label: 'Name', value: 'Baseline ' + new Date().toLocaleDateString('es-EC') }], confirmText: 'Create', validate: v => v.name.trim() ? null : 'Type a name.' });
            if (!r) return;
            Store.createBaseline(r.name.trim());
            App.changed({ structural: true });
            UI.toast('Baseline created');
        },
        'cfg.restoreBaseline': async (el) => {
            const b = Store.state.baselines.find(x => x.id === Number(el.dataset.id));
            const ok = await UI.confirm({ title: `Restaurar "${b.name}"`, message: b.legacy ? 'The years, CDs and banks saved in this baseline (made with the previous version) will be restored.' : 'Your whole plan will go back to how it was in this baseline.', confirmText: 'Restore', danger: true });
            if (!ok) return;
            App.undoable(`Baseline "${b.name}" restaurado`, () => Store.restoreBaseline(b.id));
        },
        'cfg.deleteBaseline': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Baseline deleted', () => { Store.state.baselines = Store.state.baselines.filter(b => b.id !== id); });
        },
        'cfg.range': () => {
            const s = Store.state;
            const start = Math.round(parseNum(document.getElementById('cfg-start').value, s.configStartYear));
            const end = Math.round(parseNum(document.getElementById('cfg-end').value, s.configEndYear));
            if (start >= end) { UI.toast('The start year must be before the end year.', 'error'); App.render(); return; }
            if (end - start > 80) { UI.toast('Use a range of 80 years at most.', 'error'); App.render(); return; }
            s.configStartYear = start;
            s.configEndYear = end;
            s.activeYear = Math.min(end, Math.max(start, s.activeYear));
            Store.year(s.activeYear);
            App.changed({ structural: true });
        },
        'cfg.purge': async () => {
            // The word to type is shown in the app's language (ELIMINAR / DELETE): either one is
            // accepted, in any mix of upper and lower case.
            const words = ['ELIMINAR', window.I18n ? I18n.t('ELIMINAR') : 'ELIMINAR'].map(w => w.toUpperCase());
            const r = await UI.form({
                title: 'Erase all my data',
                message: 'Budgets, CDs, debts, goals, assets, transactions and baselines will be erased from this browser. This can\'t be undone.',
                fields: [{ name: 'word', label: 'Type DELETE to confirm', placeholder: 'ELIMINAR' }],
                confirmText: 'Erase everything',
                danger: true,
                validate: v => words.includes(String(v.word || '').trim().toUpperCase()) ? null : 'Type exactly DELETE.'
            });
            if (!r) return;
            App.commitHistory();
            Store.reset('empty');
            Store.ui.month = 'base';
            App.changed({ step: true });
            App.go('resumen');
            // Check that nothing is left before saying so.
            const s = Store.state;
            const left = ['transactions', 'debts', 'goals', 'polizas', 'assets', 'accounts', 'holdings', 'recurring', 'trash', 'annualBills'].filter(k => (s[k] || []).length);
            if (left.length) {
                await UI.form({ title: 'Couldn\'t erase everything', message: 'Some data is still saved. Close and reopen the app, then try again.', confirmText: 'Got it', cancelText: null, danger: true });
                return;
            }
            await UI.form({
                title: 'Your data has been erased',
                message: 'Your budget, transactions, debts, goals, CDs, accounts, investments and assets were erased from this device. Your language, theme and PIN stay. If it was a mistake, tap Undo at the top before closing the app.',
                confirmText: 'Got it', cancelText: null, icon: 'fa-circle-check'
            });
        }
    });

    App.defineView('config', { render });
})();
