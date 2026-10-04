/* Deudas y Metas → Revisión de seguros: the coverage a household should have (Engine.insuranceCheck),
 * guessed from the budget and recent transactions, confirmed or corrected by the user.
 * state.insurance: { answers: { key: 'si' | 'no' }, life: total life coverage, dependents: bool|null }. */
(function () {
    'use strict';
    const { money0, esc } = Fmt;
    const cfg = () => Store.state.insurance || (Store.state.insurance = { answers: {}, life: 0, dependents: null });

    function facts(ctx) {
        const s = ctx.state, c = cfg(), yd = ctx.year;
        const since = Engine.isoDate(new Date(ctx.today.getFullYear() - 1, ctx.today.getMonth(), ctx.today.getDate()));
        const seen = (yd.budgetBase || []).map(i => i.name).concat(s.transactions.filter(t => t.date >= since && (t.type || 'Gasto') === 'Gasto').map(t => `${t.category || ''} ${t.description || ''} ${t.store || ''}`));
        // Paycheck deductions (employer health, life, disability plans) and the mortgage's escrow.
        const KIND = { health: 'health insurance', life: 'life insurance', disability: 'disability' };
        (yd.payDeductions || []).forEach(d => seen.push(`${d.name || ''} ${KIND[d.kind] || ''}`));
        if (ctx.ownsHome && Number((s.mortgage || {}).homeInsurance) > 0) seen.push('homeowner');
        // In Ecuador a salaried worker is covered by the IESS (health and disability pension).
        if (yd.country !== 'US' && Number(yd.sueldo) > 0) seen.push('IESS');
        const income = ((Number(yd.sueldo) || 0) + (yd.otherIncomes || []).reduce((a, x) => a + (Number(x.amount) || 0), 0)) * 12;
        const dependents = c.dependents === null || c.dependents === undefined ? (s.members || []).length > 1 : !!c.dependents;
        const hasCar = (s.assets || []).some(a => a.category === 'Vehículo' && a.status !== 'Vendido') || (s.debts || []).some(d => d.kind === 'vehicular');
        return { income, dependents, lifeCoverage: Number(c.life) || 0, ownsHome: ctx.ownsHome, hasCar, netWorth: ctx.netWorth.value, age: Number(s.retirement.edadActual) || 0, seen, answers: c.answers || {}, money: money0 };
    }

    function render(ctx) {
        if (!document.getElementById('metas-insurance')) return;
        const c = cfg(), f = facts(ctx), r = Engine.insuranceCheck(f);
        UI.text('ins-count', r.missing + r.review);
        UI.show('ins-count', r.missing + r.review > 0);
        const ICON = { ok: 'fa-circle-check text-emerald-600', falta: 'fa-circle-xmark text-red-600', revisar: 'fa-triangle-exclamation text-amber-600', na: 'fa-circle-minus text-slate-400' };
        const STATUS = { ok: 'You have it', falta: 'Missing', revisar: 'Check the coverage', na: 'Not needed yet' };
        UI.html('ins-list', r.items.map(i => `<li class="ins-row ${i.status}">
            <i class="fa-solid ${ICON[i.status]} mt-0.5"></i>
            <div class="min-w-0 flex-1"><div class="font-bold text-xs">${esc(i.label)} <span class="text-[11px] font-semibold text-slate-500">· <span>${STATUS[i.status]}</span>${i.guessed && i.needed ? ' <span>(we saw it in your budget)</span>' : ''}</span></div>
                <p class="text-[11px] text-slate-600">${esc(i.why)}</p>
                ${i.key === 'life' && i.needed ? `<label class="flex items-center gap-2 mt-1 text-[11px]"><span>Total life coverage you have ($)</span><input type="number" class="cell-input num" style="width:8rem" min="0" step="10000" data-input="ins.life" value="${Number(c.life) || ''}" placeholder="0"></label>${i.has && !(Number(c.life) > 0) ? '<p class="text-[11px] text-slate-500 mt-1">Enter how much it covers to see if it\'s enough.</p>' : r.lifeGap > 0 && i.has ? `<p class="text-[11px] text-amber-700 mt-1">You'd be ${money0(r.lifeGap)} of coverage short.</p>` : ''}` : ''}</div>
            ${i.needed ? `<select class="cell-input text-xs" style="width:auto" data-change="ins.answer" data-key="${i.key}" aria-label="Do you have it?">${Views.selectOptions([{ value: '', label: 'Automático' }, { value: 'si', label: 'I have it' }, { value: 'no', label: 'I don\'t have it' }], (c.answers || {})[i.key] || '')}</select>` : ''}
        </li>`).join(''));
        const dep = document.getElementById('ins-dependents');
        if (dep) dep.checked = f.dependents;
    }

    UI.register({
        'ins.answer': (el) => {
            const c = cfg();
            c.answers = Object.assign({}, c.answers);
            if (el.value) c.answers[el.dataset.key] = el.value; else delete c.answers[el.dataset.key];
            App.changed({ structural: true, step: true });
        },
        'ins.life': (el) => { cfg().life = Math.max(0, Fmt.parseNum(el.value, 0)); App.changed({ step: true }); },
        'ins.dependents': (el) => { cfg().dependents = el.checked; App.changed({ structural: true, step: true }); }
    });

    window.Insurance = { render };
})();
