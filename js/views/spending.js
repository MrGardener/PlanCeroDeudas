/* Reports → Spending: a donut of where the money went, by category, for a month or the last
   3 / 6 months; everyone, the household or one person. Tap a slice (or its row) to list that
   category's transactions under it.
   Reports → Trends: the same categories month by month as stacked areas, with income as a line;
   3 / 6 / 9 / 12 months, all categories or one (then its subcategories), any account. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const RANGES = ['this-month', 'last-month', '3m', '6m'];
    const opts = () => (Store.ui.spending = Object.assign({ range: 'this-month', who: '', cat: null, sub: null, txns: false }, Store.ui.spending));

    function period(range, today) {
        const y = today.getFullYear(), m = today.getMonth(), iso = Engine.isoDate;
        if (range === 'last-month') return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
        if (range === '3m') return [iso(new Date(y, m - 2, 1)), iso(today)];
        if (range === '6m') return [iso(new Date(y, m - 5, 1)), iso(today)];
        return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
    }
    const whoValue = (v) => (v === '' || v === undefined ? undefined : Number(v));
    const name = (r) => (r.key === null ? 'Other categories' : r.key);

    // Level 1: categories. Tap one → level 2: its subcategories, with a banner (total, share of all
    // spending, vs the period before) and "View transactions" (grouped by payee). Back returns.
    function update(ctx) {
        if (!document.getElementById('spend-donut')) return;
        const o = opts(), pal = UI.palette(), who = whoValue(o.who);
        const [from, to] = period(o.range, ctx.today);
        const all = Engine.spendingBreakdown(ctx.state.transactions, { from, to, who });
        if (o.cat && !all.rows.some(x => x.key === o.cat)) { o.cat = null; o.sub = null; o.txns = false; }
        const r = o.cat ? Engine.spendingBreakdown(ctx.state.transactions, { from, to, who, category: o.cat }) : all;
        if (o.sub && !r.rows.some(x => x.key === o.sub)) o.sub = null;
        UI.$$('[data-action="spend.range"]').forEach(b => b.classList.toggle('active', b.dataset.range === o.range));
        UI.html('spend-who', Views.whoOptions(o.who, 'Everyone'));
        // Colors in fixed order; the folded "other" row is gray.
        const color = (row, i) => (row.key === null ? pal.muted : pal.series[i % pal.series.length]);
        const nameOf = (row) => (row.key === null ? (o.cat ? 'Other subcategories' : 'Other categories') : row.key);
        UI.show('spend-empty', !all.rows.length);
        UI.show('spend-body', all.rows.length > 0);
        const picked = o.cat ? o.sub : null;
        UI.html('spend-center', `<span class="donut-total">${money(r.total)}</span><span class="donut-label">${o.cat ? esc(I18n.t(o.cat)) : o.range === 'this-month' ? 'Spent this month' : o.range === 'last-month' ? 'Spent last month' : 'Spent'}</span>`);
        UI.html('spend-legend', (o.cat ? `<button type="button" class="link text-xs mb-1 text-left" data-action="spend.back"><i class="fa-solid fa-arrow-left"></i> All categories</button>` : '')
            + r.rows.map((row, i) => `<button type="button" class="spend-row ${picked === row.key && row.key !== null ? 'is-picked' : ''}" data-action="spend.pick" data-key="${row.key === null ? '' : esc(row.key)}" ${row.key === null ? 'disabled' : ''}>
                <i style="background:${color(row, i)}"></i><span class="spend-name">${esc(nameOf(row))}</span><span class="spend-pct">${Math.round(row.share * 100)}%</span><span class="spend-amt">${money(row.total)}</span></button>`).join('')
            + (r.rows.some(x => x.key === null) ? `<p class="help mt-1">${o.cat ? 'Other subcategories' : 'Other categories'}: ${esc(r.rows.find(x => x.key === null).other.map(k => I18n.t(k)).join(', '))}.</p>` : ''));
        UI.chart('spend-donut', {
            type: 'doughnut',
            data: { labels: r.rows.map(nameOf), datasets: [{ label: 'Spending', data: r.rows.map(x => Math.round(x.total * 100) / 100), backgroundColor: r.rows.map(color), borderColor: pal.surface, borderWidth: 2, hoverOffset: 6, offset: r.rows.map(x => (picked && x.key === picked ? 10 : 0)) }] },
            options: {
                cutout: '66%',
                interaction: { mode: 'nearest', intersect: true },
                plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: (c) => `${c.label}: ${money(c.parsed)} (${Math.round(c.parsed / (r.total || 1) * 100)}%)` } } },
                onClick: (e, els) => { const row = els.length && r.rows[els[0].index]; if (row && row.key !== null) pick(row.key); }
            }
        });
        detail(ctx, { from, to, who, all, r, o });
    }

    // The banner of the picked category (or subcategory) and, on request, its transactions by payee.
    function detail(ctx, { from, to, who, all, r, o }) {
        if (!o.cat) { UI.html('spend-detail', ''); return; }
        const key = o.sub || o.cat, total = o.sub ? (r.rows.find(x => x.key === o.sub) || {}).total || 0 : r.total;
        const prevRange = Engine.shiftRange(from, to, -1);
        const prev = Engine.spendingBreakdown(ctx.state.transactions, { from: prevRange.from, to: prevRange.to, who, category: o.cat, max: 999 });
        const prevTotal = o.sub ? (prev.rows.find(x => x.key === o.sub) || {}).total || 0 : prev.total;
        const diff = total - prevTotal;
        const inCat = (t) => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === o.cat && (!o.sub || (t.category || o.cat) === o.sub) && (who === undefined || t.memberId === who);
        let list = '';
        if (o.txns) {
            const byPayee = {};
            ctx.state.transactions.filter(inCat).forEach(t => { const k = (t.description || t.store || '—').trim(); const g = byPayee[k] || (byPayee[k] = { name: k, total: 0, n: 0 }); g.total += Engine.spendAmount(t); g.n++; });
            const rows = Object.values(byPayee).sort((a, b) => b.total - a.total);
            list = `<div class="acd-txns mt-2">${rows.map(g => `<div class="acd-txn" style="grid-template-columns:1fr auto auto"><span class="truncate font-semibold" data-i18n-skip>${esc(g.name)}</span><span class="text-xs text-slate-500 whitespace-nowrap">${g.n}×</span><span class="font-semibold whitespace-nowrap">${money(g.total)}</span></div>`).join('')}</div>`;
        }
        UI.html('spend-detail', `<div class="spend-banner">
                <div><strong>${esc(I18n.t(key))}</strong>${o.sub ? ` <span class="text-slate-500 text-xs">· ${esc(I18n.t(o.cat))}</span>` : ''}</div>
                <div class="text-sm"><span class="font-bold">${money(total)}</span> · ${all.total ? Math.round(total / all.total * 100) : 0}% of all spending</div>
                <div class="text-xs ${diff > 0.5 ? 'text-red-600' : diff < -0.5 ? 'text-emerald-700' : 'text-slate-500'}">${Math.abs(diff) < 0.5 ? 'Same as the period before' : `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))} vs the period before`}</div>
                <button type="button" class="btn btn-secondary btn-sm mt-2" data-action="spend.txns" aria-pressed="${!!o.txns}"><i class="fa-solid fa-list-ul"></i> ${o.txns ? 'Hide transactions' : 'View transactions'}</button>
            </div>${list}`);
    }

    // ------------------------------------------------------------------ trends
    const topts = () => (Store.ui.trends = Object.assign({ months: 6, category: '', account: '' }, Store.ui.trends));

    function trends(ctx) {
        if (!document.getElementById('trends-chart')) return;
        const o = topts(), pal = UI.palette(), s = ctx.state;
        const r = Engine.categoryTrend(s.transactions, { end: ctx.today, months: o.months, account: o.account, category: o.category });
        UI.$$('[data-action="trends.months"]').forEach(b => b.classList.toggle('active', Number(b.dataset.months) === o.months));
        const back = document.getElementById('trends-back');
        if (back) back.style.display = o.category ? '' : 'none';
        UI.html('trends-category', Views.selectOptions([{ value: '', label: 'All categories' }].concat(Object.keys(s.taxonomy.expense).map(c => ({ value: c, label: c }))), o.category));
        const accts = s.accounts || [];
        UI.html('trends-account', Views.selectOptions([{ value: '', label: 'All accounts' }].concat(accts.map(a => ({ value: String(a.id), label: a.name })), [{ value: 'none', label: 'No account' }]), o.account));
        const any = r.series.length > 0;
        UI.show('trends-empty', !any);
        UI.show('trends-body', any);
        if (!any) return;
        const label = (k) => { const [y, m] = k.split('-'); return `${Fmt.MONTH_SHORT[Number(m) - 1]}${r.months.some(x => x.slice(0, 4) !== y) ? ' ' + y.slice(2) : ''}`; };
        const name = (x) => (x.key === null ? (o.category ? 'Other subcategories' : 'Other categories') : x.key);
        const color = (x, i) => (x.key === null ? pal.muted : pal.series[i % pal.series.length]);
        // The focused band (tapped) stays strong; the others step back.
        const fkey = (x) => (x.key === null ? '__other' : x.key);
        if (o.focus && !(o.focus === '__income' && r.income) && !r.series.some(x => fkey(x) === o.focus)) o.focus = null;
        const dim = (x) => o.focus && fkey(x) !== o.focus;
        const datasets = r.series.map((x, i) => ({ label: name(x), data: x.values.map(v => Math.round(v * 100) / 100), stack: 'spend', fill: i === 0 ? 'origin' : '-1',
            backgroundColor: color(x, i) + (dim(x) ? '40' : 'b3'), borderColor: color(x, i) + (dim(x) ? '66' : ''), borderWidth: 2, pointRadius: 3, pointHoverRadius: 5,
            pointBackgroundColor: pal.surface, pointBorderColor: color(x, i), pointBorderWidth: 2, tension: 0.4 }));
        if (r.income) datasets.push({ label: 'Income', data: r.income.map(v => Math.round(v * 100) / 100), stack: 'income', fill: false, borderColor: pal.text, backgroundColor: pal.text, borderWidth: 3, pointRadius: 3, pointBackgroundColor: pal.surface, pointBorderWidth: 2, tension: 0.4 });
        UI.chart('trends-chart', {
            type: 'line',
            data: { labels: r.months.map(label), datasets },
            options: { scales: { y: { stacked: true } }, plugins: { legend: { position: 'bottom' } },
                // Tap a band: its months in a card; tap it again (or "Open") to see its subcategories.
                // Tap above the bands: that month's breakdown.
                onClick: (e, els, chart) => {
                    const i = els.length ? els[0].index : Math.round(chart.scales.x.getValueForPixel(e.x));
                    if (!(i >= 0 && i < r.months.length)) return;
                    const k = r.months[i];
                    // On (or near) the income line: its card.
                    const inc = r.income ? chart.getDatasetMeta(chart.data.datasets.length - 1).data[i] : null;
                    if (inc && Math.abs(e.y - inc.y) <= 14) { o.focus = '__income'; o.focusMonth = k; App.update(); return; }
                    const band = Engine.bandAt(r.series.map(x => x.values), i, chart.scales.y.getValueForPixel(e.y));
                    if (band === null) { o.focus = null; o.drill = o.drill && o.drill.month === k && !o.drill.cat ? null : { month: k, cat: null, sub: null }; App.update(); return; }
                    const x = r.series[band], key = fkey(x);
                    if (o.focus === key && o.focusMonth === k) {
                        if (!o.category && x.key !== null) { openCategory(x.key); return; }
                        if (o.category) { openTxns(o, x, k, label); return; }
                    }
                    o.focus = key; o.focusMonth = k; o.drill = { month: k, cat: null, sub: null };
                    App.update();
                } }
        });
        focusCard(o, r, label, name, color, fkey);
        drill(ctx, o, r, label);
        const now = Engine.isoDate(ctx.today).slice(0, 7);
        UI.text('trends-note', r.months[r.months.length - 1] === now ? 'This month isn\'t over yet.' : '');
        UI.html('trends-head', `<tr><th>Month</th><th class="num">Spending</th>${r.income ? '<th class="num">Income</th><th class="num">Left over</th>' : ''}</tr>`);
        UI.html('trends-table', r.months.map((k, i) => `<tr><td>${esc(label(k))}</td><td class="num">${money(r.spend[i])}</td>${r.income ? `<td class="num">${money(r.income[i])}</td><td class="num ${r.income[i] - r.spend[i] < 0 ? 'text-red-600' : ''}">${money(r.income[i] - r.spend[i])}</td>` : ''}</tr>`).join(''));
    }

    // The tapped band's card: its amount each month (the tapped month marked), and "Open" to see
    // a category's subcategories.
    function focusCard(o, r, label, name, color, fkey) {
        const host = document.getElementById('trends-focus');
        if (!host) return;
        const pal = UI.palette();
        const income = o.focus === '__income' && r.income ? { key: '__income', values: r.income } : null;
        const i = income ? -1 : r.series.findIndex(x => fkey(x) === o.focus);
        if (i < 0 && !income) { host.innerHTML = ''; return; }
        const x = income || r.series[i];
        if (income) { name = () => 'Income'; color = () => pal.text; }
        host.innerHTML = `<div class="spend-banner">
            <div class="flex items-center justify-between gap-2"><strong><i class="inline-block w-3 h-3 rounded-sm align-middle mr-1" style="background:${color(x, i)}"></i> ${esc(I18n.t(name(x)))}</strong>
                <button type="button" class="row-del" data-action="trends.unfocus" aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
            <div class="trend-months">${r.months.map((k, j) => `<div class="${k === o.focusMonth ? 'is-now' : ''}"><span>${esc(label(k))}</span><strong>${money0(x.values[j])}</strong></div>`).join('')}</div>
            ${income ? '' : !o.category && x.key !== null ? `<button type="button" class="btn btn-secondary btn-sm mt-2 self-start" data-action="trends.open" data-key="${esc(x.key)}">Open ${esc(I18n.t(x.key))} <i class="fa-solid fa-arrow-right"></i></button>`
                : o.category ? `<button type="button" class="btn btn-secondary btn-sm mt-2 self-start" data-action="trends.txns"><i class="fa-solid fa-list-ul"></i> Transactions in ${esc(label(o.focusMonth))}</button>` : ''}
        </div>`;
    }
    // A subcategory's transactions in one month (inside a category's view), in a sheet with a back
    // arrow to the chart. "Other subcategories" lists all the folded ones.
    let txnSheet = null;
    function openTxns(o, x, monthKey, label) {
        const [y, m] = monthKey.split('-').map(Number), from = `${monthKey}-01`, to = Engine.isoDate(new Date(y, m, 0));
        const subs = x.key === null ? x.other : [x.key], accts = Store.state.accounts || [];
        const list = Store.state.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === o.category
            && subs.includes(t.category || o.category) && (!o.account || (o.account === 'none' ? !t.accountId : String(t.accountId) === String(o.account))))
            .sort((a, b) => b.date.localeCompare(a.date));
        const title = `${I18n.t(x.key === null ? 'Other subcategories' : x.key)} · ${label(monthKey)}`;
        txnSheet = UI.sheet({ title: 'Transactions', icon: 'fa-list-ul', wide: true, html: `
            <div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="trends.txnsBack" aria-label="Back to the chart"><i class="fa-solid fa-arrow-left"></i></button><strong data-i18n-skip>${esc(title)}</strong></div>
            <div class="acd-txns">${list.map(t => { const a = accts.find(z => z.id === t.accountId); return `<button type="button" class="acd-txn w-full text-left" style="grid-template-columns:4.6rem 1fr auto" data-action="trends.txnOpen" data-id="${t.id}">
                <span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span>
                <span class="min-w-0"><span class="block truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="block truncate text-[11px] text-slate-500"><span>${esc(I18n.t(t.category || t.parentCategory || ''))}</span>${a ? ` · <span data-i18n-skip>${esc(a.name)}</span>` : ''}</span></span>
                <span class="font-semibold whitespace-nowrap">${money(Engine.spendAmount(t))}</span></button>`; }).join('')}</div>
            <p class="text-center text-xs text-slate-400 mt-3">${list.length ? 'End of the list' : 'No transactions.'}</p>` });
    }

    function openCategory(key) {
        const o = topts();
        o.category = key; o.focus = null; o.drill = null;
        App.update();
        const card = document.getElementById('trends-card');
        if (card) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
    }

    // Level 1 → a category; level 2 → a subcategory (tap again to unpick).
    // Tap a month: its categories vs the period's average; a category: its subcategories; a
    // subcategory: its transactions. "Back" goes up a level.
    function drill(ctx, o, r, label) {
        const host = document.getElementById('trends-drill');
        if (!host) return;
        const d = o.drill;
        if (!d || !r.months.includes(d.month)) { o.drill = null; host.innerHTML = '<p class="help"><i class="fa-solid fa-hand-pointer"></i> Tap a month on the chart to see what changed.</p>'; return; }
        const idx = r.months.indexOf(d.month), s = ctx.state;
        const cat = o.category || d.cat;   // the chart already shows one category: its subcategories
        const head = (title, back) => `<div class="flex items-center justify-between gap-2 mb-2"><strong class="text-sm">${title}</strong>${back ? `<button type="button" class="link text-xs" data-action="trends.up"><i class="fa-solid fa-arrow-left"></i> Back</button>` : ''}</div>`;
        const month = esc(label(d.month));
        if (d.sub) {
            const [y, m] = d.month.split('-').map(Number), from = `${d.month}-01`, to = Engine.isoDate(new Date(y, m, 0));
            const acc = o.account;
            const list = s.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === cat && (t.category || cat) === d.sub
                && (!acc || (acc === 'none' ? !t.accountId : String(t.accountId) === String(acc)))).sort((a, b) => Engine.spendAmount(b) - Engine.spendAmount(a));
            host.innerHTML = head(`${month} · ${esc(I18n.t(d.sub))}`, true) + `<div class="acd-txns">${list.map(t => `<div class="acd-txn"><span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span><span class="truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="font-semibold whitespace-nowrap">${money(Engine.spendAmount(t))}</span></div>`).join('') || '<p class="help">No transactions.</p>'}</div>`;
            return;
        }
        const tr = cat ? Engine.categoryTrend(s.transactions, { end: ctx.today, months: o.months, account: o.account, category: cat, max: 999 }) : Engine.categoryTrend(s.transactions, { end: ctx.today, months: o.months, account: o.account, max: 999 });
        const rows = Engine.monthVsAverage(tr, idx), total = rows.reduce((a, x) => a + x.value, 0);
        host.innerHTML = head(`${month}${cat ? ` · ${esc(I18n.t(cat))}` : ''} · ${money(total)}`, !!d.cat) + `<div class="spend-legend">${rows.map(x => `<button type="button" class="spend-row" style="grid-template-columns:1fr auto 5.5rem" data-action="trends.drill" data-key="${esc(x.key)}">
                <span class="spend-name">${esc(I18n.t(x.key))}</span>
                <span class="text-[11px] whitespace-nowrap ${x.diff > 0.5 ? 'text-red-600' : x.diff < -0.5 ? 'text-emerald-700' : 'text-slate-500'}">${Math.abs(x.diff) < 0.5 ? '= avg' : `${x.diff > 0 ? '▲' : '▼'} ${money0(Math.abs(x.diff))} vs avg`}</span>
                <span class="spend-amt">${money(x.value)}</span></button>`).join('') || '<p class="help">No spending that month.</p>'}</div>`;
    }

    function pick(key) {
        const o = opts();
        if (!key) { o.cat = null; o.sub = null; o.txns = false; }
        else if (!o.cat) { o.cat = key; o.sub = null; o.txns = false; }
        else o.sub = o.sub === key ? null : key;
        App.update();
    }

    UI.register({
        'spend.range': (el) => { if (RANGES.includes(el.dataset.range)) { opts().range = el.dataset.range; App.update(); } },
        'spend.who': (el) => { opts().who = el.value; App.update(); },
        'spend.pick': (el) => pick(el.dataset.key || null),
        'spend.back': () => pick(null),
        'spend.txns': () => { const o = opts(); o.txns = !o.txns; App.update(); },
        'trends.open': (el) => openCategory(el.dataset.key),
        'trends.txns': () => {
            const o = topts(), ctx = App.buildContext();
            const r = Engine.categoryTrend(ctx.state.transactions, { end: ctx.today, months: o.months, account: o.account, category: o.category });
            const x = r.series.find(z => (z.key === null ? '__other' : z.key) === o.focus);
            const label = (k) => { const [y, m] = k.split('-'); return `${Fmt.MONTH_SHORT[Number(m) - 1]}${r.months.some(z => z.slice(0, 4) !== y) ? ' ' + y.slice(2) : ''}`; };
            if (x && o.focusMonth) openTxns(o, x, o.focusMonth, label);
        },
        'trends.txnsBack': () => { if (txnSheet) { txnSheet.close(); txnSheet = null; } },
        'trends.txnOpen': (el) => { if (txnSheet) { txnSheet.close(); txnSheet = null; } if (window.TxnDetails) TxnDetails.open(Number(el.dataset.id)); },
        'trends.back': () => { const o = topts(); o.category = ''; o.focus = null; o.drill = null; App.update(); },
        'trends.unfocus': () => { topts().focus = null; App.update(); },
        'trends.drill': (el) => { const o = topts(); if (!o.drill) return; if (o.category || o.drill.cat) o.drill.sub = el.dataset.key; else o.drill.cat = el.dataset.key; App.update(); },
        'trends.up': () => { const o = topts(); if (!o.drill) return; if (o.drill.sub) o.drill.sub = null; else o.drill.cat = null; App.update(); },
        'trends.months': (el) => { topts().months = Math.max(1, Math.min(12, Number(el.dataset.months) || 6)); App.update(); },
        'trends.category': (el) => { const o = topts(); o.category = el.value; o.focus = null; o.drill = null; App.update(); },
        'trends.account': (el) => { topts().account = el.value; App.update(); }
    });

    window.Spending = { update: (ctx) => { update(ctx); trends(ctx); } };
})();
