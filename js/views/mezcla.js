/* Patrimonio → Inversiones → Tu mezcla: your holdings by asset class (U.S. stocks, international,
 * bonds, cash, other) against a target mix (state.investTarget, % per class), whether it has
 * drifted enough to rebalance, what to buy and sell to get back, and how to split your next
 * contribution so you get there without selling (Engine.portfolioMix). */
(function () {
    'use strict';
    const { money0, esc } = Fmt;
    const LABELS = { us: 'U.S. stocks', intl: 'International stocks', bonds: 'Bonds', cash: 'Cash / money market', other: 'Other (crypto, gold…)' };
    const ui = () => (Store.ui.mix || (Store.ui.mix = { newMoney: 500 }));

    function presets() {
        const age = Number((Store.state.retirement || {}).edadActual) || 40;
        const stocks = Math.max(30, Math.min(90, 110 - age));
        const us = Math.round(stocks * 0.7);
        return [
            { key: 'age', label: `By your age (${stocks}% in stocks)`, mix: { us, intl: stocks - us, bonds: 100 - stocks, cash: 0, other: 0 } },
            { key: 'growth', label: 'All stocks (long term)', mix: { us: 75, intl: 25, bonds: 0, cash: 0, other: 0 } },
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
        if (!document.getElementById('mix-in')) box.innerHTML = `<div class="section-label mt-5"><i class="fa-solid fa-chart-pie text-indigo-600"></i> Your investment mix</div>
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
                <div class="text-xs font-bold text-slate-600 mb-1.5">What is each one?</div>
                <div class="space-y-1.5">${list.map(h => `<label class="flex items-center gap-2 text-xs"><strong class="w-16 shrink-0 truncate" data-i18n-skip>${esc(h.ticker || h.name || '—')}</strong>
                    <select class="input py-1 text-xs" data-change="mix.asset" data-id="${h.id}" aria-label="Class">${Views.selectOptions(opts, Engine.assetClassOf(h))}</select></label>`).join('')}</div>
                <p class="help mt-1.5">Guessed from the ticker of the most common funds; change it if it's wrong.</p>
            </div>
            <div>
                <div class="text-xs font-bold text-slate-600 mb-1.5">Your target mix (%)</div>
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
        UI.text('mix-sum', s.investTarget && Math.round(tSum) !== 100 ? `They add up to ${Math.round(tSum)}%: taken proportionally.` : '');
        UI.html('mix-bars', m.classes.filter(c => c.value > 0 || (c.target || 0) > 0).map(c => {
            const act = !m.hasTarget ? '' : Math.abs(c.diff) < Math.max(25, m.total * 0.005) ? '<span class="text-slate-500">On target</span>'
                : c.diff > 0 ? `<span class="text-emerald-700 font-semibold">Buy ${money0(c.diff)}</span>` : `<span class="text-red-700 font-semibold">Sell ${money0(-c.diff)}</span>`;
            return `<div class="mix-row">
                <div class="flex justify-between gap-2 text-xs"><span class="font-semibold">${LABELS[c.key]}</span><span class="whitespace-nowrap">${money0(c.value)} · <strong>${c.pct.toFixed(0)}%</strong>${m.hasTarget ? ` <span class="text-slate-500">(target ${c.target.toFixed(0)}%)</span>` : ''}</span></div>
                <div class="mix-bar"><div class="mix-fill" style="width:${Math.min(100, c.pct).toFixed(1)}%"></div>${m.hasTarget ? `<div class="mix-target" style="left:${Math.min(100, c.target).toFixed(1)}%" title="Goal"></div>` : ''}</div>
                ${act ? `<div class="text-[11px] text-right">${act}</div>` : ''}
            </div>`;
        }).join(''));
        UI.html('mix-verdict', !m.hasTarget ? '<div class="panel tone-blue text-xs"><i class="fa-solid fa-circle-info"></i> Pick a target mix to see whether you need to rebalance.</div>'
            : m.rebalance ? `<div class="panel tone-amber text-xs"><strong>Your mix has drifted ${m.drift.toFixed(1)} points from the target</strong> (more than 5): time to rebalance, buying and selling as shown, or with your next contributions.</div>`
            : '<div class="panel tone-emerald text-xs"><i class="fa-solid fa-circle-check"></i> Your mix is within 5 points of the target: nothing to move. Check it once a year.</div>');
        UI.show('mix-split-box', m.hasTarget);
        draw('mix-new-in', `<label class="field" style="max-width:11rem"><span class="field-label">Your next contribution ($)</span><input type="number" class="input" min="0" step="50" id="mix-new" data-input="mix.new" value="${esc(String(u.newMoney || ''))}"></label>`);
        UI.html('mix-split', m.split.length ? `<span class="block mb-1">Without selling anything, split that contribution like this:</span>${m.split.map(x => `<span class="flex justify-between gap-3"><span>${LABELS[x.key]}</span><strong>${money0(x.amount)}</strong></span>`).join('')}` : 'Type how much you\'ll invest and we\'ll tell you where to put it.');
        UI.html('mix-gain', m.gain === null ? '' : `${m.gain >= 0 ? 'You\'ve gained' : 'You\'ve lost'} <strong class="${m.gain >= 0 ? 'text-emerald-700' : 'text-red-700'}">${money0(Math.abs(m.gain))}</strong> (${m.gain >= 0 ? '+' : '−'}${Math.abs(m.gainPct * 100).toFixed(1)}%) on ${money0(m.cost)} invested.`);
        UI.html('mix-help', `<span>${Store.COUNTRY === 'US' ? 'Rebalancing with new money avoids selling. Inside a 401(k) or IRA, selling isn\'t taxed; in a regular account, selling at a gain is (less if you held it more than a year).' : 'Rebalancing with new money avoids selling (and the tax the gain may carry).'}</span> <span>Only what's in this table counts, not your retirement accounts.</span>`);
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
            App.undoable('Target mix updated', () => { Store.state.investTarget = Object.assign({}, p.mix); });
        },
        'mix.new': (el) => { ui().newMoney = Math.max(0, Fmt.parseNum(el.value, 0)); fill(App.buildContext()); }
    });

    window.Mix = { render, update: render };
})();
