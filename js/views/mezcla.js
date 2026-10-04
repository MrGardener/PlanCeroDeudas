/* Patrimonio → Inversiones → Tu mezcla: your holdings by asset class (U.S. stocks, international,
 * bonds, cash, other) against a target mix (state.investTarget, % per class), whether it has
 * drifted enough to rebalance, what to buy and sell to get back, and how to split your next
 * contribution so you get there without selling (Engine.portfolioMix). */
(function () {
    'use strict';
    const { money0, esc } = Fmt;
    const LABELS = { us: 'Acciones de EE.UU.', intl: 'Acciones internacionales', bonds: 'Bonos (renta fija)', cash: 'Efectivo / mercado monetario', other: 'Otro (cripto, oro…)' };
    const ui = () => (Store.ui.mix || (Store.ui.mix = { newMoney: 500 }));

    function presets() {
        const age = Number((Store.state.retirement || {}).edadActual) || 40;
        const stocks = Math.max(30, Math.min(90, 110 - age));
        const us = Math.round(stocks * 0.7);
        return [
            { key: 'age', label: `Por tu edad (${stocks}% en acciones)`, mix: { us, intl: stocks - us, bonds: 100 - stocks, cash: 0, other: 0 } },
            { key: 'growth', label: 'Todo en acciones (largo plazo)', mix: { us: 75, intl: 25, bonds: 0, cash: 0, other: 0 } },
            { key: 'calm', label: 'Conservadora', mix: { us: 40, intl: 20, bonds: 40, cash: 0, other: 0 } }
        ];
    }

    // Inputs are redrawn only when the cursor isn't in them (re-drawing while typing would lose it).
    const draw = (id, html) => { const el = document.getElementById(id); if (el && !el.contains(document.activeElement)) el.innerHTML = html; };

    function render(ctx) {
        const box = document.getElementById('hold-mix');
        if (!box) return;
        const list = (ctx.state.holdings || []).filter(h => Engine.holdingValue(h) > 0);
        if (!list.length) { box.innerHTML = ''; return; }
        if (!document.getElementById('mix-in')) box.innerHTML = `<div class="section-label mt-5"><i class="fa-solid fa-chart-pie text-indigo-600"></i> Tu mezcla de inversiones</div>
            <div id="mix-in"></div>
            <div class="grid grid-cols-1 lg:grid-cols-2 gap-4 mt-4">
                <div class="space-y-3" id="mix-bars"></div>
                <div><div id="mix-verdict"></div>
                    <div class="flex flex-wrap items-end gap-3 mt-3" id="mix-split-box"><div id="mix-new-in"></div><p class="text-xs flex-1 min-w-[14rem] pb-2" id="mix-split"></p></div>
                    <p class="text-xs mt-3" id="mix-gain"></p>
                    <p class="help mt-2" id="mix-help"></p>
                </div>
            </div>`;
        draw('mix-in', inputsHTML(ctx, list));
        fill(ctx);
    }

    function inputsHTML(ctx, list) {
        const t = ctx.state.investTarget || {};
        const v = (k) => (ctx.state.investTarget ? esc(String(Number(t[k]) || 0)) : '');
        const opts = Engine.ASSET_CLASSES.map(k => ({ value: k, label: LABELS[k] }));
        return `<div class="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div>
                <div class="text-xs font-bold text-slate-600 mb-1.5">¿Qué es cada una?</div>
                <div class="space-y-1.5">${list.map(h => `<label class="flex items-center gap-2 text-xs"><strong class="w-16 shrink-0 truncate" data-i18n-skip>${esc(h.ticker || h.name || '—')}</strong>
                    <select class="input py-1 text-xs" data-change="mix.asset" data-id="${h.id}" aria-label="Clase">${Views.selectOptions(opts, Engine.assetClassOf(h))}</select></label>`).join('')}</div>
                <p class="help mt-1.5">Se adivina por el símbolo de los fondos más comunes; cámbialo si no es así.</p>
            </div>
            <div>
                <div class="text-xs font-bold text-slate-600 mb-1.5">Tu mezcla meta (%)</div>
                <div class="flex flex-wrap gap-1.5 mb-2">${presets().map(p => `<button type="button" class="quick-chip" data-action="mix.preset" data-key="${p.key}">${esc(p.label)}</button>`).join('')}</div>
                <div class="grid grid-cols-2 sm:grid-cols-3 gap-2">${Engine.ASSET_CLASSES.map(k => `<label class="field"><span class="field-label text-[11px]">${LABELS[k]}</span>
                    <input type="number" class="input" min="0" max="100" step="5" data-input="mix.target" data-key="${k}" value="${v(k)}" placeholder="0"></label>`).join('')}</div>
                <p class="help mt-1" id="mix-sum"></p>
            </div>
        </div>`;
    }

    function fill(ctx) {
        const s = ctx.state, u = ui();
        const m = Engine.portfolioMix(s.holdings, s.investTarget, { newMoney: u.newMoney });
        const tSum = s.investTarget ? Engine.ASSET_CLASSES.reduce((a, k) => a + (Number(s.investTarget[k]) || 0), 0) : 0;
        UI.text('mix-sum', s.investTarget && Math.round(tSum) !== 100 ? `Suman ${Math.round(tSum)}%: se toman en proporción.` : '');
        UI.html('mix-bars', m.classes.filter(c => c.value > 0 || (c.target || 0) > 0).map(c => {
            const act = !m.hasTarget ? '' : Math.abs(c.diff) < Math.max(25, m.total * 0.005) ? '<span class="text-slate-500">En la meta</span>'
                : c.diff > 0 ? `<span class="text-emerald-700 font-semibold">Comprar ${money0(c.diff)}</span>` : `<span class="text-red-700 font-semibold">Vender ${money0(-c.diff)}</span>`;
            return `<div class="mix-row">
                <div class="flex justify-between gap-2 text-xs"><span class="font-semibold">${LABELS[c.key]}</span><span class="whitespace-nowrap">${money0(c.value)} · <strong>${c.pct.toFixed(0)}%</strong>${m.hasTarget ? ` <span class="text-slate-500">(meta ${c.target.toFixed(0)}%)</span>` : ''}</span></div>
                <div class="mix-bar"><div class="mix-fill" style="width:${Math.min(100, c.pct).toFixed(1)}%"></div>${m.hasTarget ? `<div class="mix-target" style="left:${Math.min(100, c.target).toFixed(1)}%" title="Meta"></div>` : ''}</div>
                ${act ? `<div class="text-[11px] text-right">${act}</div>` : ''}
            </div>`;
        }).join(''));
        UI.html('mix-verdict', !m.hasTarget ? '<div class="panel tone-blue text-xs"><i class="fa-solid fa-circle-info"></i> Elige una mezcla meta para ver si necesitas rebalancear.</div>'
            : m.rebalance ? `<div class="panel tone-amber text-xs"><strong>Tu mezcla se desvió ${m.drift.toFixed(1)} puntos de la meta</strong> (más de 5): conviene rebalancear, comprando y vendiendo como se indica, o con tus próximos aportes.</div>`
            : '<div class="panel tone-emerald text-xs"><i class="fa-solid fa-circle-check"></i> Tu mezcla está a menos de 5 puntos de la meta: no hace falta mover nada. Revísala una vez al año.</div>');
        UI.show('mix-split-box', m.hasTarget);
        draw('mix-new-in', `<label class="field" style="max-width:11rem"><span class="field-label">Tu próximo aporte ($)</span><input type="number" class="input" min="0" step="50" id="mix-new" data-input="mix.new" value="${esc(String(u.newMoney || ''))}"></label>`);
        UI.html('mix-split', m.split.length ? `<span class="block mb-1">Sin vender nada, reparte ese aporte así:</span>${m.split.map(x => `<span class="flex justify-between gap-3"><span>${LABELS[x.key]}</span><strong>${money0(x.amount)}</strong></span>`).join('')}` : 'Escribe cuánto vas a invertir y te decimos dónde ponerlo.');
        UI.html('mix-gain', m.gain === null ? '' : `${m.gain >= 0 ? 'Has ganado' : 'Has perdido'} <strong class="${m.gain >= 0 ? 'text-emerald-700' : 'text-red-700'}">${money0(Math.abs(m.gain))}</strong> (${m.gain >= 0 ? '+' : '−'}${Math.abs(m.gainPct * 100).toFixed(1)}%) sobre ${money0(m.cost)} invertidos.`);
        UI.html('mix-help', `<span>${Store.COUNTRY === 'US' ? 'Rebalancear con dinero nuevo evita vender. Dentro de un 401(k) o IRA vender no paga impuestos; en una cuenta normal, vender con ganancia sí (menos si la tuviste más de un año).' : 'Rebalancear con dinero nuevo evita vender (y el impuesto que puede tener la ganancia).'}</span> <span>Solo cuenta lo que está en esta tabla, no tus cuentas de jubilación.</span>`);
    }

    UI.register({
        'mix.asset': (el) => {
            const h = (Store.state.holdings || []).find(x => x.id === Number(el.dataset.id));
            if (!h) return;
            h.asset = el.value;
            App.changed();
        },
        'mix.target': (el) => {
            const t = Store.state.investTarget || (Store.state.investTarget = { us: 0, intl: 0, bonds: 0, cash: 0, other: 0 });
            t[el.dataset.key] = Math.max(0, Math.min(100, Fmt.parseNum(el.value, 0)));
            App.changed();
        },
        'mix.preset': (el) => {
            const p = presets().find(x => x.key === el.dataset.key);
            if (!p) return;
            el.blur();   // so the target inputs (next to the button) are redrawn with the preset
            App.undoable('Mezcla meta actualizada', () => { Store.state.investTarget = Object.assign({}, p.mix); });
        },
        'mix.new': (el) => { ui().newMoney = Math.max(0, Fmt.parseNum(el.value, 0)); fill(App.buildContext()); }
    });

    window.Mix = { render, update: render };
})();
