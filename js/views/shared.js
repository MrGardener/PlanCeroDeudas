/* Shared view helpers: markup builders used by more than one tab. */
(function (root) {
    'use strict';
    const { money, money0, esc } = Fmt;

    // Ecuador-adapted Baby Steps: what each step means and where in the app you work on it.
    const STEP_INFO = {
        1: { text: '$1,000 líquidos para imprevistos sin recurrir a tarjetas.', goto: 'futuro/metas', focus: 'metas-ef' },
        2: { text: 'Elimina las deudas de consumo, de la más pequeña a la más grande.', goto: 'futuro/metas', focus: 'metas-debts' },
        3: { text: '3–6 meses de gastos esenciales para desempleo o imprevistos que el IESS no cubre.', goto: 'futuro/metas', focus: 'metas-ef' },
        4: { text: 'Invierte el 15% de tu sueldo en DPF de cooperativas Segmento 1 (COSEDE).', goto: 'futuro/jubilacion' },
        5: { text: 'Pólizas DPF acumulativas para los estudios de tus hijos.', goto: 'futuro/metas', focus: 'metas-goals' },
        6: { text: 'Abonos extraordinarios a tu préstamo BIESS o bancario.', goto: 'futuro/hipoteca' },
        7: { text: 'Libertad financiera: sigue invirtiendo y da con generosidad.', goto: 'patrimonio' }
    };

    function stepsHTML(ctx, { compact = false } = {}) {
        return ctx.steps.steps.map(s => {
            const info = STEP_INFO[s.n];
            const icon = s.state === 'done' ? '<i class="fa-solid fa-check"></i>' : s.n;
            const status = s.state === 'done' ? '<span class="badge badge-ok">Completado</span>'
                : s.state === 'current' ? '<span class="badge badge-info">En curso</span>'
                : s.n === 7 ? '<span class="badge badge-muted">Meta final</span>'
                : s.done === null ? '<span class="badge badge-muted">Opcional</span>' : '';
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
            case 'unbudgeted': return `<span class="badge badge-bad">${money(st.spent)} sin presupuesto</span>`;
            case 'untouched': return `<span class="badge badge-info" title="Sin transacciones en el período">$0 de ${money0(st.target)}</span>`;
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
        return [{ value: 'base', label: 'Presupuesto base (todo el año)' }].concat(Engine.MONTHS.map(m => {
            let note = '';
            if (m === '12' && yd.d3) note = ' · + Décimo 3ro';
            if (m === d4 && yd.d4) note += ' · + Décimo 4to';
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
                <div class="section-label"><i class="fa-solid fa-mobile-screen text-emerald-600"></i> En tu teléfono</div>
                <ul class="space-y-2">
                    ${item('fa-plane', 'Funciona <strong>sin internet</strong>: todo está en tu teléfono. Solo leer un PDF o una foto necesita internet la primera vez.')}
                    ${item('fa-share-nodes', 'Las copias de respaldo y los reportes se abren con <strong>Compartir</strong>: guárdalos en Google Drive o en Archivos, o envíalos por correo.')}
                </ul>` : `
                <div class="section-label"><i class="fa-solid fa-folder-open text-emerald-600"></i> Abrir la app</div>
                <ul class="space-y-2">
                    ${item('fa-file-code', 'Guarda este archivo en una carpeta fácil de encontrar (por ejemplo <strong>Documentos</strong>) y ábrelo con <strong>doble clic</strong>. Se abre en tu navegador; no hay que instalar nada.')}
                    ${item('fa-laptop', 'Funciona mejor en un <strong>computador</strong> con Chrome, Edge o Firefox. En el celular muchos teléfonos no abren bien archivos descargados.')}
                    ${item('fa-wifi', 'Necesitas <strong>internet</strong> al abrirla para ver los estilos y gráficos.')}
                </ul>`;
        const data = app ? `
                    ${item('fa-floppy-disk', 'Todo se <strong>guarda solo</strong>, en este teléfono. Tus datos nunca salen de tu equipo.')}
                    ${item('fa-rotate-left', '¿Te equivocaste? Usa <strong>Deshacer</strong> <i class="fa-solid fa-rotate-left"></i> arriba a la derecha para volver atrás paso a paso.')}
                    ${item('fa-triangle-exclamation', 'Si desinstalas la app o borras sus datos, <strong>se borra tu plan</strong>.')}
                    ${item('fa-download', 'Guarda una <strong>copia de respaldo</strong> cada cierto tiempo en <a href="#" class="link" data-goto="config" data-focus="cfg-data">Configuración → Tus Datos</a>. Para pasar a otro teléfono o a un computador, abre la app allí y usa <strong>Cargar copia</strong>.')}` : `
                    ${item('fa-floppy-disk', 'Todo se <strong>guarda solo</strong>, en este navegador y este computador. Tus datos nunca salen de tu equipo.')}
                    ${item('fa-rotate-left', '¿Te equivocaste? Usa <strong>Deshacer</strong> <i class="fa-solid fa-rotate-left"></i> arriba a la derecha (o Ctrl+Z) para volver atrás paso a paso, y <strong>Rehacer</strong> <i class="fa-solid fa-rotate-right"></i> si te arrepientes.')}
                    ${item('fa-triangle-exclamation', 'Si abres la app en <strong>otro navegador u otro computador</strong>, empezará vacía. Si borras el historial o los datos de navegación, <strong>se borra tu plan</strong>.')}
                    ${item('fa-download', 'Descarga una <strong>copia de respaldo</strong> cada cierto tiempo en <a href="#" class="link" data-goto="config" data-focus="cfg-data">Configuración → Tus Datos</a>. Para pasar a otro equipo, abre la app allí y usa <strong>Cargar copia</strong>.')}`;
        return `<div class="grid grid-cols-1 lg:grid-cols-3 gap-5 text-xs text-slate-700 leading-relaxed">
            <div>${open}
            </div>
            <div>
                <div class="section-label"><i class="fa-solid fa-shield-halved text-emerald-600"></i> Tus datos</div>
                <ul class="space-y-2">${data}
                </ul>
            </div>
            <div>
                <div class="section-label"><i class="fa-solid fa-flag-checkered text-emerald-600"></i> Primeros pasos</div>
                <ol class="space-y-2">
                    ${step(1, 'presupuesto/ingresos', 'Ingresos e Impuestos', 'tu sueldo y décimos.')}
                    ${step(2, 'presupuesto/plan', 'Presupuesto del Mes', 'asigna cada dólar a un rubro.')}
                    ${step(3, 'futuro/metas', 'Deudas y Metas', 'registra tus deudas y metas.')}
                    ${step(4, 'futuro/polizas', 'Pólizas', 'registra tus DPF.')}
                    ${step(5, 'patrimonio', 'Patrimonio', 'lo que tienes y lo que debes.')}
                    ${step(6, 'resumen', 'Resumen', 'te dice cuál es tu siguiente paso.')}
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
        }).join('') + (left ? `<span class="dollar-seg dollar-left" style="flex:${(left / scale).toFixed(4)} 1 0" title="${esc(tr('Por asignar'))}: ${money0(left)} (${pct(left)}%)">${!compact && left / scale >= 0.09 ? `${pct(left)}%` : ''}</span>` : '');
        const over = r.left < -0.005;
        const marker = over ? `<span class="dollar-income" style="left:${(income / scale * 100).toFixed(2)}%" title="${esc(tr('Tu ingreso'))}: ${money0(income)}"></span>` : '';
        const item = (color, label, amount, cls = '') => `<li class="${cls}"><i style="background:${color}"></i><span>${esc(label)}</span>${compact ? '' : ` <b>${money0(amount)}</b>`} <span class="dollar-pct">${pct(amount)}%</span></li>`;
        const legend = segs.map(b => item(b.color, b.label, b.amount)).join('') + (left ? item('', 'Por asignar', left, 'is-left') : '');
        const status = over
            ? `<p class="dollar-status is-over"><i class="fa-solid fa-triangle-exclamation"></i> Asignaste ${money0(-r.left)} más de lo que ganas: la línea marca tu ingreso.</p>`
            : left ? `<p class="dollar-status"><i class="fa-solid fa-coins"></i> Te quedan ${money0(left)} por asignar.</p>`
            : `<p class="dollar-status is-ok"><i class="fa-solid fa-circle-check"></i> Base cero: cada dólar tiene un destino.</p>`;
        const aria = `${tr('Tu plan del mes por grupo')}: ${segs.map(b => `${tr(b.label)} ${pct(b.amount)}%`).join(', ')}${left ? `, ${tr('Por asignar')} ${pct(left)}%` : ''}`;
        const table = compact ? '' : `<details class="mt-2">
                <summary class="text-xs font-bold text-slate-600 cursor-pointer"><i class="fa-solid fa-table"></i> Ver los números en una tabla</summary>
                <div class="table-wrap mt-2"><table class="table"${tableId ? ` id="${tableId}"` : ''}><thead><tr><th>Grupo</th><th class="num">Planeado</th><th class="num">% del ingreso</th></tr></thead><tbody>
                ${r.buckets.map(b => `<tr><td>${esc(b.label)}</td><td class="num">${money0(b.amount)}</td><td class="num">${pct(b.amount)}%</td></tr>`).join('')}
                <tr class="font-bold"><td>Total asignado</td><td class="num">${money0(r.assigned)}</td><td class="num">${pct(r.assigned)}%</td></tr>
                <tr><td>${over ? 'Te falta' : 'Por asignar'}</td><td class="num">${money0(r.left)}</td><td class="num">${pct(r.left)}%</td></tr>
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

    root.Views = { retireGap, guideHTML, STEP_INFO, stepsHTML, spendBadge, kpiCard, emptyState, selectOptions, monthOptions, dollarHTML, htmlKeepOpen };
})(this);
