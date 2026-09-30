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
        UI.html('cfg-brackets', yd.sriBrackets.map((b, i) => `<tr>
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
            <td class="font-bold text-slate-800">${esc(b.name)}${b.legacy ? ' <span class="badge badge-muted" title="Creado con la versión anterior: guarda años, pólizas y cooperativas">parcial</span>' : ''}</td>
            <td class="text-slate-500">${esc(b.timestamp)}</td>
            <td class="text-center whitespace-nowrap">
                <button class="btn btn-primary btn-sm" data-action="cfg.restoreBaseline" data-id="${b.id}"><i class="fa-solid fa-rotate-left"></i> Restaurar</button>
                <button class="row-del" data-action="cfg.deleteBaseline" data-id="${b.id}" title="Eliminar"><i class="fa-solid fa-trash-can"></i></button>
            </td></tr>`).join('') : '<tr class="empty-row"><td colspan="3">Aún no hay baselines.</td></tr>');
    }

    // Theme and PIN belong to this device (js/device.js), outside the saved budget.
    function renderDevice() {
        const sel = document.getElementById('cfg-theme');
        if (sel) sel.value = Device.read().theme || 'light';
        UI.html('cfg-lock', Device.hasPin()
            ? `<span class="badge badge-ok"><i class="fa-solid fa-lock"></i> Activado</span>
               <button class="btn btn-secondary btn-sm" data-action="device.lockNow"><i class="fa-solid fa-lock"></i> Bloquear ahora</button>
               <button class="btn btn-secondary btn-sm" data-action="device.setPin">Cambiar PIN</button>
               <button class="btn btn-ghost btn-sm" data-action="device.removePin">Quitar</button>`
            : `<span class="badge badge-muted">Desactivado</span>
               <button class="btn btn-secondary btn-sm" data-action="device.setPin"><i class="fa-solid fa-lock"></i> Activar PIN</button>`);
    }

    async function askPin(title) {
        const r = await UI.form({
            title, confirmText: 'Guardar PIN',
            fields: [{ name: 'pin', label: 'PIN (4 a 8 números)', type: 'password', inputmode: 'numeric' }, { name: 'again', label: 'Repite el PIN', type: 'password', inputmode: 'numeric' }],
            validate: v => !/^\d{4,8}$/.test(v.pin) ? 'Usa de 4 a 8 números.' : (v.pin !== v.again ? 'Los dos PIN no coinciden.' : null)
        });
        return r ? r.pin : null;
    }

    // Household members: fixed colors in the order they're added (color follows the person).
    const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];
    function renderMembers() {
        const list = Store.state.members || [];
        UI.html('cfg-members', list.length ? list.map(p => `<span class="member-chip"><span class="member-dot" style="background:${esc(p.color)}">${esc((p.name || '?').charAt(0).toUpperCase())}</span>
            <button type="button" class="link text-xs" data-action="member.rename" data-id="${p.id}" title="Cambiar nombre">${esc(p.name)}</button>
            <button type="button" class="row-del" data-action="member.delete" data-id="${p.id}" title="Quitar" aria-label="Quitar ${esc(p.name)}"><i class="fa-solid fa-xmark"></i></button></span>`).join('')
            : '<span class="help">Solo tú por ahora.</span>');
    }

    UI.register({
        'device.theme': (el) => Device.setTheme(el.value),
        'device.toggleTheme': () => Device.setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'),
        'device.setPin': async () => {
            if (Device.hasPin()) {
                const cur = await UI.form({ title: 'Cambiar PIN', confirmText: 'Continuar', fields: [{ name: 'pin', label: 'Tu PIN actual', type: 'password', inputmode: 'numeric' }] });
                if (!cur) return;
                const lock = Device.read().lock;
                if (await Device.hashPin(cur.pin, lock.salt) !== lock.hash) { UI.toast('Ese no es tu PIN actual.', 'error'); return; }
            }
            const pin = await askPin(Device.hasPin() ? 'Nuevo PIN' : 'Activar bloqueo con PIN');
            if (!pin) return;
            if (!await Device.setPin(pin)) { UI.toast('No se pudo guardar el PIN en este navegador.', 'error'); return; }
            renderDevice();
            UI.toast('PIN guardado. La app lo pedirá al abrirla. Si lo olvidas, tendrás que borrar los datos y cargar tu copia de respaldo.');
        },
        'device.removePin': async () => {
            const cur = await UI.form({ title: 'Quitar el PIN', confirmText: 'Quitar', fields: [{ name: 'pin', label: 'Tu PIN actual', type: 'password', inputmode: 'numeric' }] });
            if (!cur) return;
            const lock = Device.read().lock;
            if (await Device.hashPin(cur.pin, lock.salt) !== lock.hash) { UI.toast('Ese no es tu PIN.', 'error'); return; }
            Device.removePin();
            renderDevice();
            UI.toast('Bloqueo con PIN desactivado.');
        },
        'device.lockNow': () => Device.lockNow(),
        'member.add': async () => {
            const r = await UI.form({ title: 'Agregar persona', fields: [{ name: 'name', label: 'Nombre', placeholder: 'Ej: Ana' }], confirmText: 'Agregar', validate: v => v.name.trim() ? null : 'Escribe un nombre.' });
            if (!r) return;
            const list = Store.state.members || (Store.state.members = []);
            const used = new Set(list.map(p => p.color));
            list.push({ id: Store.nextId(list), name: r.name.trim().slice(0, 30), color: MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[list.length % MEMBER_COLORS.length] });
            App.changed({ structural: true, step: true });
        },
        'member.rename': async (el) => {
            const p = (Store.state.members || []).find(x => x.id === Number(el.dataset.id));
            if (!p) return;
            const r = await UI.form({ title: 'Cambiar nombre', fields: [{ name: 'name', label: 'Nombre', value: p.name }], confirmText: 'Guardar', validate: v => v.name.trim() ? null : 'Escribe un nombre.' });
            if (!r) return;
            p.name = r.name.trim().slice(0, 30);
            App.changed({ structural: true, step: true });
        },
        'member.delete': (el) => {
            const id = Number(el.dataset.id);
            const p = (Store.state.members || []).find(x => x.id === id);
            if (!p) return;
            // Their transactions stay; they just no longer say who.
            App.undoable(`${p.name} ya no está en tu hogar`, () => {
                Store.state.members = Store.state.members.filter(x => x.id !== id);
                Store.state.transactions.forEach(t => { if (t.memberId === id) delete t.memberId; });
            });
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
            const blob = new Blob([JSON.stringify(data, null, 1)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `plan_financiero_ecuador_${new Date().toISOString().slice(0, 10)}.json`;
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            Store.state.settings.lastBackupAt = new Date().toISOString();
            Store.scheduleSave();
            App.commitHistory();  // a record, not something to undo
            UI.toast('Copia de respaldo descargada. Guárdala en un lugar seguro (por ejemplo Google Drive o un USB).');
        },
        'cfg.upload': () => document.getElementById('cfg-file').click(),
        'cfg.fileChosen': (el) => {
            const file = el.files[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = async (e) => {
                el.value = '';
                let data;
                try { data = JSON.parse(e.target.result); } catch (err) { UI.toast('Ese archivo no es una copia de respaldo válida (.json).', 'error'); return; }
                if (!data || typeof data !== 'object' || !(data.years || data.multiYearStore)) { UI.toast('Ese archivo no parece una copia de esta app.', 'error'); return; }
                const ok = await UI.confirm({ title: 'Cargar copia de respaldo', message: 'Tus datos actuales se reemplazarán por los de la copia. Si quieres conservarlos, descarga primero una copia o crea un baseline.', confirmText: 'Reemplazar mis datos', danger: true });
                if (!ok) return;
                App.commitHistory();
                Store.replaceState(data);
                App.changed({ step: true });
                App.go('resumen');
                UI.toast('Copia de respaldo cargada', 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
            };
            reader.readAsText(file);
        },
        'cfg.copyYear': async () => {
            const from = Number(document.getElementById('cfg-copy-from').value);
            const to = Store.state.activeYear;
            const ok = await UI.confirm({ title: `Copiar ${from} → ${to}`, message: `El presupuesto y los parámetros de ${to} se reemplazarán por los de ${from}. Tu patrimonio neto de ${to} no cambia.`, confirmText: 'Copiar', danger: true });
            if (!ok) return;
            App.undoable(`Presupuesto de ${from} copiado a ${to}`, () => Store.copyYear(from, to));
        },
        'cfg.propagate': async () => {
            const s = Store.state, from = s.activeYear;
            if (from >= s.configEndYear) { UI.toast('No hay años posteriores en tu rango.', 'warn'); return; }
            const ok = await UI.confirm({ title: `Propagar ${from} → ${from + 1}–${s.configEndYear}`, message: `El presupuesto y los parámetros de todos los años posteriores se reemplazarán por los de ${from}. El patrimonio neto de cada año no cambia.`, confirmText: 'Propagar', danger: true });
            if (!ok) return;
            App.undoable(`Presupuesto de ${from} propagado hasta ${s.configEndYear}`, () => { for (let y = from + 1; y <= s.configEndYear; y++) Store.copyYear(from, y); });
        },
        'cfg.baseline': async () => {
            const r = await UI.form({ title: 'Crear baseline', message: 'Guarda una foto completa de tu modelo actual.', fields: [{ name: 'name', label: 'Nombre', value: 'Baseline ' + new Date().toLocaleDateString('es-EC') }], confirmText: 'Crear', validate: v => v.name.trim() ? null : 'Escribe un nombre.' });
            if (!r) return;
            Store.createBaseline(r.name.trim());
            App.changed({ structural: true });
            UI.toast('Baseline creado');
        },
        'cfg.restoreBaseline': async (el) => {
            const b = Store.state.baselines.find(x => x.id === Number(el.dataset.id));
            const ok = await UI.confirm({ title: `Restaurar "${b.name}"`, message: b.legacy ? 'Se restaurarán los años, pólizas y cooperativas guardados en este baseline (creado con la versión anterior).' : 'Todo tu modelo volverá a como estaba en este baseline.', confirmText: 'Restaurar', danger: true });
            if (!ok) return;
            App.undoable(`Baseline "${b.name}" restaurado`, () => Store.restoreBaseline(b.id));
        },
        'cfg.deleteBaseline': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Baseline eliminado', () => { Store.state.baselines = Store.state.baselines.filter(b => b.id !== id); });
        },
        'cfg.range': () => {
            const s = Store.state;
            const start = Math.round(parseNum(document.getElementById('cfg-start').value, s.configStartYear));
            const end = Math.round(parseNum(document.getElementById('cfg-end').value, s.configEndYear));
            if (start >= end) { UI.toast('El año inicial debe ser menor que el final.', 'error'); App.render(); return; }
            if (end - start > 80) { UI.toast('Usa un rango de máximo 80 años.', 'error'); App.render(); return; }
            s.configStartYear = start;
            s.configEndYear = end;
            s.activeYear = Math.min(end, Math.max(start, s.activeYear));
            Store.year(s.activeYear);
            App.changed({ structural: true });
        },
        'cfg.purge': async () => {
            const r = await UI.form({
                title: 'Borrar todos mis datos',
                message: 'Se eliminarán presupuestos, pólizas, deudas, metas, activos, transacciones y baselines de este navegador. No se puede deshacer.',
                fields: [{ name: 'word', label: 'Escribe ELIMINAR para confirmar', placeholder: 'ELIMINAR' }],
                confirmText: 'Borrar todo',
                danger: true,
                validate: v => v.word.trim() === 'ELIMINAR' ? null : 'Escribe exactamente ELIMINAR.'
            });
            if (!r) return;
            App.commitHistory();
            Store.reset('empty');
            Store.ui.month = 'base';
            App.changed({ step: true });
            App.go('resumen');
            UI.toast('Todos tus datos fueron borrados', 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    });

    App.defineView('config', { render });
})();
