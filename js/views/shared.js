/* Shared view helpers: markup builders used by more than one tab. */
(function (root) {
    'use strict';
    const { money, money0, esc } = Fmt;

    // Ecuador-adapted Baby Steps: what each step means and where in the app you work on it.
    const STEP_INFO = {
        1: { text: '$1,000 líquidos para imprevistos sin recurrir a tarjetas.', goto: 'metas', focus: 'metas-ef' },
        2: { text: 'Elimina las deudas de consumo, de la más pequeña a la más grande.', goto: 'metas', focus: 'metas-debts' },
        3: { text: '3–6 meses de gastos esenciales para desempleo o imprevistos que el IESS no cubre.', goto: 'metas', focus: 'metas-ef' },
        4: { text: 'Invierte el 15% de tu sueldo en DPF de cooperativas Segmento 1 (COSEDE).', goto: 'jubilacion' },
        5: { text: 'Pólizas DPF acumulativas para los estudios de tus hijos.', goto: 'metas', focus: 'metas-goals' },
        6: { text: 'Abonos extraordinarios a tu préstamo BIESS o bancario.', goto: 'hipoteca' },
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

    function kpiCard({ tone, icon, label, value, note, goto, focus }) {
        return `
            <button type="button" class="card dash-card" data-goto="${goto}" ${focus ? `data-focus="${focus}"` : ''}>
                <div class="flex items-center justify-between mb-2">
                    <span class="text-xs font-extrabold uppercase tracking-wide text-slate-500"><i class="fa-solid ${icon} ${tone} mr-1"></i>${label}</span>
                    <i class="fa-solid fa-arrow-right text-slate-300 text-xs"></i>
                </div>
                <div class="text-2xl font-black text-slate-900 tracking-tight">${value}</div>
                <div class="text-xs text-slate-500 mt-1">${note}</div>
            </button>`;
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
    function netWorthSync(ctx) {
        const s = ctx.state;
        if (s.activeYear !== ctx.today.getFullYear()) return null;
        const f = ctx.netWorth.fields;
        const expected = { investments: ctx.polizasCapital };
        Engine.DEBT_KINDS.forEach(k => { expected[k.netWorthField] = 0; });
        s.debts.forEach(d => {
            const k = Engine.DEBT_KINDS.find(x => x.id === d.kind) || Engine.DEBT_KINDS[4];
            expected[k.netWorthField] += Math.max(0, Number(d.balance) || 0);
        });
        const off = Object.keys(expected).filter(k => Math.abs((f[k] || 0) - expected[k]) > 1);
        const debtTotal = s.debts.reduce((t, d) => t + Math.max(0, Number(d.balance) || 0), 0);
        return off.length ? { polizas: ctx.polizasCapital, debts: debtTotal } : null;
    }

    root.Views = { STEP_INFO, stepsHTML, spendBadge, kpiCard, selectOptions, monthOptions, netWorthSync };
})(this);
