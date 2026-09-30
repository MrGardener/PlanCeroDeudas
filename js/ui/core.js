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

        initEvents() {
            const dispatch = (attr) => (e) => {
                const el = e.target.closest(`[${attr}]`);
                if (!el) return;
                const fn = actions[el.getAttribute(attr)];
                if (!fn) { console.warn('Acción no registrada:', el.getAttribute(attr)); return; }
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
        form({ title, message = '', fields = [], confirmText = 'Aceptar', cancelText = 'Cancelar', danger = false, validate }) {
            return new Promise((resolve) => {
                const back = document.createElement('div');
                back.className = 'modal-backdrop';
                back.innerHTML = `
                    <div class="modal ${danger ? 'modal-danger' : ''}" role="dialog" aria-modal="true">
                        <h3 class="modal-title"><i class="fa-solid ${danger ? 'fa-triangle-exclamation' : 'fa-circle-question'}"></i><span></span></h3>
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
                back.querySelector('[data-dialog-cancel]').textContent = cancelText;
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
                back.querySelector('[data-dialog-cancel]').addEventListener('click', () => close(fields.length ? null : false));
                back.querySelector('[data-dialog-ok]').addEventListener('click', submit);
                back.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target.tagName === 'INPUT') submit(); });
                back.addEventListener('mousedown', (e) => { if (e.target === back) close(fields.length ? null : false); });
                document.body.appendChild(back);
                (back.querySelector('.modal-fields input, .modal-fields select') || back.querySelector('[data-dialog-ok]')).focus();
            });
        },

        confirm(opts) { return UI.form({ ...opts, fields: [] }); },

        // --------------------------------------------------------------- charts
        // Creates the chart the first time, then swaps data/options in place so live edits
        // redraw smoothly instead of rebuilding (and re-animating) on every keystroke.
        chart(canvasId, config) {
            const canvas = document.getElementById(canvasId);
            if (!canvas || typeof Chart === 'undefined') return null;
            const money = (v) => Fmt.money0(v);
            const base = {
                responsive: true,
                maintainAspectRatio: false,
                animation: { duration: 350 },
                datasets: { bar: { maxBarThickness: 44 } },
                interaction: { mode: 'index', intersect: false },
                plugins: {
                    legend: { labels: { font: { family: 'Inter', size: 11 }, boxWidth: 12 } },
                    tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${Fmt.money(c.parsed.y)}` } }
                },
                scales: {
                    x: { ticks: { font: { size: 10 }, maxTicksLimit: 14 }, grid: { display: false } },
                    y: { ticks: { font: { size: 10 }, callback: money }, beginAtZero: true }
                }
            };
            const options = mergeDeep(base, config.options || {});
            const existing = charts[canvasId];
            if (existing && existing.canvas === canvas && existing.config.type === config.type) {
                existing.data = config.data;
                existing.options = options;
                existing.update('none');
                return existing;
            }
            if (existing) existing.destroy();
            charts[canvasId] = new Chart(canvas.getContext('2d'), { type: config.type, data: config.data, options });
            return charts[canvasId];
        },

        chartInstance(id) { return charts[id] || null; }
    };

    function mergeDeep(a, b) {
        const out = Array.isArray(a) ? a.slice() : { ...a };
        Object.keys(b).forEach(k => {
            out[k] = (b[k] && typeof b[k] === 'object' && !Array.isArray(b[k]) && typeof b[k] !== 'function' && a[k] && typeof a[k] === 'object')
                ? mergeDeep(a[k], b[k]) : b[k];
        });
        return out;
    }

    root.UI = UI;
})(this);
