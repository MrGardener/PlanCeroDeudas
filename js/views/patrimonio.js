/* Patrimonio: per-year net worth (balances carry forward) and the asset registry. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    const ASSET_FIELDS = [
        { field: 'checking', label: 'Cuentas corrientes', help: 'Saldo de hoy en tus cuentas corrientes.' },
        { field: 'savings', label: 'Cuentas de ahorro', help: 'También cuenta para tu fondo de emergencia.' },
        { field: 'investments', label: 'Inversiones y pólizas DPF', help: 'Usa "Traer pólizas y deudas" para llenarlo con tus pólizas.' },
        { registry: 'Bienes Raíces', label: 'Bienes raíces' },
        { registry: 'Vehículo', label: 'Vehículos' },
        { registry: 'Otro', label: 'Otros bienes de valor' }
    ];
    const LIABILITY_FIELDS = [
        { field: 'mortgage', label: 'Hipoteca', help: 'Lo que aún debes de tu casa.' },
        { field: 'creditCards', label: 'Tarjetas de crédito', help: 'Saldo total adeudado, no la cuota.' },
        { field: 'autoLoans', label: 'Préstamos vehiculares' },
        { field: 'personalLoans', label: 'Préstamos personales', help: 'Incluye préstamos de familiares o amigos.' },
        { field: 'studentLoans', label: 'Préstamos estudiantiles' },
        { field: 'otherDebts', label: 'Otras deudas', help: 'Gastos médicos, préstamos de negocio, etc.' }
    ];

    function fieldHTML(def, tone) {
        if (def.registry) {
            return `<div class="field-box tone-${tone} flex items-center justify-between gap-3">
                <div><span class="field-label mb-0">${def.label}</span><span class="linked block">🔗 Del <a href="#" class="link" data-goto="patrimonio" data-focus="asset-registry">registro de activos</a></span></div>
                <span class="font-extrabold text-slate-800" data-registry="${def.registry}"></span></div>`;
        }
        return `<label class="field-box tone-${tone} flex items-center justify-between gap-3">
            <div class="min-w-0"><span class="field-label mb-0">${def.label}</span><span class="help block" data-src="${def.field}">${def.help || ''}</span></div>
            <input type="number" class="input text-right" style="max-width:9rem" min="0" step="50" data-input="nw.set" data-field="${def.field}" aria-label="${def.label}"></label>`;
    }

    function assetRow(a, year) {
        const owned = Engine.assetOwned(a, year);
        const status = a.status === 'Vendido'
            ? `<div class="text-[11px] leading-relaxed">
                   <span class="badge badge-muted">Vendido en ${a.saleYear} por ${money0(a.saleValue)}</span>
                   <div class="mt-1 flex flex-col items-start gap-0.5">
                       ${a.proceedsAdded ? '<span class="text-emerald-700 font-bold">✓ Pasado a cuentas corrientes</span>' : `<button class="link" data-action="asset.proceeds" data-id="${a.id}">+ Pasar a cuentas corrientes</button>`}
                       <button class="text-slate-400 hover:text-red-600 underline" data-action="asset.unsell" data-id="${a.id}">Deshacer venta</button>
                   </div></div>`
            : `<button class="btn btn-secondary btn-sm" data-action="asset.sell" data-id="${a.id}">Marcar vendido</button>`;
        return `<tr data-row="${a.id}" class="${owned ? '' : 'opacity-50'}">
            <td><input class="cell-input" value="${esc(a.name)}" data-change="asset.set" data-id="${a.id}" data-field="name"></td>
            <td><select class="cell-input" data-change="asset.set" data-id="${a.id}" data-field="category">${Views.selectOptions(Engine.ASSET_CATEGORIES, a.category)}</select></td>
            <td><input type="number" class="cell-input num" value="${a.purchaseYear}" data-change="asset.set" data-id="${a.id}" data-field="purchaseYear"></td>
            <td><input type="number" class="cell-input num" min="0" value="${Number(a.purchaseValue) || 0}" data-change="asset.set" data-id="${a.id}" data-field="purchaseValue"></td>
            <td><input type="number" class="cell-input num money" min="0" value="${Engine.assetValue(a, year)}" ${owned ? '' : 'disabled title="No lo tienes en este año"'} data-input="asset.value" data-id="${a.id}"></td>
            <td>${status}</td>
            <td class="text-center"><button class="row-del" data-action="asset.delete" data-id="${a.id}" title="Eliminar activo"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function render(ctx) {
        UI.html('nw-asset-fields', ASSET_FIELDS.map(d => fieldHTML(d, 'emerald')).join(''));
        UI.html('nw-liability-fields', LIABILITY_FIELDS.map(d => fieldHTML(d, 'red')).join(''));
        const snap = ctx.netWorth.fields;
        UI.$$('[data-input="nw.set"]').forEach(el => { el.value = snap[el.dataset.field]; });
        const s = ctx.state;
        UI.html('asset-body', s.assets.length ? s.assets.map(a => assetRow(a, s.activeYear)).join('') : '<tr class="empty-row"><td colspan="7">Aún no registras activos (casa, carro, terreno…).</td></tr>');
        update(ctx);
    }

    function verdict(v) {
        if (v < 0) return ['text-red-700', 'Patrimonio negativo: debes más de lo que tienes. Eliminar deudas (Paso 2) es tu prioridad.'];
        if (v < 5000) return ['text-slate-700', 'Vas por buen camino. Sigue avanzando paso a paso.'];
        if (v < 50000) return ['text-emerald-700', 'Buen progreso: tu patrimonio crece de forma sólida.'];
        return ['text-emerald-800', 'Excelente: estás construyendo riqueza real.'];
    }

    function update(ctx) {
        const s = ctx.state, nw = ctx.netWorth, year = s.activeYear;
        UI.$$('[data-registry]').forEach(el => { el.textContent = money(nw.registry[el.dataset.registry] || 0); });
        UI.$$('[data-src]').forEach(el => {
            const f = el.dataset.src;
            const src = Engine.netWorthSource(s.years, year, f);
            const def = ASSET_FIELDS.concat(LIABILITY_FIELDS).find(d => d.field === f);
            el.innerHTML = src !== null && src < year ? `<span class="text-slate-500">↩ Heredado de ${src}. Edítalo si cambió.</span>` : esc(def.help || '');
        });
        const sync = Views.netWorthSync(ctx);
        UI.show('nw-sync-hint', !!sync);
        if (sync) UI.html('nw-sync-hint', `<span><i class="fa-solid fa-circle-info"></i> Tus <a href="#" class="link" data-goto="ahorro/polizas">pólizas</a> suman <strong>${money0(sync.polizas)}</strong> y tus <a href="#" class="link" data-goto="metas" data-focus="metas-debts">deudas</a> <strong>${money0(sync.debts)}</strong>, pero tu patrimonio de ${year} no coincide.</span><button class="btn btn-blue btn-sm" data-action="nw.prefill">Actualizar ahora</button>`);
        UI.text('nw-assets', money0(nw.assets));
        UI.text('nw-liabilities', money0(nw.liabilities));
        UI.text('nw-value', money(nw.value));
        const [cls, text] = verdict(nw.value);
        document.getElementById('nw-value').className = `text-4xl font-black block my-1 ${nw.value >= 0 ? 'text-emerald-700' : 'text-red-600'}`;
        const v = document.getElementById('nw-verdict');
        v.className = `text-sm font-bold ${cls}`;
        v.textContent = text;
        document.getElementById('nw-result').className = `mt-5 rounded-xl p-5 text-center border-t-4 bg-slate-50 ${nw.value >= 0 ? 'border-emerald-500' : 'border-red-500'}`;

        const years = [];
        for (let y = s.configStartYear; y <= s.configEndYear; y++) years.push(y);
        UI.chart('nw-chart', {
            type: 'line',
            data: { labels: years, datasets: [{ label: 'Patrimonio neto', data: years.map(y => Engine.netWorth(s.years, s.assets, y).value), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.1)', fill: true, tension: .25, pointRadius: years.map(y => y === year ? 5 : 0) }] },
            options: { scales: { y: { beginAtZero: false } } }
        });
    }

    const find = (el) => Store.state.assets.find(a => a.id === Number(el.dataset.id));

    function touch(yd, field, value) {
        yd.netWorth[field] = value;
        yd.netWorthTouched[field] = true;
    }

    UI.register({
        'nw.set': (el) => {
            touch(Store.active(), el.dataset.field, Math.max(0, parseNum(el.value, 0)));
            App.changed();
        },
        'nw.prefill': () => {
            const s = Store.state, yd = Store.active();
            const capital = Engine.polizasCapital(s.polizas);
            touch(yd, 'investments', capital);
            const byKind = {};
            Engine.DEBT_KINDS.forEach(k => { byKind[k.netWorthField] = 0; });
            s.debts.forEach(d => {
                const k = Engine.DEBT_KINDS.find(x => x.id === d.kind) || Engine.DEBT_KINDS[4];
                byKind[k.netWorthField] += Math.max(0, Number(d.balance) || 0);
            });
            Object.keys(byKind).forEach(f => touch(yd, f, byKind[f]));
            App.changed({ structural: true });
            UI.toast(`Actualizado ${s.activeYear}: inversiones ${money0(capital)} y ${s.debts.length} deuda(s) por tipo.`);
        },
        'asset.set': (el) => {
            const a = find(el);
            if (!a) return;
            const f = el.dataset.field;
            if (f === 'purchaseYear') a.purchaseYear = Math.round(parseNum(el.value, Store.state.activeYear));
            else if (f === 'purchaseValue') a.purchaseValue = Math.max(0, parseNum(el.value, 0));
            else a[f] = el.value;
            App.changed({ structural: true });
        },
        'asset.value': (el) => {
            const a = find(el);
            if (!a) return;
            a.valuesByYear[Store.state.activeYear] = Math.max(0, parseNum(el.value, 0));
            App.changed();
        },
        'asset.add': () => {
            const s = Store.state;
            const id = Store.nextId(s.assets);
            s.assets.push({ id, name: 'Nuevo activo', category: 'Otro', purchaseYear: s.activeYear, purchaseValue: 0, status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false, valuesByYear: {} });
            App.changed({ structural: true });
            const input = document.querySelector(`#asset-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'asset.delete': (el) => {
            const a = find(el);
            App.undoable(`Activo "${a.name}" eliminado`, () => { Store.state.assets = Store.state.assets.filter(x => x !== a); });
        },
        'asset.sell': async (el) => {
            const a = find(el);
            const year = Store.state.activeYear;
            const r = await UI.form({
                title: `Vender "${a.name}"`,
                message: 'Desde el año de venta este activo deja de sumar a tu patrimonio.',
                fields: [
                    { name: 'value', label: 'Precio de venta ($)', type: 'number', min: 0, value: Engine.assetValue(a, year) },
                    { name: 'year', label: 'Año de la venta', type: 'number', value: year }
                ],
                confirmText: 'Marcar como vendido',
                validate: v => v.value === null || v.value < 0 ? 'Ingresa el precio de venta.' : !v.year || v.year < a.purchaseYear ? `El año debe ser ${a.purchaseYear} o posterior.` : null
            });
            if (!r) return;
            Object.assign(a, { status: 'Vendido', saleValue: r.value, saleYear: Math.round(r.year), proceedsAdded: false });
            App.changed({ structural: true });
        },
        'asset.unsell': async (el) => {
            const a = find(el);
            const ok = await UI.confirm({ title: 'Deshacer la venta', message: `"${a.name}" volverá a estar activo.${a.proceedsAdded ? ' El monto ya pasado a cuentas corrientes no se revierte automáticamente.' : ''}`, confirmText: 'Deshacer venta' });
            if (!ok) return;
            Object.assign(a, { status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false });
            App.changed({ structural: true });
        },
        'asset.proceeds': (el) => {
            const a = find(el);
            if (!a || a.status !== 'Vendido' || a.proceedsAdded) return;
            // Add on top of the balance that carries into the sale year, not the raw stored value.
            const current = Engine.netWorthField(Store.state.years, a.saleYear, 'checking');
            touch(Store.year(a.saleYear), 'checking', current + Number(a.saleValue || 0));
            a.proceedsAdded = true;
            App.changed({ structural: true });
            UI.toast(`${money0(a.saleValue)} pasados a cuentas corrientes de ${a.saleYear}`);
        }
    });

    App.defineView('patrimonio', { render, update });
})();
