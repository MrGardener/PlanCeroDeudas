/*
 * UI — small DOM toolkit shared by all views: element lookup, event delegation by
 * data-attributes (no inline handlers or global functions), dialogs that replace
 * alert/confirm/prompt, toasts, and a chart helper that updates in place.
 */
(function (root) {
    'use strict';

    const actions = {};
    const charts = {};

    const UI = {
        $: (sel, scope) => (scope || document).querySelector(sel),
        $$: (sel, scope) => Array.from((scope || document).querySelectorAll(sel)),

        text(id, value) { const el = document.getElementById(id); if (el) el.textContent = value; },
        html(id, value) { const el = document.getElementById(id); if (el) el.innerHTML = value; },
        show(id, visible) { const el = typeof id === 'string' ? document.getElementById(id) : id; if (el) el.classList.toggle('hidden', !visible); },

        // Handlers are registered by name; markup refers to them with data-action (click),
        // data-input (every keystroke) or data-change (on commit). The element is passed in.
        register(map) { Object.assign(actions, map); },
        // Run a registered handler from code (with a stand-in element carrying its data-*).
        run(name, data = {}) { return actions[name] && actions[name]({ dataset: data }); },

        initEvents() {
            const dispatch = (attr) => (e) => {
                const el = e.target.closest(`[${attr}]`);
                if (!el) return;
                const fn = actions[el.getAttribute(attr)];
                if (!fn) { console.warn('Unregistered action:', el.getAttribute(attr)); return; }
                if (attr === 'data-action' && el.tagName === 'A') e.preventDefault();
                // Which field is being edited (stable across re-renders), for undo grouping.
                UI.source = [el.getAttribute(attr), el.dataset.id, el.dataset.ref, el.dataset.field, el.dataset.bind].join('|');
                if (UI.beforeAction) UI.beforeAction(UI.source);
                try { fn(el, e); } finally { UI.source = null; }
            };
            document.addEventListener('click', dispatch('data-action'));
            document.addEventListener('input', dispatch('data-input'));
            document.addEventListener('change', dispatch('data-change'));
            document.addEventListener('keydown', (e) => {
                if (e.key === 'Escape') { const m = document.querySelector('.modal-backdrop:not(.hidden)'); if (m) m.querySelector('[data-dialog-cancel]')?.click(); }
            });
        },

        // --------------------------------------------------------------- toasts
        // action: optional { label, onClick } — e.g. "Deshacer" after a deletion.
        toast(message, kind = 'ok', action) {
            let host = document.getElementById('toast-host');
            if (!host) { host = document.createElement('div'); host.id = 'toast-host'; document.body.appendChild(host); }
            const t = document.createElement('div');
            const icon = kind === 'error' ? 'fa-circle-exclamation' : kind === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-check';
            t.className = `toast toast-${kind} ${action && action.className ? action.className : ''}`;
            t.setAttribute('role', 'status');
            t.innerHTML = `<i class="fa-solid ${icon}"></i><span></span>`;
            t.querySelector('span').textContent = message;
            const ttl = action ? 7000 : 3200;
            if (action) {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'toast-action';
                b.textContent = action.label;
                b.addEventListener('click', () => { action.onClick(); t.remove(); });
                t.appendChild(b);
            }
            host.appendChild(t);
            setTimeout(() => t.classList.add('toast-out'), ttl);
            setTimeout(() => t.remove(), ttl + 500);
        },

        // -------------------------------------------------------------- dialogs
        // form(): a modal with optional fields; resolves to the values, or null if cancelled.
        // cancelText: null shows only the OK button (a notice); icon replaces the title's icon.
        form({ title, message = '', fields = [], confirmText = 'OK', cancelText = 'Cancel', danger = false, validate, icon = null }) {
            return new Promise((resolve) => {
                const back = document.createElement('div');
                back.className = 'modal-backdrop';
                back.innerHTML = `
                    <div class="modal ${danger ? 'modal-danger' : ''}" role="dialog" aria-modal="true">
                        <h3 class="modal-title"><i class="fa-solid ${icon || (danger ? 'fa-triangle-exclamation' : 'fa-circle-question')}"></i><span></span></h3>
                        <p class="modal-message"></p>
                        <div class="modal-fields space-y-3"></div>
                        <p class="modal-error hidden"></p>
                        <div class="modal-actions">
                            <button type="button" class="btn btn-secondary" data-dialog-cancel></button>
                            <button type="button" class="btn ${danger ? 'btn-danger' : 'btn-primary'}" data-dialog-ok></button>
                        </div>
                    </div>`;
                back.querySelector('.modal-title span').textContent = title;
                back.querySelector('.modal-message').textContent = message;
                if (!message) back.querySelector('.modal-message').remove();
                if (cancelText === null) back.querySelector('[data-dialog-cancel]').remove();
                else back.querySelector('[data-dialog-cancel]').textContent = cancelText;
                back.querySelector('[data-dialog-ok]').textContent = confirmText;
                const host = back.querySelector('.modal-fields');
                fields.forEach(f => {
                    const wrap = document.createElement('label');
                    wrap.className = 'block';
                    wrap.innerHTML = `<span class="field-label"></span>`;
                    wrap.querySelector('.field-label').textContent = f.label;
                    let input;
                    if (f.options) {
                        input = document.createElement('select');
                        f.options.forEach(o => { const opt = document.createElement('option'); opt.value = o.value ?? o; opt.textContent = o.label ?? o; input.appendChild(opt); });
                    } else {
                        input = document.createElement('input');
                        input.type = f.type || 'text';
                        if (f.step) input.step = f.step;
                        if (f.min !== undefined) input.min = f.min;
                        if (f.placeholder) input.placeholder = f.placeholder;
                        if (f.inputmode) input.inputMode = f.inputmode;
                        if (f.type === 'password') input.autocomplete = 'new-password';
                    }
                    input.className = 'input';
                    input.name = f.name;
                    if (f.value !== undefined && f.value !== null) input.value = f.value;
                    wrap.appendChild(input);
                    if (f.help) { const h = document.createElement('span'); h.className = 'help block'; h.textContent = f.help; wrap.appendChild(h); }
                    host.appendChild(wrap);
                });
                if (!fields.length) host.remove();

                const close = (result) => { back.remove(); resolve(result); };
                const submit = () => {
                    const values = {};
                    fields.forEach(f => {
                        const v = back.querySelector(`[name="${f.name}"]`).value;
                        values[f.name] = f.type === 'number' ? Fmt.parseNum(v, null) : v;
                    });
                    const err = validate ? validate(values) : null;
                    if (err) { const e = back.querySelector('.modal-error'); e.textContent = err; e.classList.remove('hidden'); return; }
                    close(fields.length ? values : true);
                };
                const cancelBtn = back.querySelector('[data-dialog-cancel]');
                if (cancelBtn) cancelBtn.addEventListener('click', () => close(fields.length ? null : false));
                back.querySelector('[data-dialog-ok]').addEventListener('click', submit);
                back.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
                back.addEventListener('mousedown', (e) => { if (e.target === back) close(fields.length ? null : false); });
                document.body.appendChild(back);
                (back.querySelector('.modal-fields input, .modal-fields select') || back.querySelector('[data-dialog-ok]')).focus();
            });
        },

        confirm(opts) { return UI.form({ ...opts, fields: [] }); },

        // sheet(): a dialog with custom content (lists, a chart…). Controls inside use the same
        // data-action / data-change handlers as the rest of the app. Returns { el, close }.
        sheet({ title, icon = 'fa-circle-info', html = '', wide = false, onClose }) {
            UI.$$('.modal-backdrop.sheet').forEach(b => b.remove());
            const back = document.createElement('div');
            back.className = 'modal-backdrop sheet';
            back.innerHTML = `<div class="modal ${wide ? 'modal-wide' : ''}" role="dialog" aria-modal="true">
                    <div class="flex items-start justify-between gap-3"><h3 class="modal-title"><i class="fa-solid ${icon}"></i><span></span></h3>
                    <button type="button" class="row-del text-lg" data-dialog-cancel aria-label="Close"><i class="fa-solid fa-xmark"></i></button></div>
                    <div class="sheet-body">${html}</div></div>`;
            back.querySelector('.modal-title span').textContent = title;
            const close = () => { if (!back.isConnected) return; back.remove(); if (onClose) onClose(); };
            back.querySelector('[data-dialog-cancel]').addEventListener('click', close);
            back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });
            document.body.appendChild(back);
            return { el: back, body: back.querySelector('.sheet-body'), close };
        },

        // --------------------------------------------------------------- charts
        // Creates the chart the first time, then swaps data/options in place so live edits
        // redraw smoothly instead of rebuilding (and re-animating) on every keystroke.
        chart(canvasId, config) {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined') return null;
            registerTodayLine();
            registerActiveLine();
            // Chart text lives in the canvas, outside the page: translate it here.
            if (root.I18n) {
                const tr = (v) => (typeof v === 'string' ? I18n.t(v) : v);
                if (Array.isArray(config.data.labels)) config.data.labels = config.data.labels.map(tr);
                (config.data.datasets || []).forEach(d => { d.label = tr(d.label); });
                Object.values((config.options && config.options.scales) || {}).forEach(sc => { if (sc && sc.title && sc.title.text) sc.title.text = tr(sc.title.text); });
                const tl = config.options && config.options.plugins && config.options.plugins.todayLine;
                if (tl && tl.label) tl.label = tr(tl.label);
            }
            const money = (v) => Fmt.money0(v);
            const base = {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 350 },
                datasets: { bar: { maxBarThickness: 44 } },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { font: { family: "Inter, system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif", size: 11 }, boxWidth: 12 } },
                    // Values go in a line under the chart (chartReadout), not in a box over the lines.
                    tooltip: { enabled: false, external: chartReadout, callbacks: { label: (c) => `${c.dataset.label}: ${Fmt.money(c.parsed.y)}` } }
                },
                scales: {
                    x: { ticks: { font: { size: 10 }, maxTicksLimit: 14 }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, callback: money }, beginAtZero: true }
                }
            };
            const options = mergeDeep(base, config.options || {});
            // Round charts have no axes.
            if (config.type === 'doughnut' || config.type === 'pie') delete options.scales;
            const existing = charts[canvasId];
            if (existing && existing.canvas === canvas && existing.config.type === config.type) {
                existing.data = config.data;
                existing.options = options;
                existing.update('none');
                return existing;
            }
            if (existing) existing.destroy();
            charts[canvasId] = new Chart(canvas.getContext('2d'), { type: config.type, data: config.data, options });
            if (options.plugins.tooltip.external === chartReadout) readoutFor(canvas);
            return charts[canvasId];
        },

        chartInstance(id) { return charts[id] || null; }
    };

    // ---------------------------------------------------------- chart palette
    // One set of chart colors for both themes (validated for color-blind separation and contrast
    // against the card surface in each theme: see the dataviz validator). CSS variables override
    // them when the design tokens define any: --chart-1…--chart-7, --chart-neg, --chart-muted,
    // --chart-surface, --chart-text, --chart-text-2, --chart-seq-1…--chart-seq-5, --chart-seq-0.
    // Categorical slots go in a fixed order (1 blue, 2 orange, 3 aqua, 4 yellow, 5 magenta,
    // 6 green, 7 violet); sequential steps are one blue hue from little to a lot.
    const PALETTE = {
        light: {
            series: ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7'],
            neg: '#d03b3b', muted: '#94a3b8', surface: '#ffffff', text: '#0f172a', text2: '#475569',
            seq: ['#86b6ef', '#5598e7', '#2a78d6', '#1c5cab', '#0d366b'], seq0: '#eef2f7'
        },
        dark: {
            series: ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#008300', '#9085e9'],
            neg: '#e66767', muted: '#64748b', surface: '#111a2e', text: '#e2e8f0', text2: '#94a3b8',
            seq: ['#184f95', '#256abf', '#3987e5', '#6da7ec', '#b7d3f6'], seq0: '#1c2742'
        }
    };
    UI.palette = function palette() {
        const doc = typeof document !== 'undefined' ? document.documentElement : null;
        const dark = !!doc && doc.dataset.theme === 'dark';
        const base = PALETTE[dark ? 'dark' : 'light'];
        const css = doc && root.getComputedStyle ? root.getComputedStyle(doc) : null;
        const v = (name, fallback) => (css && css.getPropertyValue(name).trim()) || fallback;
        const series = base.series.map((c, i) => v(`--chart-${i + 1}`, c));
        return {
            dark, series,
            blue: series[0], orange: series[1], aqua: series[2],
            neg: v('--chart-neg', base.neg), muted: v('--chart-muted', base.muted),
            surface: v('--chart-surface', base.surface), text: v('--chart-text', base.text), text2: v('--chart-text-2', base.text2),
            seq: base.seq.map((c, i) => v(`--chart-seq-${i + 1}`, c)), seq0: v('--chart-seq-0', base.seq0),
            // A color at some opacity (fills and bands: ~10%).
            alpha: (hex, a) => {
                const h = String(hex).replace('#', '');
                if (!/^[0-9a-f]{6}$/i.test(h)) return hex;
                return `rgba(${parseInt(h.slice(0, 2), 16)},${parseInt(h.slice(2, 4), 16)},${parseInt(h.slice(4, 6), 16)},${a})`;
            },
            // Text set inside a colored fill: white or ink, whichever reads on that fill.
            inkOn: (hex) => {
                const h = String(hex).replace('#', '');
                if (!/^[0-9a-f]{6}$/i.test(h)) return '#fff';
                const lin = (i) => { const c = parseInt(h.slice(i, i + 2), 16) / 255; return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); };
                const L = 0.2126 * lin(0) + 0.7152 * lin(2) + 0.0722 * lin(4);
                return (L + 0.05) / 0.05 > 1.05 / (L + 0.05) ? '#0f172a' : '#ffffff';
            }
        };
    };

    // ------------------------------------------------------------- sparkline
    // A tiny trend line as SVG markup (no axes, no Chart.js), for tiles and table rows.
    // values: numbers (null = no data). opts: { width, height, color, label (accessible name),
    // partialLast (the last point is a period still running: its segment is dashed and the dot
    // hollow), dashed (the whole line is a projection), fill (a 10% wash under the line) }.
    UI.sparkline = function sparkline(values, opts = {}) {
        const w = opts.width || 72, h = opts.height || 20, pad = 3;
        const pal = UI.palette();
        const color = opts.color || pal.blue;
        const pts = (values || []).map((v, i) => [i, v]).filter(p => p[1] !== null && p[1] !== undefined && Number.isFinite(Number(p[1])));
        const n = (values || []).length;
        const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        const label = opts.label ? ` role="img" aria-label="${esc(opts.label)}"` : ' aria-hidden="true"';
        if (pts.length < 2) return `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${label}></svg>`;
        const ys = pts.map(p => Number(p[1]));
        let lo = Math.min(...ys), hi = Math.max(...ys);
        if (opts.zero !== false) { lo = Math.min(lo, 0); hi = Math.max(hi, 0); }
        const span = hi - lo || 1;
        const X = (i) => pad + (n > 1 ? i / (n - 1) : 0) * (w - pad * 2);
        const Y = (v) => (hi === lo ? h / 2 : pad + (1 - (v - lo) / span) * (h - pad * 2));
        const xy = pts.map(p => [X(p[0]), Y(Number(p[1]))].map(c => c.toFixed(1)));
        const line = (list) => list.map((p, i) => `${i ? 'L' : 'M'}${p[0]},${p[1]}`).join('');
        const partial = opts.partialLast && xy.length > 2;
        const solid = partial ? xy.slice(0, -1) : xy;
        const last = xy[xy.length - 1];
        const stroke = `stroke="${color}" stroke-width="1.5" fill="none" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"`;
        let out = `<svg class="spark" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}"${label}>`;
        if (opts.label) out += `<title>${esc(opts.label)}</title>`;
        if (opts.fill) out += `<path d="${line(xy)}L${last[0]},${(h - pad).toFixed(1)}L${xy[0][0]},${(h - pad).toFixed(1)}Z" fill="${color}" opacity=".1"/>`;
        out += `<path d="${line(solid)}" ${stroke}${opts.dashed ? ' stroke-dasharray="3 2"' : ''}/>`;
        if (partial) out += `<path d="${line(xy.slice(-2))}" ${stroke} stroke-dasharray="2 2" opacity=".75"/>`;
        out += partial
            ? `<circle cx="${last[0]}" cy="${last[1]}" r="2.25" fill="${pal.surface}" stroke="${color}" stroke-width="1.25"/>`
            : `<circle cx="${last[0]}" cy="${last[1]}" r="2.25" fill="${color}"/>`;
        return out + '</svg>';
    };

    // ------------------------------------------------------------- chart readout
    // Tapping or hovering a chart shows the values of that point in a line under the chart (a box
    // on top would hide the chart, worst on a phone); a thin vertical line marks the point. The last
    // values stay until another point is chosen.
    const escHTML = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    function readoutFor(canvas) {
        const box = canvas.parentNode;
        if (!box || !box.parentNode) return null;
        let out = box.nextElementSibling;
        if (!out || !out.classList.contains('chart-readout')) {
            out = document.createElement('div');
            out.className = 'chart-readout';
            out.setAttribute('aria-live', 'polite');
            const hint = document.createElement('span');
            hint.className = 'chart-readout-hint';
            hint.textContent = 'Tap the chart to see its values here.';
            out.appendChild(hint);
            box.parentNode.insertBefore(out, box.nextSibling);
        }
        return out;
    }
    function chartReadout({ chart, tooltip }) {
        const out = readoutFor(chart.canvas);
        if (!out) return;
        if (!tooltip || tooltip.opacity === 0 || !tooltip.dataPoints || !tooltip.dataPoints.length) return;
        const title = (tooltip.title || []).join(' ');
        const lines = (tooltip.body || []).map((b, i) => {
            const c = (tooltip.labelColors || [])[i] || {};
            const color = typeof c.backgroundColor === 'string' && c.backgroundColor !== 'transparent' ? c.backgroundColor : c.borderColor;
            return `<span class="chart-readout-item"><i style="background:${escHTML(color || '#94a3b8')}"></i>${escHTML((b.lines || []).join(' '))}</span>`;
        }).join('');
        out.innerHTML = `<span data-i18n-skip class="contents">${title ? `<strong>${escHTML(title)}</strong>` : ''}${lines}</span>`;
    }
    UI.chartReadout = chartReadout;

    let activeLineReady = false;
    function registerActiveLine() {
        if (activeLineReady || typeof Chart === 'undefined') return;
        activeLineReady = true;
        Chart.register({
            id: 'activeLine',
            afterDatasetsDraw(chart) {
                const act = chart.tooltip && chart.tooltip.getActiveElements ? chart.tooltip.getActiveElements() : [];
                if (!act.length || !chart.scales.x || !chart.chartArea) return;
                const x = act[0].element.x, { top, bottom } = chart.chartArea, c = chart.ctx;
                c.save();
                c.strokeStyle = UI.palette().text2;
                c.globalAlpha = 0.55;
                c.lineWidth = 1;
                c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
                c.restore();
            }
        });
    }

    // A dashed vertical "Hoy" line at a category index: options.plugins.todayLine = { index, label }.
    let todayLineReady = false;
    function registerTodayLine() {
        if (todayLineReady || typeof Chart === 'undefined') return;
        todayLineReady = true;
        Chart.register({
            id: 'todayLine',
            afterDatasetsDraw(chart, args, opts) {
                if (!opts || !(opts.index >= 0) || !chart.scales.x) return;
                const x = chart.scales.x.getPixelForValue(opts.index);
                const { top, bottom } = chart.chartArea;
                const c = chart.ctx;
                c.save();
                c.strokeStyle = Chart.defaults.color; c.globalAlpha = .55; c.setLineDash([3, 3]); c.lineWidth = 1;
                c.beginPath(); c.moveTo(x, top); c.lineTo(x, bottom); c.stroke();
                c.globalAlpha = .9; c.setLineDash([]); c.fillStyle = Chart.defaults.color; c.font = '600 10px Inter, sans-serif'; c.textAlign = 'left';
                c.fillText(opts.label || 'Today', x + 4, top + 10);
                c.restore();
            }
        });
        // Direct labels past the end of horizontal bars: options.plugins.endLabels =
        // { dataset: index of the dataset whose bar ends get labels, labels: [text per bar] }.
        // Leave room for them with layout.padding.right.
        Chart.register({
            id: 'endLabels',
            afterDatasetsDraw(chart, args, opts) {
                if (!opts || !Array.isArray(opts.labels)) return;
                const c = chart.ctx;
                c.save();
                c.fillStyle = opts.color || Chart.defaults.color; c.font = '600 10px Inter, system-ui, sans-serif';
                c.textAlign = 'left'; c.textBaseline = 'middle';
                // dataset: one index for every bar, or one per bar (the dataset that ends last).
                opts.labels.forEach((text, i) => {
                    const di = Array.isArray(opts.dataset) ? opts.dataset[i] : opts.dataset;
                    const meta = di >= 0 ? chart.getDatasetMeta(di) : null;
                    const el = meta && !meta.hidden ? meta.data[i] : null;
                    if (!text || !el) return;
                    const { x, y } = el.getProps(['x', 'y'], true);
                    c.fillText(root.I18n ? I18n.t(text) : text, x + 6, y);
                });
                c.restore();
            }
        });
    }

    function mergeDeep(a, b) {
        const out = Array.isArray(a) ? a.slice() : { ...a };
        Object.keys(b).forEach(k => {
            out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof b[k] !== 'function' && a[k] && typeof a[k] === 'object')
                ? mergeDeep(a[k], b[k]) : b[k];
        });
        return out;
    }

    // Phones: the on-screen keyboard takes half the screen. Keep the field being typed in visible
    // (scrolled to the middle of what's left, in the page or inside a sheet) and hide the bottom
    // bar and the + button meanwhile, so they don't sit on top of the form.
    const typing = (el) => el && (el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || (el.tagName === 'INPUT' && !['checkbox', 'radio', 'button', 'submit', 'file', 'range', 'color'].includes(el.type)));
    function keepFocusedVisible() {
        const el = document.activeElement;
        if (!typing(el)) return;
        const vv = root.visualViewport, top = vv ? vv.offsetTop : 0, h = vv ? vv.height : root.innerHeight;
        const r = el.getBoundingClientRect();
        if (r.top < top + 12 || r.bottom > top + h - 12) el.scrollIntoView({ block: 'center', inline: 'nearest' });
    }
    if (typeof document !== 'undefined') {
        const touch = () => root.matchMedia && root.matchMedia('(pointer: coarse)').matches;
        document.addEventListener('focusin', (e) => {
            if (!typing(e.target)) return;
            if (touch()) document.documentElement.classList.add('kb-open');
            // Once the keyboard has opened (and again when it finishes resizing the screen).
            setTimeout(keepFocusedVisible, 350);
        });
        document.addEventListener('focusout', () => setTimeout(() => { if (!typing(document.activeElement)) document.documentElement.classList.remove('kb-open'); }, 100));
        if (root.visualViewport) root.visualViewport.addEventListener('resize', () => setTimeout(keepFocusedVisible, 50));
        else root.addEventListener('resize', () => setTimeout(keepFocusedVisible, 50));
    }
    UI.keepFocusedVisible = keepFocusedVisible;

    root.UI = UI;
})(this);
