/* Reports → Spending (like the bank's): a donut of where the money went (or came from: Income
   tab), by category, for any date range stepped with ‹ ›; everyone, the household or one person.
   Tap a slice or row to select it, again to open its subcategories (inner ring, "‹ Back"); the
   middle lists the transactions of what's selected, and each opens its details.
   Reports → Trends: the same categories month by month as stacked areas, with income as a line;
   3 / 6 / 9 / 12 months, all categories or one (then its subcategories), any account. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    // State: the date range (a preset or from–to, stepped with ‹ ›), whose, Spending or Income,
    // the opened category (its subcategories in an inner ring) and the selected slice.
    const opts = () => {
        const o = (Store.ui.spending = Object.assign({ range: 'this-month', from: null, to: null, who: '', kind: 'spend', cat: null, pick: null }, Store.ui.spending));
        if (!o.from || !o.to || ['this-month', 'last-month', '3m', '6m'].includes(o.range) && !o.fixed) {
            const legacy = { '3m': '90d', '6m': '90d' }[o.range];
            if (legacy) o.range = legacy;
            Object.assign(o, Engine.rangeFor(o.range === 'custom' ? 'this-month' : o.range, new Date()));
            o.fixed = true;
        }
        return o;
    };
    const RANGE_LABELS = { today: 'Today', 'this-month': 'This month', 'last-month': 'Last month', '7d': 'Last 7 days', '30d': 'Last 30 days', '90d': 'Last 90 days', 'this-year': 'This year' };
    const dayLabel = (iso) => { const d = new Date(iso + 'T00:00:00'); return `${Fmt.dayMonth(d)}, ${d.getFullYear()}`; };
    const whoValue = (v) => (v === '' || v === undefined ? undefined : Number(v));
    // Shades of a category's color for its subcategories (lighter as they go).
    function shade(hex, t) {
        const n = parseInt(String(hex).slice(1), 16), r = n >> 16, g = (n >> 8) & 255, b = n & 255, m = (c) => Math.round(c + (255 - c) * t);
        return `#${[m(r), m(g), m(b)].map(c => c.toString(16).padStart(2, '0')).join('')}`;
    }

    // Level 1: categories; tap one to select it (center and total show it), tap again to open it:
    // its subcategories in an inner ring, the rest faded, "‹ Back" in the list. The middle lists the
    // transactions of what's selected.
    let view = null;
    function update(ctx) {
        if (!document.getElementById('spend-donut')) return;
        const o = opts(), pal = UI.palette(), who = whoValue(o.who), type = o.kind === 'income' ? 'Ingreso' : 'Gasto';
        UI.text('spend-range-label', o.range !== 'custom' && RANGE_LABELS[o.range] ? `${I18n.t(RANGE_LABELS[o.range])} · ${dayLabel(o.from)} – ${dayLabel(o.to)}` : `${dayLabel(o.from)} – ${dayLabel(o.to)}`);
        UI.html('spend-who', Views.whoOptions(o.who, 'Everyone'));
        UI.$$('[data-action="spend.kind"]').forEach(b => b.classList.toggle('active', b.dataset.kind === o.kind));
        const all = Engine.spendingBreakdown(ctx.state.transactions, { from: o.from, to: o.to, who, type });
        if (o.cat && !all.rows.some(x => x.key === o.cat)) { o.cat = null; o.pick = null; }
        const subs = o.cat ? Engine.spendingBreakdown(ctx.state.transactions, { from: o.from, to: o.to, who, type, category: o.cat }) : null;
        const level = subs || all;
        if (o.pick !== null && !level.rows.some(x => x.key === o.pick)) o.pick = null;
        // Income has one color family (it's one kind of money); spending uses the categorical palette.
        const color = (row, i) => (row.key === null ? pal.muted : o.kind === 'income' ? shade(pal.text, Math.min(0.75, i * 0.18)) : pal.series[i % pal.series.length]);
        const catIndex = o.cat ? all.rows.findIndex(x => x.key === o.cat) : -1;
        const catColor = o.cat ? color(all.rows[catIndex], catIndex) : null;
        const subColor = (row, i) => (row.key === null ? pal.muted : shade(catColor, Math.min(0.7, i * 0.2)));
        const nameOf = (row) => (row.key === null ? (o.cat ? 'Other subcategories' : 'Other categories') : row.key);
        view = { o, all, subs, level, from: o.from, to: o.to, who, type };
        UI.show('spend-empty', !all.rows.length);
        UI.show('spend-legend', all.rows.length > 0);
        const sel = o.pick !== null ? level.rows.find(x => x.key === o.pick) : null;
        const centerName = sel ? nameOf(sel) : o.cat ? o.cat : 'Total amount';
        const centerAmt = sel ? sel.total : level.total;
        UI.html('spend-center', `<span class="donut-label font-bold" data-i18n-skip>${esc(I18n.t(centerName))}</span><span class="donut-total">${money(centerAmt)}</span><span class="donut-label">Select to view transactions</span>`);
        const rowsHTML = level.rows.map((row, i) => {
            const c = o.cat ? subColor(row, i) : color(row, i), picked = o.pick !== null && row.key === o.pick;
            return `<button type="button" class="spend-row ${picked ? 'is-picked' : ''}" style="${picked ? `background:${c}26;box-shadow:inset 4px 0 0 ${c}` : ''}" data-action="spend.pick" data-key="${row.key === null ? '' : esc(row.key)}" ${row.key === null ? 'disabled' : ''}>
                <i style="background:${c}"></i><span class="spend-name">${esc(I18n.t(nameOf(row)))}</span><span class="spend-pct">${Math.round(row.share * 100)}%</span><span class="spend-amt">${money(row.total)}</span></button>`;
        }).join('');
        // An opened category: its share of everything and how it compares with the period before.
        let compare = '';
        if (o.cat) {
            const pr = Engine.shiftRange(o.from, o.to, -1), prev = Engine.spendingBreakdown(ctx.state.transactions, { from: pr.from, to: pr.to, who, type, category: o.cat, max: 999 });
            const diff = level.total - prev.total, kindWord = o.kind === 'income' ? 'of all income' : 'of all spending';
            compare = `<p class="text-xs text-slate-500 mb-1"><span>${all.total ? Math.round(level.total / all.total * 100) : 0}% ${kindWord}</span> · <span class="${o.kind === 'income' ? '' : diff > 0.5 ? 'text-red-600' : diff < -0.5 ? 'text-emerald-700' : ''}">${Math.abs(diff) < 0.5 ? 'Same as the period before' : `${diff > 0 ? '▲' : '▼'} ${money(Math.abs(diff))} vs the period before`}</span></p>`;
        }
        UI.html('spend-legend', (o.cat ? '<button type="button" class="link text-sm mb-1 text-left" data-action="spend.back"><i class="fa-solid fa-chevron-left"></i> Back</button>' + compare : '')
            + rowsHTML
            + (level.rows.some(x => x.key === null) ? `<p class="help mt-1">${o.cat ? 'Other subcategories' : 'Other categories'}: ${esc(level.rows.find(x => x.key === null).other.map(k => I18n.t(k)).join(', '))}.</p>` : '')
            + `<div class="spend-total">Total: ${money(sel ? sel.total : level.total)}</div>`
            + (!o.cat && sel && sel.key !== null ? `<button type="button" class="btn btn-secondary btn-sm mt-2" data-action="spend.open" data-key="${esc(sel.key)}">Open ${esc(I18n.t(sel.key))} <i class="fa-solid fa-arrow-right"></i></button>` : ''));
        const ring = (rows, colors, faded) => ({ data: rows.map(x => Math.round(x.total * 100) / 100), backgroundColor: rows.map((x, i) => (faded ? colors(x, i) + '59' : colors(x, i))), borderColor: pal.surface, borderWidth: 2, hoverOffset: faded ? 0 : 6,
            offset: rows.map(x => (!faded && o.pick !== null && x.key === o.pick ? 8 : 0)) });
        const datasets = o.cat ? [ring(all.rows, color, true), ring(subs.rows, subColor, false)] : [ring(all.rows, color, false)];
        UI.chart('spend-donut', {
            type: 'doughnut',
            data: { labels: (o.cat ? all.rows : level.rows).map(x => nameOf(x)), datasets },
            options: {
                cutout: o.cat ? '50%' : '66%',
                interaction: { mode: 'nearest', intersect: true },
                plugins: { legend: { display: false }, tooltip: { callbacks: { title: () => '', label: (c) => { const rows = o.cat && c.datasetIndex === 1 ? subs.rows : all.rows; const x = rows[c.dataIndex]; return x ? `${I18n.t(x.key === null ? (o.cat && c.datasetIndex === 1 ? 'Other subcategories' : 'Other categories') : x.key)}: ${money(x.total)}` : ''; } } } },
                onClick: (e, els) => {
                    if (!els.length) return;
                    const el = els[0];
                    if (o.cat && el.datasetIndex === 0) { const x = all.rows[el.index]; if (x && x.key !== null) { o.cat = x.key; o.pick = null; App.update(); } return; }
                    const x = level.rows[el.index];
                    if (x && x.key !== null) pick(x.key);
                }
            }
        });
    }

    // Tap: select; tap the selected one again: open it (categories only).
    function pick(key) {
        const o = opts();
        if (!key) return;
        if (o.pick === key && !o.cat) { o.cat = key; o.pick = null; }
        else o.pick = o.pick === key ? null : key;
        App.update();
    }

    // The transactions of what's selected (or of everything shown), in a sheet with ← back; a
    // transaction opens its details, whose ← comes back here.
    let spendSheet = null;
    function openSpendTxns() {
        const v = view;
        if (!v) return;
        const o = v.o, sel = o.pick, accts = Store.state.accounts || [];
        const inLevel = (t) => (t.type || 'Gasto') === v.type && !Engine.isTransfer(t) && t.date >= v.from && t.date <= v.to && (v.who === undefined || t.memberId === v.who);
        const match = (t) => {
            const cat = t.parentCategory || 'Otros', sub = t.category || cat;
            if (!o.cat) return sel === null || cat === sel;
            return cat === o.cat && (sel === null || sub === sel);
        };
        const list = Store.state.transactions.filter(t => inLevel(t) && match(t)).sort((a, b) => b.date.localeCompare(a.date));
        const title = sel !== null ? I18n.t(sel) : o.cat ? I18n.t(o.cat) : I18n.t(o.kind === 'income' ? 'Income' : 'Spending');
        spendSheet = UI.sheet({ title: 'Transactions', icon: 'fa-list-ul', wide: true, html: `
            <div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="spend.txnsBack" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong data-i18n-skip>${esc(title)} · ${esc(dayLabel(v.from))} – ${esc(dayLabel(v.to))}</strong></div>
            <div class="acd-txns">${list.map(t => { const a = accts.find(z => z.id === t.accountId), inc = (t.type || 'Gasto') === 'Ingreso'; return `<button type="button" class="acd-txn w-full text-left" style="grid-template-columns:4.6rem 1fr auto" data-action="spend.txnOpen" data-id="${t.id}">
                <span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span>
                <span class="min-w-0"><span class="block truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="block truncate text-[11px] text-slate-500"><span>${esc(I18n.t(t.category || t.parentCategory || ''))}</span>${a ? ` · <span data-i18n-skip>${esc(a.name)}</span>` : ''}</span></span>
                <span class="font-semibold whitespace-nowrap ${inc ? 'text-emerald-700' : ''}">${inc ? '+' : ''}${money(inc ? Number(t.amount) || 0 : Engine.spendAmount(t))}</span></button>`; }).join('')}</div>
            <p class="text-center text-xs text-slate-400 mt-3">${list.length ? 'End of the list' : 'No transactions.'}</p>` });
    }

    // Date range picker: presets or from–to (like Transactions).
    let rangeSheet = null;
    function pickRange() {
        const o = opts();
        rangeSheet = UI.sheet({ title: 'Select a range', icon: 'fa-calendar', html: `
            <div class="range-list">${Object.keys(RANGE_LABELS).map(k => `<button type="button" class="${o.range === k ? 'active' : ''}" data-action="spend.rangeSet" data-range="${k}">${o.range === k ? '<i class="fa-solid fa-circle-check"></i>' : '<i class="fa-regular fa-circle"></i>'} ${RANGE_LABELS[k]}</button>`).join('')}</div>
            <div class="grid grid-cols-2 gap-3 mt-3">
                <label class="field"><span class="field-label">From</span><input type="date" id="spend-range-from" class="input" value="${esc(o.from || '')}"></label>
                <label class="field"><span class="field-label">To</span><input type="date" id="spend-range-to" class="input" value="${esc(o.to || '')}"></label>
            </div>
            <div class="flex justify-end mt-3"><button type="button" class="btn btn-primary" data-action="spend.rangeCustom">Show these dates</button></div>` });
    }
    function setRange(patch) {
        Object.assign(opts(), patch, { cat: null, pick: null });
        if (rangeSheet) { rangeSheet.close(); rangeSheet = null; }
        App.update();
    }

    // ------------------------------------------------------------------ trends
    // One settings object (the chart's tap handler keeps a reference to it): filled in once.
    const topts = () => {
        const t = Store.ui.trends;
        if (!t || t.zoom === undefined || t.tzoom === undefined) Store.ui.trends = Object.assign({ months: 6, category: '', account: '', zoom: 1, zoomAt: null, tzoom: 1, tcenter: null }, t);
        return Store.ui.trends;
    };

    // The dates showing (Engine.trendWindow: the period, or less of it zoomed in on the dates) and
    // the trend over them: by month, by week or by day.
    let shownWindow = null;
    function trendData(ctx, o, extra) {
        const w = Engine.trendWindow({ end: ctx.today, months: o.months, zoom: o.tzoom, center: o.tcenter });
        return Engine.categoryTrend(ctx.state.transactions, Object.assign({ end: ctx.today, months: o.months, account: o.account, category: o.category }, w.zoom > 1 ? { from: w.from, to: w.to, unit: w.unit } : {}, extra || {}));
    }
    const dateOf = (iso) => new Date(iso + 'T00:00:00');
    const addDays = (iso, n) => { const d = dateOf(iso); d.setDate(d.getDate() + Math.round(n)); return Engine.isoDate(d); };
    // A point's name on the chart ("Mar", "Mar 14") and in sentences ("Week of March 14").
    function labeler(r) {
        const short = (k) => {
            if (r.unit === 'month') { const [y, m] = k.split('-'); return `${Fmt.MONTH_SHORT[Number(m) - 1]}${r.months.some(x => x.slice(0, 4) !== y) ? ' ' + y.slice(2) : ''}`; }
            const d = dateOf(k);
            return `${Fmt.MONTH_SHORT[d.getMonth()]} ${d.getDate()}`;
        };
        short.long = (k) => (r.unit === 'month' ? short(k) : r.unit === 'week' ? `${I18n.t('Week of')} ${Fmt.dayMonth(dateOf(k))}` : `${Fmt.WEEKDAYS[dateOf(k).getDay()]} ${Fmt.dayMonth(dateOf(k))}`);
        return short;
    }
    // The middle date of a point (where zooming in on it should center).
    function pointMiddle(r, k) {
        const [f, t] = Engine.trendPointRange(r, k);
        return addDays(f, Math.floor((dateOf(t) - dateOf(f)) / 86400000 / 2));
    }

    // Zoom on the dates: fewer days across the chart, so each one's bands get wider (and, by week or
    // by day, small spending gets its own visible step). ◀ ▶ or a drag sideways moves in time.
    let redraw = 0;
    function setTimeZoom(zoom, center) {
        const o = topts();
        o.tzoom = Math.max(1, Number(zoom) || 1);
        if (center) o.tcenter = center;
        if (o.tzoom <= 1) o.tcenter = null;
        if (redraw) return;
        redraw = requestAnimationFrame(() => { redraw = 0; trends(App.buildContext()); });
    }
    function timeZoomCenter(o) {
        if (o.focusMonth && trendsSeries && trendsSeries.months.includes(o.focusMonth)) return pointMiddle(trendsSeries, o.focusMonth);
        // Nothing tapped: from the latest days (as long as they're showing), else where the zoom is.
        const today = Engine.isoDate(new Date());
        return !shownWindow || shownWindow.zoom <= 1 || shownWindow.to >= today ? today : shownWindow.center;
    }

    // Zoom: thin bands (small categories) get tall enough to tap. The chart shows 1/zoom of its
    // height around zoomAt; drag (or ▲ ▼) moves up and down, pinch or Ctrl+wheel zooms.
    let zoomTop = 0, trendsSeries = null, fitSpend = false;
    function zoomView(o) { return Engine.zoomRange(zoomTop, o.zoom, o.zoomAt); }
    function yRange(o) {
        const z = zoomView(o);
        return z.zoom > 1 ? { min: z.min, max: z.max } : fitSpend ? { min: 0, max: zoomTop } : {};
    }
    function applyZoom(chart) {
        const o = topts(), z = zoomView(o);
        o.zoom = z.zoom;
        if (z.zoom > 1) o.zoomAt = (z.min + z.max) / 2;
        const y = chart.options.scales.y;
        // By week or by day the height fits the spending (paydays' income would flatten it).
        if (z.zoom > 1) { y.min = z.min; y.max = z.max; } else if (fitSpend) { y.min = 0; y.max = zoomTop; } else { delete y.min; delete y.max; }
        const ctl = document.getElementById('trends-zoom-y');
        if (ctl) ctl.classList.toggle('is-zoomed', z.zoom > 1);
        UI.text('trends-zoom-level', `${Math.round(z.zoom * 10) / 10}×`);
        const timeZoomed = o.tzoom > 1;
        UI.show('trends-zoom-reset', z.zoom > 1 || timeZoomed);
        chart.canvas.style.touchAction = z.zoom > 1 || timeZoomed ? 'none' : 'pan-y';
    }
    function setZoom(zoom, center) {
        const o = topts();
        o.zoom = Math.min(Engine.ZOOM_MAX, Math.max(1, zoom));
        if (center !== undefined) o.zoomAt = center;
        const chart = UI.chartInstance('trends-chart');
        if (!chart) return;
        applyZoom(chart);
        chart.update('none');
    }
    // Where "+" zooms: on the tapped band, else the middle of what's showing.
    function zoomCenter(o) {
        if (o.focus && trendsSeries && o.focusMonth) {
            const i = trendsSeries.months.indexOf(o.focusMonth), b = trendsSeries.series.findIndex(x => (x.key === null ? '__other' : x.key) === o.focus);
            if (i >= 0 && b >= 0) return Engine.bandMiddle(trendsSeries.series.map(x => x.values), i, b);
        }
        const z = zoomView(o);
        return (z.min + z.max) / 2;
    }
    function zoomGestures(canvas) {
        if (canvas.dataset.zoomReady) return;
        canvas.dataset.zoomReady = '1';
        const pts = new Map();
        let drag = null, pinch = null;
        const chart = () => UI.chartInstance('trends-chart');
        const valueAt = (clientY) => { const c = chart(); const r = canvas.getBoundingClientRect(); return c ? c.scales.y.getValueForPixel(clientY - r.top) : null; };
        const dateAt = (clientX) => {
            const c = chart(), r = canvas.getBoundingClientRect(), keys = trendsSeries ? trendsSeries.months : [];
            if (!c || !keys.length) return null;
            const i = Math.max(0, Math.min(keys.length - 1, Math.round(c.scales.x.getValueForPixel(clientX - r.left))));
            return pointMiddle(trendsSeries, keys[i]);
        };
        const spread = (axis) => { const [a, b] = [...pts.values()]; return Math.abs(axis === 'x' ? a.x - b.x : a.y - b.y); };
        canvas.addEventListener('pointerdown', (e) => {
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            const o = topts();
            if (pts.size === 2) {
                // Fingers apart sideways zoom the dates; up and down, the amounts.
                const [a, b] = [...pts.values()], axis = Math.abs(a.x - b.x) > Math.abs(a.y - b.y) ? 'x' : 'y';
                pinch = { axis, d: spread(axis), zoom: axis === 'x' ? o.tzoom : o.zoom, at: axis === 'x' ? dateAt((a.x + b.x) / 2) : valueAt((a.y + b.y) / 2) };
                drag = null;
            } else if (pts.size === 1 && (o.zoom > 1 || o.tzoom > 1)) drag = { x: e.clientX, y: e.clientY, at: o.zoomAt, center: shownWindow && shownWindow.center, days: shownWindow ? shownWindow.days : 0, axis: null };
        });
        canvas.addEventListener('pointermove', (e) => {
            if (!pts.has(e.pointerId)) return;
            pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch && pts.size === 2) {
                const d = spread(pinch.axis);
                if (pinch.d > 10 && d > 10) { if (pinch.axis === 'x') setTimeZoom(pinch.zoom * d / pinch.d, pinch.at); else setZoom(pinch.zoom * d / pinch.d, pinch.at); }
                canvas.dataset.dragged = '1';
                return;
            }
            const c = chart();
            if (!drag || !c) return;
            const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
            if (!drag.axis) {
                if (Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
                drag.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
            }
            const o = topts();
            if (drag.axis === 'y' && o.zoom > 1) {
                const perPx = (c.scales.y.max - c.scales.y.min) / Math.max(1, c.chartArea.bottom - c.chartArea.top);
                setZoom(o.zoom, drag.at + dy * perPx);
            } else if (drag.axis === 'x' && o.tzoom > 1 && drag.center) {
                setTimeZoom(o.tzoom, addDays(drag.center, -dx / Math.max(1, c.chartArea.right - c.chartArea.left) * drag.days));
            } else return;
            canvas.dataset.dragged = '1';
        });
        const end = (e) => {
            pts.delete(e.pointerId);
            if (pts.size < 2) pinch = null;
            if (!pts.size) { drag = null; setTimeout(() => { delete canvas.dataset.dragged; }, 50); }
        };
        canvas.addEventListener('pointerup', end);
        canvas.addEventListener('pointercancel', end);
        // A computer: Ctrl (or ⌘) + wheel zooms the amounts where the pointer is (a trackpad pinch
        // sends the same); Shift + wheel zooms the dates; scrolling sideways moves in time.
        canvas.addEventListener('wheel', (e) => {
            const o = topts();
            if (e.ctrlKey || e.metaKey) { e.preventDefault(); setZoom(o.zoom * (e.deltaY < 0 ? 1.25 : 0.8), valueAt(e.clientY)); return; }
            if (e.shiftKey) { e.preventDefault(); setTimeZoom(o.tzoom * ((e.deltaY || e.deltaX) < 0 ? 1.25 : 0.8), dateAt(e.clientX)); return; }
            if (o.tzoom > 1 && shownWindow && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
                e.preventDefault();
                const c = chart(), width = c ? c.chartArea.right - c.chartArea.left : 300;
                setTimeZoom(o.tzoom, addDays(shownWindow.center, e.deltaX / Math.max(1, width) * shownWindow.days));
            }
        }, { passive: false });
    }

    function trends(ctx) {
        if (!document.getElementById('trends-chart')) return;
        const o = topts(), pal = UI.palette(), s = ctx.state;
        const w = Engine.trendWindow({ end: ctx.today, months: o.months, zoom: o.tzoom, center: o.tcenter });
        o.tzoom = w.zoom;
        if (w.zoom > 1) o.tcenter = w.center;
        // Months, weeks or days: amounts change scale, so the height zoom starts over.
        if (o.tunit && o.tunit !== w.unit) { o.zoom = 1; o.zoomAt = null; }
        o.tunit = w.unit;
        shownWindow = w;
        const r = trendData(ctx, o);
        const tctl = document.getElementById('trends-zoom-x');
        if (tctl) tctl.classList.toggle('is-zoomed', w.zoom > 1);
        const n = r.months.length;
        UI.text('trends-tzoom-level', w.zoom > 1 ? (w.unit === 'month' ? `${n} month${n === 1 ? '' : 's'}` : `${w.days} day${w.days === 1 ? '' : 's'}`) : `${o.months} month${o.months === 1 ? '' : 's'}`);
        UI.$$('[data-action="trends.tzoom"][data-dir="1"]').forEach(b => { b.disabled = w.zoom >= w.maxZoom; });
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
        const label = labeler(r);
        const name = (x) => (x.key === null ? (o.category ? 'Other subcategories' : 'Other categories') : x.key);
        const color = (x, i) => (x.key === null ? pal.muted : pal.series[i % pal.series.length]);
        // The focused band (tapped) stays strong; the others step back.
        const fkey = (x) => (x.key === null ? '__other' : x.key);
        if (o.focus && !(o.focus === '__income' && r.income) && !r.series.some(x => fkey(x) === o.focus)) o.focus = null;
        const dim = (x) => o.focus && fkey(x) !== o.focus;
        // By week or by day, each point is a flat step as wide as its column: what's drawn there is
        // exactly what a tap there picks.
        const steps = r.unit !== 'month';
        const datasets = r.series.map((x, i) => ({ label: name(x), data: x.values.map(v => Math.round(v * 100) / 100), stack: 'spend', fill: i === 0 ? 'origin' : '-1',
            backgroundColor: color(x, i) + (dim(x) ? '40' : 'b3'), borderColor: color(x, i) + (dim(x) ? '66' : ''), borderWidth: 2, pointRadius: steps ? 0 : 3, pointHoverRadius: 5,
            pointBackgroundColor: pal.surface, pointBorderColor: color(x, i), pointBorderWidth: 2, tension: steps ? 0 : 0.4, stepped: steps ? 'middle' : false }));
        if (r.income) datasets.push({ label: 'Income', data: r.income.map(v => Math.round(v * 100) / 100), stack: 'income', fill: false, borderColor: pal.text, backgroundColor: pal.text, borderWidth: 3, pointRadius: 3, pointBackgroundColor: pal.surface, pointBorderWidth: 2, tension: steps ? 0 : 0.4 });
        // The top of the whole chart (zoom 1): the tallest point's spending or income (by week or
        // by day, its spending only: the income line then runs above the chart on paydays).
        fitSpend = steps;
        zoomTop = Math.max(1, ...r.months.map((_, i) => Math.max(r.series.reduce((t, x) => t + Math.max(0, x.values[i] || 0), 0), r.income && !steps ? r.income[i] || 0 : 0))) * 1.05;
        trendsSeries = r;
        const chart = UI.chart('trends-chart', {
            type: 'line',
            data: { labels: r.months.map(label), datasets },
            // The height (zoomed, or fitted to the spending) goes in from the start: set after,
            // a new chart's opening animation would still finish on the old scale.
            options: { scales: { y: Object.assign({ stacked: true }, yRange(o)) }, plugins: { legend: { position: 'bottom' } },
                // Tap a band: its months in a card; tap it again (or "Open") to see its subcategories.
                // Tap above the bands: that month's breakdown. A drag (zoomed in) is not a tap.
                onClick: (e, els, chart) => {
                    if (chart.canvas.dataset.dragged) return;
                    const i = els.length ? els[0].index : Math.round(chart.scales.x.getValueForPixel(e.x));
                    if (!(i >= 0 && i < r.months.length)) return;
                    const k = r.months[i];
                    // On (or near) the income line: its card.
                    const inc = r.income && r.income[i] > 0 ? chart.getDatasetMeta(chart.data.datasets.length - 1).data[i] : null;
                    if (inc && Math.abs(e.y - inc.y) <= 14) { o.focus = '__income'; o.focusMonth = k; App.update(); return; }
                    const band = Engine.bandAt(r.series.map(x => x.values), i, chart.scales.y.getValueForPixel(e.y));
                    if (band === null) { o.focus = null; o.drill = o.drill && o.drill.month === k && !o.drill.cat ? null : { month: k, cat: null, sub: null }; App.update(); return; }
                    const x = r.series[band], key = fkey(x);
                    if (o.focus === key && o.focusMonth === k) {
                        if (!o.category && x.key !== null) { openCategory(x.key); return; }
                        if (o.category) { openTxns(o, x, k, label, r); return; }
                    }
                    o.focus = key; o.focusMonth = k; o.drill = { month: k, cat: null, sub: null };
                    App.update();
                } }
        });
        if (chart) { applyZoom(chart); chart.update('none'); zoomGestures(chart.canvas); }
        focusCard(o, r, label, name, color, fkey);
        drill(ctx, o, r, label);
        // The last point still running (this month or this week; today, by day).
        const today = Engine.isoDate(ctx.today), lastRange = Engine.trendPointRange(r, r.months[r.months.length - 1]);
        const running = lastRange[0] <= today && Engine.trendPointRange({ unit: r.unit }, r.months[r.months.length - 1])[1] >= today;
        const notes = [!running ? '' : r.unit === 'month' ? 'This month isn\'t over yet.' : r.unit === 'week' ? 'This week isn\'t over yet.' : 'Today isn\'t over yet.',
            steps && r.income && Math.max(...r.income) > zoomTop ? 'On paydays the income line runs above the chart; the table below has its amounts.' : ''].filter(Boolean);
        UI.html('trends-note', notes.map(x => `<span>${esc(x)}</span>`).join(' '));
        UI.html('trends-head', `<tr><th>${r.unit === 'month' ? 'Month' : r.unit === 'week' ? 'Week of' : 'Day'}</th><th class="num">Spending</th>${r.income ? '<th class="num">Income</th><th class="num">Left over</th>' : ''}</tr>`);
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
                : o.category ? `<button type="button" class="btn btn-secondary btn-sm mt-2 self-start" data-action="trends.txns"><i class="fa-solid fa-list-ul"></i> <span>Transactions:</span> <span>${esc(label.long(o.focusMonth))}</span></button>` : ''}
        </div>`;
    }
    // A subcategory's transactions in one month (inside a category's view), in a sheet with a back
    // arrow to the chart. "Other subcategories" lists all the folded ones.
    let txnSheet = null;
    function openTxns(o, x, monthKey, label, r) {
        const [from, to] = Engine.trendPointRange(r, monthKey);
        const subs = x.key === null ? x.other : [x.key], accts = Store.state.accounts || [];
        const list = Store.state.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === o.category
            && subs.includes(t.category || o.category) && (!o.account || (o.account === 'none' ? !t.accountId : String(t.accountId) === String(o.account))))
            .sort((a, b) => b.date.localeCompare(a.date));
        const title = `${I18n.t(x.key === null ? 'Other subcategories' : x.key)} · ${label.long(monthKey)}`;
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
        o.category = key; o.focus = null; o.drill = null; o.zoom = 1; o.zoomAt = null;
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
        if (!d || !r.months.includes(d.month)) { o.drill = null; host.innerHTML = `<p class="help"><i class="fa-solid fa-hand-pointer"></i> ${r.unit === 'month' ? 'Tap a month on the chart to see what changed.' : r.unit === 'week' ? 'Tap a week on the chart to see what changed.' : 'Tap a day on the chart to see what changed.'}</p>`; return; }
        const idx = r.months.indexOf(d.month), s = ctx.state;
        const cat = o.category || d.cat;   // the chart already shows one category: its subcategories
        const head = (title, back) => `<div class="flex items-center justify-between gap-2 mb-2"><strong class="text-sm">${title}</strong>${back ? `<button type="button" class="link text-xs" data-action="trends.up"><i class="fa-solid fa-arrow-left"></i> Back</button>` : ''}</div>`;
        const month = esc(label.long(d.month));
        if (d.sub) {
            const [from, to] = Engine.trendPointRange(r, d.month);
            const acc = o.account;
            const list = s.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && t.date >= from && t.date <= to && (t.parentCategory || 'Otros') === cat && (t.category || cat) === d.sub
                && (!acc || (acc === 'none' ? !t.accountId : String(t.accountId) === String(acc)))).sort((a, b) => Engine.spendAmount(b) - Engine.spendAmount(a));
            host.innerHTML = head(`${month} · ${esc(I18n.t(d.sub))}`, true) + `<div class="acd-txns">${list.map(t => `<div class="acd-txn"><span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span><span class="truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="font-semibold whitespace-nowrap">${money(Engine.spendAmount(t))}</span></div>`).join('') || '<p class="help">No transactions.</p>'}</div>`;
            return;
        }
        const tr = trendData(ctx, o, { category: cat || '', max: 999 });
        const rows = Engine.monthVsAverage(tr, idx), total = rows.reduce((a, x) => a + x.value, 0);
        host.innerHTML = head(`${month}${cat ? ` · ${esc(I18n.t(cat))}` : ''} · ${money(total)}`, !!d.cat) + `<div class="spend-legend">${rows.map(x => `<button type="button" class="spend-row" style="grid-template-columns:1fr auto 5.5rem" data-action="trends.drill" data-key="${esc(x.key)}">
                <span class="spend-name">${esc(I18n.t(x.key))}</span>
                <span class="text-[11px] whitespace-nowrap ${x.diff > 0.5 ? 'text-red-600' : x.diff < -0.5 ? 'text-emerald-700' : 'text-slate-500'}">${Math.abs(x.diff) < 0.5 ? '= avg' : `${x.diff > 0 ? '▲' : '▼'} ${money0(Math.abs(x.diff))} vs avg`}</span>
                <span class="spend-amt">${money(x.value)}</span></button>`).join('') || '<p class="help">No spending that month.</p>'}</div>`;
    }

    UI.register({
        'spend.rangeStep': (el) => { const o = opts(); setRange(Object.assign({ range: 'custom' }, Engine.shiftRange(o.from, o.to, Number(el.dataset.dir) || 0))); },
        'spend.rangePick': () => pickRange(),
        'spend.rangeSet': (el) => { if (RANGE_LABELS[el.dataset.range]) setRange(Object.assign({ range: el.dataset.range }, Engine.rangeFor(el.dataset.range, new Date()))); },
        'spend.rangeCustom': () => {
            const f = (document.getElementById('spend-range-from') || {}).value, t = (document.getElementById('spend-range-to') || {}).value;
            if (!/^\d{4}-\d\d-\d\d$/.test(f || '') || !/^\d{4}-\d\d-\d\d$/.test(t || '')) return;
            setRange(f <= t ? { range: 'custom', from: f, to: t } : { range: 'custom', from: t, to: f });
        },
        'spend.who': (el) => { opts().who = el.value; App.update(); },
        'spend.kind': (el) => { const o = opts(); if (o.kind === el.dataset.kind) return; o.kind = el.dataset.kind === 'income' ? 'income' : 'spend'; o.cat = null; o.pick = null; App.update(); },
        'spend.pick': (el) => pick(el.dataset.key || null),
        'spend.open': (el) => { const o = opts(); o.cat = el.dataset.key; o.pick = null; App.update(); },
        'spend.back': () => { const o = opts(); o.cat = null; o.pick = null; App.update(); },
        'spend.txns': () => openSpendTxns(),
        'spend.txnsBack': () => { if (spendSheet) { spendSheet.close(); spendSheet = null; } },
        'spend.txnOpen': (el) => { if (spendSheet) { spendSheet.close(); spendSheet = null; } if (window.TxnDetails) TxnDetails.open(Number(el.dataset.id), { back: openSpendTxns }); },
        'trends.open': (el) => openCategory(el.dataset.key),
        'trends.txns': () => {
            const o = topts(), ctx = App.buildContext();
            const r = trendData(ctx, o);
            const x = r.series.find(z => (z.key === null ? '__other' : z.key) === o.focus);
            if (x && o.focusMonth && r.months.includes(o.focusMonth)) openTxns(o, x, o.focusMonth, labeler(r), r);
        },
        'trends.txnsBack': () => { if (txnSheet) { txnSheet.close(); txnSheet = null; } },
        'trends.txnOpen': (el) => { if (txnSheet) { txnSheet.close(); txnSheet = null; } if (window.TxnDetails) TxnDetails.open(Number(el.dataset.id)); },
        'trends.back': () => { const o = topts(); o.category = ''; o.focus = null; o.drill = null; o.zoom = 1; o.zoomAt = null; App.update(); },
        'trends.unfocus': () => { topts().focus = null; App.update(); },
        'trends.drill': (el) => { const o = topts(); if (!o.drill) return; if (o.category || o.drill.cat) o.drill.sub = el.dataset.key; else o.drill.cat = el.dataset.key; App.update(); },
        'trends.up': () => { const o = topts(); if (!o.drill) return; if (o.drill.sub) o.drill.sub = null; else o.drill.cat = null; App.update(); },
        'trends.months': (el) => { const o = topts(); o.months = Math.max(1, Math.min(12, Number(el.dataset.months) || 6)); o.tzoom = 1; o.tcenter = null; App.update(); },
        'trends.category': (el) => { const o = topts(); o.category = el.value; o.focus = null; o.drill = null; o.zoom = 1; o.zoomAt = null; App.update(); },
        'trends.zoom': (el) => { const o = topts(), up = Number(el.dataset.dir) > 0; setZoom(up ? o.zoom * 2 : o.zoom / 2, up ? zoomCenter(o) : undefined); },
        'trends.zoomReset': () => { const o = topts(); o.tzoom = 1; o.tcenter = null; o.zoom = 1; o.zoomAt = null; App.update(); },
        'trends.tzoom': (el) => { const o = topts(), up = Number(el.dataset.dir) > 0; setTimeZoom(up ? o.tzoom * 2 : o.tzoom / 2, up ? timeZoomCenter(o) : undefined); },
        'trends.tpan': (el) => { if (shownWindow && shownWindow.center) setTimeZoom(topts().tzoom, addDays(shownWindow.center, (Number(el.dataset.dir) || 0) * shownWindow.days / 2)); },
        'trends.pan': (el) => { const o = topts(), z = zoomView(o); setZoom(o.zoom, (z.min + z.max) / 2 + (Number(el.dataset.dir) || 0) * (z.max - z.min) / 2); },
        'trends.account': (el) => { topts().account = el.value; App.update(); }
    });

    window.Spending = { update: (ctx) => { update(ctx); trends(ctx); } };
})();
