/* Patrimonio: per-year net worth (balances carry forward) and the asset registry. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    const ASSET_FIELDS = [
        { field: 'checking', label: 'Checking accounts', help: 'Today\'s balance in your checking accounts.' },
        { field: 'savings', label: 'Savings accounts', help: 'Also counts toward your emergency fund.' },
        { field: 'investments', label: 'Investments, CDs and 401(k)/IRA', help: 'CDs, stocks/ETFs and retirement accounts.' },
        { registry: 'Bienes Raíces', label: 'Real estate' },
        { registry: 'Vehículo', label: 'Vehicles' },
        { registry: 'Otro', label: 'Other valuables' }
    ];
    const LIABILITY_FIELDS = [
        { field: 'mortgage', label: 'Hipoteca', help: 'What you still owe on your house.' },
        { field: 'creditCards', label: 'Credit cards', help: 'Total balance owed, not the payment.' },
        { field: 'autoLoans', label: 'Auto loans' },
        { field: 'personalLoans', label: 'Personal loans', help: 'Includes loans from family or friends.' },
        { field: 'studentLoans', label: 'Student loans' },
        { field: 'otherDebts', label: 'Other debts', help: 'Medical bills, business loans, etc.' }
    ];

    function fieldHTML(def, tone) {
        if (def.registry) {
            return `<div class="field-box tone-${tone} flex items-center justify-between gap-3">
                <div><span class="field-label mb-0">${def.label}</span><span class="linked block">🔗 From the <a href="#" class="link" data-goto="patrimonio" data-focus="asset-registry">asset register</a></span></div>
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
                   <span class="badge badge-muted">Sold in ${a.saleYear} for ${money0(a.saleValue)}</span>
                   <div class="mt-1 flex flex-col items-start gap-0.5">
                       ${a.proceedsAdded ? '<span class="text-emerald-700 font-bold">✓ Moved to checking accounts</span>' : `<button class="link" data-action="asset.proceeds" data-id="${a.id}">+ Move to checking accounts</button>`}
                       <button class="text-slate-400 hover:text-red-600 underline" data-action="asset.unsell" data-id="${a.id}">Undo sale</button>
                   </div></div>`
            : `<button class="btn btn-secondary btn-sm" data-action="asset.sell" data-id="${a.id}">Mark sold</button>`;
        return `<tr data-row="${a.id}" class="${owned ? '' : 'opacity-50'}">
            <td><input class="cell-input" value="${esc(a.name)}" data-change="asset.set" data-id="${a.id}" data-field="name"></td>
            <td><select class="cell-input" data-change="asset.set" data-id="${a.id}" data-field="category">${Views.selectOptions(Engine.ASSET_CATEGORIES, a.category)}</select></td>
            <td><input type="number" class="cell-input num" value="${a.purchaseYear}" data-change="asset.set" data-id="${a.id}" data-field="purchaseYear"></td>
            <td><input type="number" class="cell-input num" min="0" value="${Number(a.purchaseValue) || 0}" data-change="asset.set" data-id="${a.id}" data-field="purchaseValue"></td>
            <td><input type="number" class="cell-input num money" min="0" value="${Engine.assetValue(a, year)}" ${owned ? '' : 'disabled title="No lo tienes en este año"'} data-input="asset.value" data-id="${a.id}"></td>
            <td>${status}</td>
            <td class="text-center"><button class="row-del" data-action="asset.delete" data-id="${a.id}" title="Delete asset"><i class="fa-solid fa-trash-can"></i></button></td>
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
        UI.html('asset-body', s.assets.length ? s.assets.map(a => assetRow(a, s.activeYear)).join('') : `<tr class="empty-row"><td colspan="7">${Views.emptyState('fa-house', 'You haven\'t added assets yet (house, car, land…).')}</td></tr>`);
        update(ctx);
    }

    // About the level only; whether it grows is said only when there's a previous year to compare.
    function verdict(v) {
        if (v < 0) return ['text-red-700', 'Negative net worth: you owe more than you own. Paying off debt (Step 2) is your priority.'];
        if (v < 5000) return ['text-slate-700', 'You\'re on the right track. Keep moving step by step.'];
        if (v < 50000) return ['text-emerald-700', 'Good progress: what you own is more than what you owe.'];
        return ['text-emerald-800', 'Excellent: you\'re building real wealth.'];
    }

    // Net worth month by month (state.netWorthHistory, kept by App on each change) and the
    // milestones: reached ones with their date, and the next few with how close you are.
    function progress(ctx) {
        const s = ctx.state, pal = UI.palette();
        const h = s.netWorthHistory || [];
        const enough = h.length >= 2;
        UI.show('nw-month-box', enough);
        UI.show('nw-month-empty', !enough);
        if (!enough) UI.html('nw-month-empty', 'We save your net worth on its own every month. Come back next month to see the line.');
        else UI.chart('nw-month-chart', {
            type: 'line',
            data: { labels: h.map(x => Fmt.monthYear(new Date(x.month + '-01T00:00:00'))), datasets: [{ label: 'Net worth', data: h.map(x => x.value), borderColor: pal.blue, backgroundColor: pal.alpha(pal.blue, 0.1), borderWidth: 2, fill: true, tension: 0, pointRadius: h.length > 24 ? 0 : 3, pointBackgroundColor: pal.blue, pointBorderColor: pal.surface, pointBorderWidth: 2 }] },
            options: { scales: { y: { beginAtZero: false } }, plugins: { legend: { display: false } } }
        });
        const list = Engine.milestones({ netWorth: Engine.netWorth(s.years, s.assets, ctx.today.getFullYear()).value, liquid: ctx.ef.liquid, monthsCovered: ctx.ef.monthsCovered, debts: s.debts, money: money0 });
        const got = s.milestones || {};
        const done = list.filter(m => m.done);
        const next = list.filter(m => !m.done).sort((a, b) => b.progress - a.progress).slice(0, 4);
        const when = (k) => got[k] && got[k] !== 'antes' ? Fmt.monthYear(new Date(got[k] + 'T00:00:00')) : null;
        UI.html('nw-milestones', `<div><div class="text-xs font-bold text-slate-600 mb-2">Reached (${done.length})</div>${done.length ? `<ul class="space-y-1.5">${done.map(m => `<li class="milestone done"><i class="fa-solid fa-circle-check"></i><span class="flex-1 min-w-0">${esc(m.label)}</span>${when(m.key) ? `<span class="text-[11px] text-slate-500 whitespace-nowrap">${esc(when(m.key))}</span>` : ''}</li>`).join('')}</ul>` : '<p class="help">Your first milestone is close: look to the right.</p>'}</div>
            <div><div class="text-xs font-bold text-slate-600 mb-2">Up next</div>${next.length ? `<ul class="space-y-2.5">${next.map(m => `<li class="milestone"><div class="flex justify-between gap-2 text-xs"><span class="min-w-0">${esc(m.label)}</span><span class="font-bold whitespace-nowrap">${Math.floor(m.progress * 100)}%</span></div><div class="progress-track mt-1"><div class="progress-fill" style="width:${(m.progress * 100).toFixed(1)}%"></div></div></li>`).join('')}</ul>` : '<p class="help">You reached them all! 🎉</p>'}</div>`);
    }

    function update(ctx) {
        updateHoldings(ctx);
        progress(ctx);
        if (window.Checklists) Checklists.render();
        const s = ctx.state, nw = ctx.netWorth, year = s.activeYear;
        UI.$$('[data-registry]').forEach(el => { el.textContent = money(nw.registry[el.dataset.registry] || 0); });
        // This year, figures the app already knows fill themselves (read-only here).
        const auto = year === ctx.today.getFullYear() ? Engine.netWorthFromSources({ polizas: s.polizas, holdings: s.holdings, accounts: s.accounts, debts: s.debts }) : {};
        UI.$$('[data-src]').forEach(el => {
            const f = el.dataset.src;
            const src = Engine.netWorthSource(s.years, year, f);
            const def = ASSET_FIELDS.concat(LIABILITY_FIELDS).find(d => d.field === f);
            const input = document.querySelector(`[data-input="nw.set"][data-field="${f}"]`);
            if (input) { input.readOnly = f in auto; input.classList.toggle('input-readonly', f in auto); }
            el.innerHTML = f in auto
                ? `<span class="linked">🔗 Automatic: ${f === 'investments' ? 'your CDs, investments and retirement accounts' : f === 'checking' || f === 'savings' ? 'tus <a href="#" class="link" data-goto="patrimonio" data-focus="nw-accounts">accounts</a>' : 'tus <a href="#" class="link" data-goto="futuro/metas" data-focus="metas-debts">debts</a>'}.</span>`
                : src !== null && src < year ? `<span class="text-slate-500">↩ Carried over from ${src}. Edit it if it changed.</span>` : esc(def.help || '');
        });
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

        compare(nw);
        const years = Engine.netWorthYears(s.years, s.assets, ctx.today.getFullYear());
        const pal = UI.palette();
        UI.chart('nw-chart', {
            type: 'line',
            data: { labels: years, datasets: [{ label: 'Net worth', data: years.map(y => Engine.netWorth(s.years, s.assets, y).value), borderColor: pal.blue, backgroundColor: pal.alpha(pal.blue, 0.1), borderWidth: 2, fill: true, tension: 0, pointRadius: years.map(y => y === year ? 5 : 3), pointBackgroundColor: pal.blue, pointBorderColor: pal.surface, pointBorderWidth: 2 }] },
            options: { scales: { y: { beginAtZero: false } }, plugins: { legend: { display: false } } }
        });
    }

    // Own vs. owe: what you have and what you owe as two bars on one scale (Engine.netWorth
    // fields + registry); the gap between their ends is your net worth. Each bar is split, with
    // 2px gaps, into its parts (named underneath and in the table).
    function compare(nw) {
        const pal = UI.palette();
        const part = (d) => ({ label: d.label, value: d.registry ? (nw.registry[d.registry] || 0) : (nw.fields[d.field] || 0) });
        // Checking and savings read as one "cuentas" part.
        const own = [{ label: 'Accounts and cash', value: (nw.fields.checking || 0) + (nw.fields.savings || 0) }].concat(ASSET_FIELDS.slice(2).map(part)).filter(p => p.value > 0.5);
        const owe = LIABILITY_FIELDS.map(part).filter(p => p.value > 0.5);
        const scale = Math.max(nw.assets, nw.liabilities, 1);
        const pctOf = (v) => (v / scale * 100).toFixed(2);
        const bar = (parts, total, color) => `<div class="nwc-bar" style="width:${pctOf(total)}%">${parts.map(p => `<span style="flex:${p.value} 1 0;background:${color}" title="${esc(p.label)}: ${money0(p.value)}"></span>`).join('')}</div>`;
        const names = (parts) => parts.slice().sort((a, b) => b.value - a.value).map(p => `<span>${esc(p.label)}</span> ${money0(p.value)}`).join(" · ");
        const lo = Math.min(nw.assets, nw.liabilities), hi = Math.max(nw.assets, nw.liabilities);
        const gapText = nw.value >= 0 ? `Net worth: ${money0(nw.value)}` : `You owe ${money0(-nw.value)} more than you own`;
        const el = document.getElementById('nw-compare');
        if (el) el.setAttribute('aria-label', `You own ${money0(nw.assets)}; you owe ${money0(nw.liabilities)}. ${gapText}.`);
        UI.html('nw-compare', `
            <div class="nwc-row"><div class="nwc-label">You have<b>${money0(nw.assets)}</b></div><div class="nwc-track">${bar(own, nw.assets, pal.blue)}</div></div>
            <div class="nwc-row"><span></span><div class="nwc-comp">${own.length ? names(own) : 'You haven\'t added what you own yet.'}</div></div>
            <div class="nwc-row"><div class="nwc-label">You owe<b>${money0(nw.liabilities)}</b></div><div class="nwc-track">${bar(owe, nw.liabilities, pal.orange)}</div></div>
            <div class="nwc-row"><span></span><div class="nwc-comp">${owe.length ? names(owe) : 'Debt-free!'}</div></div>
            <div class="nwc-row" style="margin-bottom:0"><span></span><div>
                <div class="nwc-gap">${hi - lo > 0.5 ? `<span style="left:${pctOf(lo)}%;width:${(Number(pctOf(hi)) - Number(pctOf(lo))).toFixed(2)}%"></span>` : ''}</div>
                <div class="nwc-note" style="text-align:right;padding-right:${(100 - Number(pctOf(hi))).toFixed(2)}%">${gapText}</div>
            </div></div>`);
        UI.html('nw-compare-table', own.map(p => `<tr><td>${esc(p.label)}</td><td class="num">${money0(p.value)}</td></tr>`).join('')
            + `<tr class="font-bold"><td>Total you own</td><td class="num">${money0(nw.assets)}</td></tr>`
            + owe.map(p => `<tr><td>${esc(p.label)}</td><td class="num">${money0(p.value)}</td></tr>`).join('')
            + `<tr class="font-bold"><td>Total you owe</td><td class="num">${money0(nw.liabilities)}</td></tr>`
            + `<tr class="font-bold"><td>Net worth</td><td class="num">${money0(nw.value)}</td></tr>`);
    }

    const find = (el) => Store.state.assets.find(a => a.id === Number(el.dataset.id));

    // ------------------------------------------------------------ accounts
    // Money you can use: everything but retirement accounts (401(k)/IRA).
    // Cards aren't available money: their balance (below 0) is what you owe.
    const availableTotal = (list) => list.filter(a => a.kind !== 'retiro' && a.kind !== 'tarjeta').reduce((t, a) => t + (Number(a.balance) || 0), 0);
    const ACCT_KINDS = [{ value: 'corriente', label: 'Checking account' }, { value: 'ahorros', label: 'Savings account' }, { value: 'efectivo', label: 'Efectivo' }, { value: 'tarjeta', label: 'Credit card' }, { value: 'retiro', label: 'Retirement (401(k) / IRA)' }];
    // All accounts in one place: totals by type.
    function accountTypesHTML(list) {
        const tot = (f) => list.filter(f).reduce((t, a) => t + (Number(a.balance) || 0), 0);
        const parts = [['Cash and bank', tot(a => !['tarjeta', 'retiro'].includes(a.kind))], ['Credit cards', tot(a => a.kind === 'tarjeta')], ['Retirement', tot(a => a.kind === 'retiro')]]
            .filter((_, i) => i === 0 || list.some(a => a.kind === (i === 1 ? 'tarjeta' : 'retiro')));
        return parts.map(([l, v]) => `<span><span>${l}</span>: <strong class="${v < 0 ? 'text-red-700' : ''}">${v < 0 ? '−' : ''}${money(Math.abs(v))}</strong></span>`).join(' · ');
    }
    function renderAccounts(ctx) {
        const list = ctx.state.accounts || [];
        UI.html('acct-body', list.length ? list.map(a => `<tr data-row="${a.id}">
            <td><input class="cell-input font-semibold" value="${esc(a.name)}" data-change="acct.set" data-id="${a.id}" data-field="name" aria-label="Account name"></td>
            <td><select class="cell-input" data-change="acct.set" data-id="${a.id}" data-field="kind">${Views.selectOptions(ACCT_KINDS, a.kind)}</select>${a.kind === 'tarjeta' ? `<select class="cell-input text-[11px] mt-1" data-change="acct.set" data-id="${a.id}" data-field="debtId" aria-label="Its debt in your plan">${Views.selectOptions([{ value: '', label: 'Not in my debts' }].concat((ctx.state.debts || []).map(d => ({ value: String(d.id), label: `Debt: ${d.name}` }))), a.debtId ? String(a.debtId) : '')}</select>` : ''}</td>
            <td><input type="number" class="cell-input num money" step="any" value="${Number(a.balance) || 0}" data-input="acct.set" data-id="${a.id}" data-field="balance" aria-label="Balance"></td>
            <td class="text-[11px] text-slate-500"><span data-cell="when">${a.updatedAt ? esc(a.updatedAt) : '—'}</span>${a.lastImport ? `<div title="Rows on or before this date start unchecked when you import this account again"><i class="fa-solid fa-lock text-amber-600"></i> <span>Imported up to ${esc(a.lastImport)}</span> <button type="button" class="link" data-action="acct.clearImport" data-id="${a.id}" aria-label="Forget the last import date">×</button></div>` : ''}</td>
            <td class="text-center"><button class="row-del" data-action="acct.delete" data-id="${a.id}" title="Delete account" aria-label="Delete account"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`).join('') : `<tr class="empty-row"><td colspan="5">${Views.emptyState('fa-building-columns', 'Add your accounts (checking, savings, cash, 401(k)…) to see your money at a glance.')}</td></tr>`);
        UI.text('acct-total', money(availableTotal(list)));
        UI.html('acct-types', list.length ? accountTypesHTML(list) : '');
    }

    // ------------------------------------------------------------ investments
    const KINDS = ['ETF', 'Acción', 'Fondo mutuo', 'Cripto', 'Otro'];

    function holdingRow(h) {
        return `<tr data-row="${h.id}">
            <td><input class="cell-input font-bold uppercase" style="min-width:5.5rem" value="${esc(h.ticker)}" data-change="hold.set" data-id="${h.id}" data-field="ticker" aria-label="Symbol" placeholder="VOO"></td>
            <td><input class="cell-input" style="min-width:9rem" value="${esc(h.name)}" data-change="hold.set" data-id="${h.id}" data-field="name" aria-label="Name" placeholder="Vanguard S&P 500"></td>
            <td><select class="cell-input" data-change="hold.set" data-id="${h.id}" data-field="kind">${Views.selectOptions(KINDS, h.kind)}</select></td>
            <td><input type="number" class="cell-input num" min="0" step="any" value="${Number(h.shares) || 0}" data-input="hold.set" data-id="${h.id}" data-field="shares" aria-label="Quantity"></td>
            <td><input type="number" class="cell-input num money" min="0" step="any" value="${Number(h.price) || 0}" data-input="hold.set" data-id="${h.id}" data-field="price" aria-label="Price"></td>
            <td class="num font-bold" data-cell="value"></td>
            <td><input type="number" class="cell-input num money" min="0" step="any" value="${Number(h.cost) || ''}" data-input="hold.set" data-id="${h.id}" data-field="cost" aria-label="Total cost" placeholder="—"></td>
            <td class="num whitespace-nowrap" data-cell="gain"></td>
            <td class="text-[11px] text-slate-500" data-cell="when"></td>
            <td class="text-center"><button class="row-del" data-action="hold.delete" data-id="${h.id}" title="Delete" aria-label="Delete"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    // A gain or loss in money and %, green or red.
    const gainHTML = (gain, cost) => gain === null || gain === undefined || !(cost > 0) ? '<span class="text-slate-400">—</span>'
        : `<span class="${gain >= 0 ? 'text-emerald-700' : 'text-red-700'} font-semibold">${gain >= 0 ? '+' : '−'}${money0(Math.abs(gain))} <span class="text-[11px]">(${gain >= 0 ? '+' : '−'}${Math.abs(gain / cost * 100).toFixed(1)}%)</span></span>`;

    function renderHoldings(ctx) {
        const list = ctx.state.holdings || [];
        UI.html('hold-body', list.length ? list.map(holdingRow).join('') : `<tr class="empty-row"><td colspan="10">${Views.emptyState('fa-chart-line', 'Add your ETFs, stocks or funds: symbol (ticker) and how many shares you own.')}</td></tr>`);
        if (window.Mix) Mix.render(ctx);
        updateHoldings(ctx);
    }

    function updateHoldings(ctx) {
        const s = ctx.state;
        (s.holdings || []).forEach(h => {
            const row = document.querySelector(`#hold-body tr[data-row="${h.id}"]`);
            if (!row) return;
            row.querySelector('[data-cell="value"]').textContent = money(Engine.holdingValue(h));
            row.querySelector('[data-cell="gain"]').innerHTML = gainHTML(Number(h.cost) > 0 ? Engine.holdingValue(h) - Number(h.cost) : null, Number(h.cost));
            row.querySelector('[data-cell="when"]').innerHTML = h.priceAt ? `${h.priceSource === 'manual' ? 'Manual' : 'Market'} · ${esc(new Date(h.priceAt).toLocaleString(window.I18n && I18n.lang === 'en' ? 'en-US' : 'es-EC', { dateStyle: 'short', timeStyle: 'short' }))}` : '<span class="text-amber-700">No price</span>';
        });
        UI.text('hold-total', money0(Engine.holdingsValue(s.holdings)));
        const mix = Engine.portfolioMix(s.holdings, null);
        UI.text('hold-cost', mix.cost > 0 ? money0(mix.cost) : '');
        UI.html('hold-gain', gainHTML(mix.gain, mix.cost));
        if (window.Mix) Mix.update(ctx);
        const key = (s.settings.priceKey || '').trim();
        UI.html('hold-key-note', key ? `Prices from <strong>${s.settings.priceProvider === 'alphavantage' ? 'Alpha Vantage' : 'Finnhub'}</strong> with your key. They update when you tap the button.`
            : 'To fetch market prices, paste your free key in <a href="#" class="link" data-goto="config" data-focus="cfg-prices">Settings → Prices</a>. Without a key, type the price by hand.');
    }

    // Last price of a symbol from the chosen provider (with the person's own free key).
    async function fetchPrice(ticker, provider, key) {
        const sym = encodeURIComponent(ticker.trim().toUpperCase());
        if (provider === 'alphavantage') {
            const r = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${sym}&apikey=${encodeURIComponent(key)}`);
            const j = await r.json();
            if (j.Note || j.Information) throw new Error('free plan request limit');
            const p = parseFloat(j['Global Quote'] && j['Global Quote']['05. price']);
            if (!(p > 0)) throw new Error('symbol not found');
            return p;
        }
        const r = await fetch(`https://finnhub.io/api/v1/quote?symbol=${sym}&token=${encodeURIComponent(key)}`);
        if (r.status === 401 || r.status === 403) throw new Error('invalid key');
        if (r.status === 429) throw new Error('request limit, try again in a minute');
        const j = await r.json();
        if (!(j.c > 0)) throw new Error('symbol not found');
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
            if (f === 'debtId') { if (el.value) a.debtId = Number(el.value); else delete a.debtId; }
            else a[f] = f === 'balance' ? parseNum(el.value, 0) : el.value;
            if (f === 'balance') a.updatedAt = Engine.isoDate(new Date());
            // A card linked to a debt keeps that debt's balance (what's owed) in step.
            const debt = a.kind === 'tarjeta' && a.debtId ? (Store.state.debts || []).find(d => d.id === a.debtId) : null;
            if (debt && (f === 'balance' || f === 'debtId')) debt.balance = Math.max(0, -(Number(a.balance) || 0));
            App.changed({ structural: f === 'kind' || f === 'debtId' });
            UI.text('acct-total', money(availableTotal(Store.state.accounts || [])));
        },
        'acct.clearImport': (el) => {
            const a = (Store.state.accounts || []).find(x => x.id === Number(el.dataset.id));
            if (a) App.undoable('Last import date cleared', () => { delete a.lastImport; });
        },
        'acct.delete': (el) => {
            const id = Number(el.dataset.id);
            const a = (Store.state.accounts || []).find(x => x.id === id);
            App.undoable(`Account "${a ? a.name : ''}" deleted`, () => { Store.state.accounts = Store.state.accounts.filter(x => x.id !== id); });
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
            if (f === 'shares' || f === 'price' || f === 'cost') h[f] = Math.max(0, parseNum(el.value, 0));
            else h[f] = f === 'ticker' ? el.value.trim().toUpperCase() : el.value;
            if (f === 'price') { h.priceAt = new Date().toISOString(); h.priceSource = 'manual'; }
            App.changed();
        },
        'hold.delete': (el) => {
            const id = Number(el.dataset.id);
            const h = (Store.state.holdings || []).find(x => x.id === id);
            App.undoable(`Investment ${h && h.ticker ? h.ticker : ''} deleted`, () => { Store.state.holdings = Store.state.holdings.filter(x => x.id !== id); });
        },
        'hold.refresh': async (el) => {
            const s = Store.state;
            const key = (s.settings.priceKey || '').trim();
            if (!key) { UI.toast('First paste your free key in Settings → Prices.', 'error'); App.go('config', { focus: 'cfg-prices' }); return; }
            const list = (s.holdings || []).filter(h => h.ticker);
            if (!list.length) { UI.toast('Add at least one investment with its symbol (ticker).', 'error'); return; }
            el.disabled = true;
            const failed = [];
            let ok = 0;
            for (const h of list) {
                try {
                    h.price = Math.round(await fetchPrice(h.ticker, s.settings.priceProvider, key) * 10000) / 10000;
                    h.priceAt = new Date().toISOString();
                    h.priceSource = s.settings.priceProvider || 'finnhub';
                    ok++;
                } catch (e) { failed.push(`${h.ticker} (${e.message || 'offline'})`); }
            }
            el.disabled = false;
            App.changed({ structural: true, step: true });
            if (ok) UI.toast(`${ok} price${ok === 1 ? '' : 's'} updated. Total: ${money0(Engine.holdingsValue(s.holdings))}.`);
            if (failed.length) UI.toast(`Couldn't: ${failed.join(', ')}. You can type the price by hand.`, 'error');
        },
        'nw.set': (el) => {
            touch(Store.active(), el.dataset.field, Math.max(0, parseNum(el.value, 0)));
            App.changed();
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
                message: 'From the year it\'s sold, this asset stops counting toward your net worth.',
                fields: [
                    { name: 'value', label: 'Sale price ($)', type: 'number', min: 0, value: Engine.assetValue(a, year) },
                    { name: 'year', label: 'Year sold', type: 'number', value: year }
                ],
                confirmText: 'Mark as sold',
                validate: v => v.value === null || v.value < 0 ? 'Enter the sale price.' : !v.year || v.year < a.purchaseYear ? `The year must be ${a.purchaseYear} or later.` : null
            });
            if (!r) return;
            Object.assign(a, { status: 'Vendido', saleValue: r.value, saleYear: Math.round(r.year), proceedsAdded: false });
            App.changed({ structural: true });
        },
        'asset.unsell': async (el) => {
            const a = find(el);
            const ok = await UI.confirm({ title: 'Undo the sale', message: `"${a.name}" is active again.${a.proceedsAdded ? ' The amount already moved to checking isn\'t reversed automatically.' : ''}`, confirmText: 'Undo sale' });
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
            UI.toast(`${money0(a.saleValue)} moved to ${a.saleYear} checking accounts`);
        }
    });

    App.defineView('patrimonio', { render, update });
})();
