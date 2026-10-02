/* Patrimonio: per-year net worth (balances carry forward) and the asset registry. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    const ASSET_FIELDS = [
        { field: 'checking', label: 'Cuentas corrientes', help: 'Saldo de hoy en tus cuentas corrientes.' },
        { field: 'savings', label: 'Cuentas de ahorro', help: 'También cuenta para tu fondo de emergencia.' },
        { field: 'investments', label: 'Inversiones y pólizas DPF', help: 'Usa "Traer pólizas, inversiones y deudas" para llenarlo con tus pólizas y acciones/ETF.' },
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
        renderHoldings(ctx);
        renderAccounts(ctx);
        UI.html('nw-asset-fields', ASSET_FIELDS.map(d => fieldHTML(d, 'emerald')).join(''));
        UI.html('nw-liability-fields', LIABILITY_FIELDS.map(d => fieldHTML(d, 'red')).join(''));
        const snap = ctx.netWorth.fields;
        UI.$$('[data-input="nw.set"]').forEach(el => { el.value = snap[el.dataset.field]; });
        const s = ctx.state;
        UI.html('asset-body', s.assets.length ? s.assets.map(a => assetRow(a, s.activeYear)).join('') : '<tr class="empty-row"><td colspan="7">Aún no registras activos (casa, carro, terreno…).</td></tr>');
        update(ctx);
    }

    // About the level only; whether it grows is said only when there's a previous year to compare.
    function verdict(v) {
        if (v < 0) return ['text-red-700', 'Patrimonio negativo: debes más de lo que tienes. Eliminar deudas (Paso 2) es tu prioridad.'];
        if (v < 5000) return ['text-slate-700', 'Vas por buen camino. Sigue avanzando paso a paso.'];
        if (v < 50000) return ['text-emerald-700', 'Buen progreso: lo que tienes supera lo que debes.'];
        return ['text-emerald-800', 'Excelente: estás construyendo riqueza real.'];
    }

    function update(ctx) {
        updateHoldings(ctx);
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
        if (sync) UI.html('nw-sync-hint', `<span><i class="fa-solid fa-circle-info"></i> Tus <a href="#" class="link" data-goto="futuro/polizas">pólizas</a> suman <strong>${money0(sync.polizas)}</strong>${sync.holdings ? `, tus <a href="#" class="link" data-goto="patrimonio" data-focus="nw-holdings">inversiones</a> <strong>${money0(sync.holdings)}</strong>` : ''} y tus <a href="#" class="link" data-goto="futuro/metas" data-focus="metas-debts">deudas</a> <strong>${money0(sync.debts)}</strong>, pero tu patrimonio de ${year} no coincide.</span><button class="btn btn-blue btn-sm" data-action="nw.prefill">Actualizar ahora</button>`);
        UI.text('nw-assets', money0(nw.assets));
        UI.text('nw-liabilities', money0(nw.liabilities));
        UI.text('nw-value', money(nw.value));
        let [cls, text] = verdict(nw.value);
        if (Engine.netWorthYears(s.years, s.assets, ctx.today.getFullYear()).includes(year - 1)) {
            const d = nw.value - Engine.netWorth(s.years, s.assets, year - 1).value;
            if (Math.abs(d) >= 1) text += ` ${d > 0 ? '▲' : '▼'} ${money0(Math.abs(d))} frente a ${year - 1}.`;
        }
        document.getElementById('nw-value').className = `text-4xl font-black block my-1 ${nw.value >= 0 ? 'text-emerald-700' : 'text-red-600'}`;
        const v = document.getElementById('nw-verdict');
        v.className = `text-sm font-bold ${cls}`;
        v.textContent = text;
        document.getElementById('nw-result').className = `mt-5 rounded-xl p-5 text-center border-t-4 bg-slate-50 ${nw.value >= 0 ? 'border-emerald-500' : 'border-red-500'}`;

        const years = Engine.netWorthYears(s.years, s.assets, ctx.today.getFullYear());
        UI.chart('nw-chart', {
            type: 'line',
            data: { labels: years, datasets: [{ label: 'Patrimonio neto', data: years.map(y => Engine.netWorth(s.years, s.assets, y).value), borderColor: '#0d9488', backgroundColor: 'rgba(13,148,136,.1)', fill: true, cubicInterpolationMode: 'monotone', pointRadius: years.map(y => y === year ? 5 : 3) }] },
            options: { scales: { y: { beginAtZero: false } }, plugins: { legend: { display: false } } }
        });
    }

    const find = (el) => Store.state.assets.find(a => a.id === Number(el.dataset.id));

    // ------------------------------------------------------------ accounts
    const ACCT_KINDS = [{ value: 'corriente', label: 'Cuenta corriente' }, { value: 'ahorros', label: 'Cuenta de ahorros' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'retiro', label: 'Jubilación (401(k) / IRA)' }];
    function renderAccounts(ctx) {
        const list = ctx.state.accounts || [];
        UI.html('acct-body', list.length ? list.map(a => `<tr data-row="${a.id}">
            <td><input class="cell-input font-semibold" value="${esc(a.name)}" data-change="acct.set" data-id="${a.id}" data-field="name" aria-label="Nombre de la cuenta"></td>
            <td><select class="cell-input" data-change="acct.set" data-id="${a.id}" data-field="kind">${Views.selectOptions(ACCT_KINDS, a.kind)}</select></td>
            <td><input type="number" class="cell-input num money" step="any" value="${Number(a.balance) || 0}" data-input="acct.set" data-id="${a.id}" data-field="balance" aria-label="Saldo"></td>
            <td class="text-[11px] text-slate-500" data-cell="when">${a.updatedAt ? esc(a.updatedAt) : '—'}</td>
            <td class="text-center"><button class="row-del" data-action="acct.delete" data-id="${a.id}" title="Eliminar cuenta" aria-label="Eliminar cuenta"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`).join('') : '<tr class="empty-row"><td colspan="5">Agrega tus cuentas (Pichincha ahorros, Produbanco corriente, efectivo…) para ver tu dinero disponible de un vistazo.</td></tr>');
        UI.text('acct-total', money(list.reduce((t, a) => t + (Number(a.balance) || 0), 0)));
    }

    // ------------------------------------------------------------ investments
    const KINDS = ['ETF', 'Acción', 'Fondo mutuo', 'Cripto', 'Otro'];

    function holdingRow(h) {
        return `<tr data-row="${h.id}">
            <td><input class="cell-input font-bold uppercase" style="min-width:5.5rem" value="${esc(h.ticker)}" data-change="hold.set" data-id="${h.id}" data-field="ticker" aria-label="Símbolo" placeholder="VOO"></td>
            <td><input class="cell-input" style="min-width:9rem" value="${esc(h.name)}" data-change="hold.set" data-id="${h.id}" data-field="name" aria-label="Nombre" placeholder="Vanguard S&P 500"></td>
            <td><select class="cell-input" data-change="hold.set" data-id="${h.id}" data-field="kind">${Views.selectOptions(KINDS, h.kind)}</select></td>
            <td><input type="number" class="cell-input num" min="0" step="any" value="${Number(h.shares) || 0}" data-input="hold.set" data-id="${h.id}" data-field="shares" aria-label="Cantidad"></td>
            <td><input type="number" class="cell-input num money" min="0" step="any" value="${Number(h.price) || 0}" data-input="hold.set" data-id="${h.id}" data-field="price" aria-label="Precio"></td>
            <td class="num font-bold" data-cell="value"></td>
            <td class="text-[11px] text-slate-500" data-cell="when"></td>
            <td class="text-center"><button class="row-del" data-action="hold.delete" data-id="${h.id}" title="Eliminar" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function renderHoldings(ctx) {
        const list = ctx.state.holdings || [];
        UI.html('hold-body', list.length ? list.map(holdingRow).join('') : '<tr class="empty-row"><td colspan="8">Agrega tus ETF, acciones o fondos: símbolo (ticker) y cuántas unidades tienes.</td></tr>');
        updateHoldings(ctx);
    }

    function updateHoldings(ctx) {
        const s = ctx.state;
        (s.holdings || []).forEach(h => {
            const row = document.querySelector(`#hold-body tr[data-row="${h.id}"]`);
            if (!row) return;
            row.querySelector('[data-cell="value"]').textContent = money(Engine.holdingValue(h));
            row.querySelector('[data-cell="when"]').innerHTML = h.priceAt ? `${h.priceSource === 'manual' ? 'A mano' : 'Mercado'} · ${esc(new Date(h.priceAt).toLocaleString('es-EC', { dateStyle: 'short', timeStyle: 'short' }))}` : '<span class="text-amber-700">Sin precio</span>';
        });
        UI.text('hold-total', money0(Engine.holdingsValue(s.holdings)));
        const key = (s.settings.priceKey || '').trim();
        UI.html('hold-key-note', key ? `Precios de <strong>${s.settings.priceProvider === 'alphavantage' ? 'Alpha Vantage' : 'Finnhub'}</strong> con tu clave. Se actualizan cuando tocas el botón.`
            : 'Para traer precios del mercado, pega tu clave gratuita en <a href="#" class="link" data-goto="config" data-focus="cfg-prices">Configuración → Precios</a>. Sin clave, escribe el precio a mano.');
    }

    // Last price of a symbol from the chosen provider (with the person's own free key).
    async function fetchPrice(ticker, provider, key) {
        const sym = encodeURIComponent(ticker.trim().toUpperCase());
        if (provider === 'alphavantage') {
            const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${encodeURIComponent(key)}`);
            const j = await r.json();
            if (j.Note || j.Information) throw new Error('límite de consultas del plan gratuito');
            const p = parseFloat(j['Global Quote'] && j['Global Quote']['05. price']);
            if (!(p > 0)) throw new Error('símbolo no encontrado');
            return p;
        }
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${encodeURIComponent(key)}`);
        if (r.status === 401 || r.status === 403) throw new Error('clave no válida');
        if (r.status === 429) throw new Error('límite de consultas, intenta en un minuto');
        const j = await r.json();
        if (!(j.c > 0)) throw new Error('símbolo no encontrado');
        return j.c;
    }

    function touch(yd, field, value) {
        yd.netWorth[field] = value;
        yd.netWorthTouched[field] = true;
    }

    UI.register({
        'acct.add': () => {
            const list = Store.state.accounts || (Store.state.accounts = []);
            const id = Store.nextId(list);
            list.push({ id, name: 'Nueva cuenta', kind: 'ahorros', balance: 0, updatedAt: Engine.isoDate(new Date()) });
            App.changed({ structural: true, step: true });
            const input = document.querySelector(`#acct-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'acct.set': (el) => {
            const a = (Store.state.accounts || []).find(x => x.id === Number(el.dataset.id));
            if (!a) return;
            const f = el.dataset.field;
            a[f] = f === 'balance' ? parseNum(el.value, 0) : el.value;
            if (f === 'balance') a.updatedAt = Engine.isoDate(new Date());
            App.changed();
            UI.text('acct-total', money((Store.state.accounts || []).reduce((t, x) => t + (Number(x.balance) || 0), 0)));
        },
        'acct.delete': (el) => {
            const id = Number(el.dataset.id);
            const a = (Store.state.accounts || []).find(x => x.id === id);
            App.undoable(`Cuenta "${a ? a.name : ''}" eliminada`, () => { Store.state.accounts = Store.state.accounts.filter(x => x.id !== id); });
        },
        'hold.add': () => {
            const list = Store.state.holdings || (Store.state.holdings = []);
            const id = Store.nextId(list);
            list.push({ id, ticker: '', name: '', kind: 'ETF', shares: 0, price: 0, priceAt: null, priceSource: 'manual' });
            App.changed({ structural: true, step: true });
            const input = document.querySelector(`#hold-body tr[data-row="${id}"] input`);
            if (input) input.focus();
        },
        'hold.set': (el) => {
            const h = (Store.state.holdings || []).find(x => x.id === Number(el.dataset.id));
            if (!h) return;
            const f = el.dataset.field;
            if (f === 'shares' || f === 'price') h[f] = Math.max(0, parseNum(el.value, 0));
            else h[f] = f === 'ticker' ? el.value.trim().toUpperCase() : el.value;
            if (f === 'price') { h.priceAt = new Date().toISOString(); h.priceSource = 'manual'; }
            App.changed();
        },
        'hold.delete': (el) => {
            const id = Number(el.dataset.id);
            const h = (Store.state.holdings || []).find(x => x.id === id);
            App.undoable(`Inversión ${h && h.ticker ? h.ticker : ''} eliminada`, () => { Store.state.holdings = Store.state.holdings.filter(x => x.id !== id); });
        },
        'hold.refresh': async (el) => {
            const s = Store.state;
            const key = (s.settings.priceKey || '').trim();
            if (!key) { UI.toast('Primero pega tu clave gratuita en Configuración → Precios.', 'error'); App.go('config', { focus: 'cfg-prices' }); return; }
            const list = (s.holdings || []).filter(h => h.ticker);
            if (!list.length) { UI.toast('Agrega al menos una inversión con su símbolo (ticker).', 'error'); return; }
            el.disabled = true;
            const failed = [];
            let ok = 0;
            for (const h of list) {
                try {
                    h.price = Math.round(await fetchPrice(h.ticker, s.settings.priceProvider, key) * 10000) / 10000;
                    h.priceAt = new Date().toISOString();
                    h.priceSource = s.settings.priceProvider || 'finnhub';
                    ok++;
                } catch (e) { failed.push(`${h.ticker} (${e.message || 'sin conexión'})`); }
            }
            el.disabled = false;
            App.changed({ structural: true, step: true });
            if (ok) UI.toast(`${ok} precio${ok === 1 ? '' : 's'} actualizado${ok === 1 ? '' : 's'}. Total: ${money0(Engine.holdingsValue(s.holdings))}.`);
            if (failed.length) UI.toast(`No se pudo: ${failed.join(', ')}. Puedes escribir el precio a mano.`, 'error');
        },
        'nw.set': (el) => {
            touch(Store.active(), el.dataset.field, Math.max(0, parseNum(el.value, 0)));
            App.changed();
        },
        'nw.prefill': () => {
            const s = Store.state, yd = Store.active();
            const accts = s.accounts || [];
            const capital = Engine.polizasCapital(s.polizas) + Engine.holdingsValue(s.holdings) + Engine.accountTotal(accts, 'retiro');
            touch(yd, 'investments', capital);
            // Accounts, when registered, fill checking (corriente + efectivo) and savings.
            if (accts.length) {
                touch(yd, 'checking', Engine.accountTotal(accts, 'cash'));
                touch(yd, 'savings', Engine.accountTotal(accts, 'ahorros'));
            }
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
