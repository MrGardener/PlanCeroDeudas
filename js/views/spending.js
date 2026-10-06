/* Reports → Spending: a donut of where the money went, by category, for a month or the last
   3 / 6 months; everyone, the household or one person. Tap a slice (or its row) to list that
   category's transactions under it. */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    const RANGES = ['this-month', 'last-month', '3m', '6m'];
    const opts = () => (Store.ui.spending = Object.assign({ range: 'this-month', who: '', pick: null }, Store.ui.spending));

    function period(range, today) {
        const y = today.getFullYear(), m = today.getMonth(), iso = Engine.isoDate;
        if (range === 'last-month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
        if (range === '3m') return [iso(new Date(y, m - 2, 1)), iso(today)];
        if (range === '6m') return [iso(new Date(y, m - 5, 1)), iso(today)];
        return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    }
    const whoValue = (v) => (v === '' || v === undefined ? undefined : Number(v));
    const name = (r) => (r.key === null ? 'Other categories' : r.key);

    function update(ctx) {
        if (!document.getElementById('spend-donut')) return;
        const o = opts(), pal = UI.palette();
        const [from, to] = period(o.range, ctx.today);
        const r = Engine.spendingBreakdown(ctx.state.transactions, { from, to, who: whoValue(o.who) });
        UI.$$('[data-action="spend.range"]').forEach(b => b.classList.toggle('active', b.dataset.range === o.range));
        UI.html('spend-who', Views.whoOptions(o.who, 'Everyone'));
        // Colors in fixed order; the folded "other" row is gray.
        const color = (row, i) => (row.key === null ? pal.muted : pal.series[i % pal.series.length]);
        UI.show('spend-empty', !r.rows.length);
        UI.show('spend-body', r.rows.length > 0);
        if (!r.rows.some(x => x.key === o.pick)) o.pick = null;
        UI.html('spend-center', `<span class="donut-total">${money(r.total)}</span><span class="donut-label">${o.range === 'this-month' ? 'Spent this month' : o.range === 'last-month' ? 'Spent last month' : 'Spent'}</span>`);
        UI.html('spend-legend', r.rows.map((row, i) => `<button type="button" class="spend-row ${o.pick === row.key && row.key !== null ? 'is-picked' : ''}" data-action="spend.pick" data-key="${row.key === null ? '' : esc(row.key)}" ${row.key === null ? 'disabled' : ''}>
                <i style="background:${color(row, i)}"></i><span class="spend-name">${esc(name(row))}</span><span class="spend-pct">${Math.round(row.share * 100)}%</span><span class="spend-amt">${money(row.total)}</span></button>`).join('')
            + (r.rows.some(x => x.key === null) ? `<p class="help mt-1">Other categories: ${esc(r.rows.find(x => x.key === null).other.map(k => I18n.t(k)).join(', '))}.</p>` : ''));
        UI.chart('spend-donut', {
            type: 'doughnut',
            data: { labels: r.rows.map(name), datasets: [{ label: 'Spending', data: r.rows.map(x => Math.round(x.total * 100) / 100), backgroundColor: r.rows.map(color), borderColor: pal.surface, borderWidth: 2, hoverOffset: 6 }] },
            options: {
                cutout: '66%',
                interaction: { mode: 'nearest', intersect: true },
                plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: (c) => `${c.label}: ${money(c.parsed)} (${Math.round(c.parsed / (r.total || 1) * 100)}%)` } } },
                onClick: (e, els) => { const row = els.length && r.rows[els[0].index]; if (row && row.key !== null) pick(row.key); }
            }
        });
        detail(ctx, from, to, o);
    }

    // The picked category's transactions in the period, biggest first.
    function detail(ctx, from, to, o) {
        if (o.pick === null) { UI.html('spend-detail', ''); return; }
        const who = whoValue(o.who);
        const list = ctx.state.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === o.pick && (who === undefined || t.memberId === who))
            .sort((a, b) => Engine.spendAmount(b) - Engine.spendAmount(a));
        const shown = list.slice(0, 25);
        UI.html('spend-detail', `<div class="flex items-center justify-between gap-2 mb-1"><strong class="text-sm">${esc(I18n.t(o.pick))}</strong><button type="button" class="row-del" data-action="spend.pick" data-key="" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="table-wrap"><table class="table"><tbody>${shown.map(t => `<tr><td class="whitespace-nowrap text-xs">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</td><td data-i18n-skip>${esc(t.description || t.store || '—')}</td><td class="text-xs text-slate-500">${esc(t.category || '')}</td><td class="num font-semibold">${money(Engine.spendAmount(t))}</td></tr>`).join('')}</tbody></table></div>`
            + (list.length > shown.length ? `<p class="help mt-1">The 25 biggest of ${list.length}.</p>` : ''));
    }

    function pick(key) { const o = opts(); o.pick = o.pick === key ? null : key; App.update(); }

    UI.register({
        'spend.range': (el) => { if (RANGES.includes(el.dataset.range)) { opts().range = el.dataset.range; App.update(); } },
        'spend.who': (el) => { opts().who = el.value; App.update(); },
        'spend.pick': (el) => pick(el.dataset.key || null)
    });

    window.Spending = { update };
})();
