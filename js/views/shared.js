/* Shared view helpers: markup builders used by more than one tab. */
(function (root) {
    'use strict';
    const { money, money0, esc } = Fmt;

    // Ecuador-adapted Baby Steps: what each step means and where in the app you work on it.
    const STEP_INFO = {
        1: { text: '$1,000 in cash for emergencies so you don\'t reach for credit cards.', goto: 'futuro/metas', focus: 'metas-ef' },
        2: { text: 'Pay off consumer debt, smallest to largest.', goto: 'futuro/metas', focus: 'metas-debts' },
        3: { text: '3–6 months of essential expenses for job loss or emergencies your insurance doesn\'t cover.', goto: 'futuro/metas', focus: 'metas-ef' },
        4: { text: 'Invest 15% of your income in your 401(k) and Roth IRA.', goto: 'futuro/jubilacion' },
        5: { text: 'Save for your kids\' college (529 plan or ESA).', goto: 'futuro/metas', focus: 'metas-goals' },
        6: { text: 'Extra payments on your mortgage to pay it off sooner.', goto: 'futuro/hipoteca' },
        7: { text: 'Financial freedom: keep investing and give generously.', goto: 'patrimonio' }
    };

    function stepsHTML(ctx, { compact = false } = {}) {
        return ctx.steps.steps.map(s => {
            const info = STEP_INFO[s.n];
            const icon = s.state === 'done' ? '<i class="fa-solid fa-check"></i>' : s.n;
            const status = s.state === 'done' ? '<span class="badge badge-ok">Completed</span>'
                : s.state === 'current' ? '<span class="badge badge-info">In progress</span>'
                : s.n === 7 ? '<span class="badge badge-muted">Target amount</span>'
                : s.done === null ? '<span class="badge badge-muted">Optional</span>' : '';
            return `
                <button type="button" class="step ${s.state}" data-goto="${info.goto}" ${info.focus ? `data-focus="${info.focus}"` : ''}>
                    <span class="step-num">${icon}</span>
                    <span class="min-w-0">
                        <span class="step-title block">${esc(s.title)}</span>
                        ${compact ? '' : `<span class="step-detail block">${esc(info.text)}</span>`}
                        <span class="step-detail block font-semibold text-slate-600">${esc(s.detail)}</span>
                        ${compact ? '' : `<span class="block mt-1">${status}</span>`}
                    </span>
                </button>`;
        }).join('');
    }

    function spendBadge(st) {
        switch (st.kind) {
            case 'unlinked': return '<span class="text-slate-300">—</span>';
            case 'empty': return '<span class="text-slate-400 text-[11px]">$0.00</span>';
            case 'unbudgeted': return `<span class="badge badge-bad">${money(st.spent)} without a budget</span>`;
            case 'untouched': return `<span class="badge badge-info" title="No transactions in the period">$0 of ${money0(st.target)}</span>`;
            case 'over': return `<span class="badge badge-bad">${money(st.spent)} · +${money0(st.over)}</span>`;
            case 'warning': return `<span class="badge badge-warn">${money(st.spent)} (${Math.round(st.ratio * 100)}%)</span>`;
            default: return `<span class="badge badge-ok">${money(st.spent)} (${Math.round(st.ratio * 100)}%)</span>`;
        }
    }

    // A dashboard tile: the same KPI tile the tabs use, as a link to where the number lives.
    // spark: optional sparkline markup (UI.sparkline) shown beside the value.
    function kpiCard({ tone, icon, label, value, note, goto, focus, spark }) {
        return `
            <button type="button" class="kpi tone-slate kpi-link dash-card" data-goto="${goto}" ${focus ? `data-focus="${focus}"` : ''}>
                <span class="kpi-head"><span class="kpi-icon"><i class="fa-solid ${icon} ${tone}"></i></span><span class="kpi-label">${label}</span><i class="fa-solid fa-chevron-right kpi-chev"></i></span>
                ${spark ? `<span class="spark-row"><span class="kpi-value">${value}</span>${spark}</span>` : `<span class="kpi-value">${value}</span>`}
                <span class="kpi-note">${note}</span>
            </button>`;
    }

    // An empty screen says what goes here and offers the one next step (instead of a blank grid).
    function emptyState(icon, text, cta) {
        return `<div class="empty-state"><span class="empty-icon"><i class="fa-solid ${icon}"></i></span><p>${text}</p>${cta || ''}</div>`;
    }

    const selectOptions = (options, current) => options.map(o => {
        const value = typeof o === 'object' ? o.value : o;
        const label = typeof o === 'object' ? o.label : o;
        return `<option value="${esc(value)}" ${String(value) === String(current) ? 'selected' : ''}>${esc(label)}</option>`;
    }).join('');

    // Monthly label with Décimo notes for the budget month picker.
    function monthOptions(yd) {
        const d4 = Engine.d4Month(yd);
        return [{ value: 'base', label: 'Base budget (whole year)' }].concat(Engine.MONTHS.map(m => {
            let note = '';
            if (m === '12' && yd.d3) note = ' · + 13th-month bonus';
            if (m === d4 && yd.d4) note += ' · + 14th-month bonus';
            return { value: m, label: Fmt.MONTH_NAMES[Number(m) - 1] + note };
        }));
    }

    // Does this year's net worth reflect the pólizas and debts registered elsewhere? Only
    // checked for the current calendar year — past years are history and may differ.
    // The "how this works" guide: shown as a welcome on first use and kept in Configuración.
    function guideHTML() {
        const item = (icon, html) => `<li class="flex gap-2.5"><i class="fa-solid ${icon} text-emerald-600 mt-0.5 w-4 text-center"></i><span>${html}</span></li>`;
        const step = (n, goto, label, text) => `<li class="flex gap-2.5"><span class="step-num" style="width:1.4rem;height:1.4rem;font-size:.7rem">${n}</span><span><a href="#" class="link" data-goto="${goto}">${label}</a>: ${text}</span></li>`;
        // In the phone app (js/native.js) there's no file to open and nothing needs internet.
        const app = window.Native && Native.isApp;
        const open = app ? `
                <div class="section-label"><i class="fa-solid fa-mobile-screen text-emerald-600"></i> On your phone</div>
                <ul class="space-y-2">
                    ${item('fa-plane', 'Works <strong>offline</strong>: everything is on your phone. Only reading a PDF or a photo needs internet the first time.')}
                    ${item('fa-share-nodes', 'Backups and reports open with <strong>Share</strong>: keep them in Google Drive or Files, or email them.')}
                </ul>` : `
                <div class="section-label"><i class="fa-solid fa-folder-open text-emerald-600"></i> Open the app</div>
                <ul class="space-y-2">
                    ${item('fa-file-code', 'Save this file in a folder that\'s easy to find (for example <strong>Documents</strong>) and open it with <strong>double click</strong>. It opens in your browser; nothing to install.')}
                    ${item('fa-laptop', 'Works best on a <strong>computer</strong> with Chrome, Edge or Firefox. On a phone, many devices don\'t open downloaded files well.')}
                    ${item('fa-wifi', 'You need <strong>internet</strong> when you open it to see the styles and charts.')}
                </ul>`;
        const data = app ? `
                    ${item('fa-floppy-disk', 'Everything <strong>saves on its own</strong>, on this phone. Your data never leaves your device.')}
                    ${item('fa-rotate-left', 'Made a mistake? Use <strong>Undo</strong> <i class="fa-solid fa-rotate-left"></i> at the top right to go back step by step.')}
                    ${item('fa-triangle-exclamation', 'If you uninstall the app or clear its data, <strong>your plan is erased</strong>.')}
                    ${item('fa-download', 'Save a <strong>backup</strong> every so often in <a href="#" class="link" data-goto="config" data-focus="cfg-data">Settings → Your Data</a>. To move to another phone or a computer, open the app there and use <strong>Load backup</strong>.')}` : `
                    ${item('fa-floppy-disk', 'Everything <strong>saves on its own</strong>, in this browser on this computer. Your data never leaves your device.')}
                    ${item('fa-rotate-left', 'Made a mistake? Use <strong>Undo</strong> <i class="fa-solid fa-rotate-left"></i> at the top right (or Ctrl+Z) to go back step by step, and <strong>Redo</strong> <i class="fa-solid fa-rotate-right"></i> in case you change your mind.')}
                    ${item('fa-triangle-exclamation', 'If you open the app in <strong>another browser or another computer</strong>, it will start empty. If you clear your history or browsing data, <strong>your plan is erased</strong>.')}
                    ${item('fa-download', 'Download one <strong>backup</strong> every so often in <a href="#" class="link" data-goto="config" data-focus="cfg-data">Settings → Your Data</a>. To move to another device, open the app there and use <strong>Load backup</strong>.')}`;
        return `<div class="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs text-slate-700 leading-relaxed">
            <div>${open}
            </div>
            <div>
                <div class="section-label"><i class="fa-solid fa-shield-halved text-emerald-600"></i> Your data</div>
                <ul class="space-y-2">${data}
                </ul>
            </div>
            <div>
                <div class="section-label"><i class="fa-solid fa-flag-checkered text-emerald-600"></i> First steps</div>
                <ol class="space-y-2">
                    ${step(1, 'presupuesto/ingresos', 'Income & Taxes', 'your salary and bonuses.')}
                    ${step(2, 'presupuesto/plan', 'Monthly Budget', 'give every dollar a line.')}
                    ${step(3, 'futuro/metas', 'Debts & Goals', 'add your debts and goals.')}
                    ${step(4, 'futuro/polizas', 'CDs', 'add your CDs.')}
                    ${step(5, 'patrimonio', 'Net Worth', 'what you own and what you owe.')}
                    ${step(6, 'resumen', 'Overview', 'tells you your next step.')}
                </ol>
            </div>
        </div>`;
    }

    // "Where every dollar goes": one bar of the month's plan by group (Engine.budgetBuckets), on
    // the scale of the income, so a zero-based plan fills it exactly. Each group keeps its color
    // (fixed palette slot) whether or not the others are there; the gray end is money left to
    // assign. Large segments carry their % inside; the legend and the table carry every amount.
    // compact: the Overview version (bar + short legend, no table).
    function dollarHTML(r, { compact = false, tableId = '' } = {}) {
        const pal = UI.palette();
        const tr = (s) => (root.I18n ? I18n.t(s) : s);
        const income = Math.max(0, r.income);
        const scale = Math.max(income, r.assigned, 1);
        const pct = (v) => (income > 0 ? Math.round(v / income * 100) : 0);
        const segs = r.buckets.map((b, i) => ({ ...b, color: pal.series[i % pal.series.length] })).filter(b => b.amount > 0.005);
        const left = r.left > 0.005 ? r.left : 0;
        const bar = segs.map(b => {
            const share = b.amount / scale;
            const label = !compact && share >= 0.09 ? `${pct(b.amount)}%` : '';
            return `<span class="dollar-seg" style="flex:${share.toFixed(4)} 1 0;background:${b.color};color:${pal.inkOn(b.color)}" title="${esc(tr(b.label))}: ${money0(b.amount)} (${pct(b.amount)}%)">${label}</span>`;
        }).join('') + (left ? `<span class="dollar-seg dollar-left" style="flex:${(left / scale).toFixed(4)} 1 0" title="${esc(tr('Left to assign'))}: ${money0(left)} (${pct(left)}%)">${!compact && left / scale >= 0.09 ? `${pct(left)}%` : ''}</span>` : '');
        const over = r.left < -0.005;
        const marker = over ? `<span class="dollar-income" style="left:${(income / scale * 100).toFixed(2)}%" title="${esc(tr('Your income'))}: ${money0(income)}"></span>` : '';
        const item = (color, label, amount, cls = '') => `<li class="${cls}"><i style="background:${color}"></i><span>${esc(label)}</span>${compact ? '' : ` <b>${money0(amount)}</b>`} <span class="dollar-pct">${pct(amount)}%</span></li>`;
        const legend = segs.map(b => item(b.color, b.label, b.amount)).join('') + (left ? item('', 'Left to assign', left, 'is-left') : '');
        const status = over
            ? `<p class="dollar-status is-over"><i class="fa-solid fa-triangle-exclamation"></i> You assigned ${money0(-r.left)} more than you earn: the line marks your income.</p>`
            : left ? `<p class="dollar-status"><i class="fa-solid fa-coins"></i> You have ${money0(left)} left to assign.</p>`
            : `<p class="dollar-status is-ok"><i class="fa-solid fa-circle-check"></i> Zero-based: every dollar has a job.</p>`;
        const aria = `${tr('Your plan for the month by group')}: ${segs.map(b => `${tr(b.label)} ${pct(b.amount)}%`).join(', ')}${left ? `, ${tr('Left to assign')} ${pct(left)}%` : ''}`;
        const table = compact ? '' : `<details class="mt-2">
                <summary class="text-xs font-bold text-slate-600 cursor-pointer"><i class="fa-solid fa-table"></i> See the numbers in a table</summary>
                <div class="table-wrap mt-2"><table class="table"${tableId ? ` id="${tableId}"` : ''}><thead><tr><th>Group</th><th class="num">Planned</th><th class="num">% of income</th></tr></thead><tbody>
                ${r.buckets.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${money0(b.amount)}</td><td class="num">${pct(b.amount)}%</td></tr>`).join('')}
                <tr class="font-bold"><td>Total assigned</td><td class="num">${money0(r.assigned)}</td><td class="num">${pct(r.assigned)}%</td></tr>
                <tr><td>${over ? 'Missing' : 'Left to assign'}</td><td class="num">${money0(r.left)}</td><td class="num">${pct(r.left)}%</td></tr>
                <tr><td>Ingreso</td><td class="num">${money0(income)}</td><td class="num">100%</td></tr>
                </tbody></table></div></details>`;
        return `<div class="dollar-wrap${compact ? ' is-compact' : ''}"><div class="dollar-bar" role="img" aria-label="${esc(aria)}">${bar}${marker}</div>
            <ul class="dollar-legend">${legend}</ul>${status}${table}</div>`;
    }

    // Replace a block's markup on every update without closing a "see the numbers" table the
    // person opened.
    function htmlKeepOpen(id, html) {
        const el = document.getElementById(id);
        if (!el) return;
        const open = UI.$$('details', el).map(d => d.open);
        el.innerHTML = html;
        UI.$$('details', el).forEach((d, i) => { if (open[i]) d.open = true; });
    }

    // Retirement need vs. have (Engine.retirementGap) from the context: the income wanted
    // (default 80% of today's income) and the projection the Retirement view shows.
    function retireGap(ctx) {
        const r = ctx.retirement, inp = ctx.retirementInputs, want = ctx.state.retirement.ingresoDeseado;
        const def = Math.round(ctx.baseBudget.income * 0.8 / 50) * 50;
        const desired = want === null || want === undefined ? def : Number(want) || 0;
        const g = Engine.retirementGap({ desiredMonthly: desired, pensionMonthly: r.pension, withdrawalPct: inp.tasaRetiroSegura, haveToday: r.valorFuturoHoy, months: r.aniosRestantes * 12, returnPct: r.tasaRetorno, inflationPct: r.inflacion, bridgeYears: r.aniosPuente });
        return { g, desired, def, custom: !(want === null || want === undefined) };
    }

    // "Whose?" choices: not set, the household (shared), then each person.
    function whoOptions(selected, blank = '—') {
        const sel = String(selected === undefined || selected === null ? '' : selected);
        const opt = (v, l) => `<option value="${v}" ${String(v) === sel ? 'selected' : ''}>${esc(l)}</option>`;
        return opt('', blank) + opt(Engine.HOUSEHOLD, 'Household (shared)') + (Store.state.members || []).map(p => opt(p.id, p.name)).join('');
    }
    // A category and its subcategory as shown ("Food › Groceries"): saved names are Spanish
    // identifiers, so each one is translated (the page translator can't split on "›").
    function catPath(parent, sub) {
        const t = (x) => (root.I18n ? I18n.t(x) : x);
        return [parent, sub].filter(Boolean).map(t).join(' › ');
    }
    function whoName(id) {
        if (id === Engine.HOUSEHOLD || id === String(Engine.HOUSEHOLD)) return 'Household';
        const p = (Store.state.members || []).find(x => String(x.id) === String(id));
        return p ? p.name : '';
    }

    root.Views = { whoOptions, whoName, catPath, retireGap, guideHTML, STEP_INFO, stepsHTML, spendBadge, kpiCard, emptyState, selectOptions, monthOptions, dollarHTML, htmlKeepOpen };
})(this);
