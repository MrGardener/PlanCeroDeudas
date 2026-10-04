/* Deudas y Metas → ¿Y si pierdo mi trabajo?: how many months the household would last on what it
 * has saved if the main paycheck stopped today, spending only what can't be cut. Every budget
 * line can be kept or cut; fixed and variable needs are kept by default, savings are cut, debts
 * keep only their minimum. Income that continues, an unemployment benefit and a severance count
 * too. Settings live in state.runway: { keep: { lineId: bool }, other, benefit, benefitMonths, lump }. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    const cfg = () => Store.state.runway || (Store.state.runway = { keep: {}, other: null, benefit: 0, benefitMonths: 0, lump: 0 });

    // What each line would cost in a lean month, and whether it's kept by default.
    function lines(ctx) {
        const s = ctx.state, keep = cfg().keep || {};
        return (ctx.year.budgetBase || []).filter(i => i.type !== 'Ingreso').map(i => {
            const id = String(i.id);
            const debt = id.startsWith('debt-') ? (s.debts || []).find(d => 'debt-' + d.id === id) : null;
            const amount = debt ? Math.min(Number(debt.minPayment) || 0, Number(debt.balance) || 0) : Number(i.real) || 0;
            const def = debt ? true : (i.type === 'Gasto Fijo' || i.type === 'Gasto Variable');
            return { id, name: i.name, amount, debt: !!debt, on: id in keep ? !!keep[id] : def, type: i.type };
        }).filter(l => l.amount > 0);
    }

    function compute(ctx) {
        const s = ctx.state, c = cfg();
        const list = lines(ctx);
        const needs = list.filter(l => l.on).reduce((a, l) => a + l.amount, 0);
        const autoOther = (ctx.year.otherIncomes || []).reduce((a, x) => a + (Number(x.amount) || 0), 0);
        const other = c.other === null || c.other === undefined ? autoOther : Number(c.other) || 0;
        const checking = Engine.accountTotal(s.accounts, 'cash');
        const cash = ctx.pools.emergency + checking;
        const benefits = Array.isArray(c.benefits) && c.benefits.length ? c.benefits : new Array(Math.max(0, Number(c.benefitMonths) || 0)).fill(Number(c.benefit) || 0);
        const r = Engine.jobLossRunway({ cash, monthlyNeeds: needs, otherIncome: other, benefits, lumpSum: Number(c.lump) || 0 });
        return { list, needs, other, autoOther, cash, checking, benefits, r, c };
    }

    function render(ctx) {
        if (!document.getElementById('metas-runway')) return;
        const c = cfg();
        const ec = Store.COUNTRY !== 'US';
        const v = (x) => (x === null || x === undefined ? '' : x);
        UI.html('runway-inputs', `
            <label class="field"><span class="field-label">Other income that would keep coming ($/mo)</span>
                <input type="number" class="input" min="0" step="10" id="runway-other" data-input="runway.set" data-key="other" value="${esc(String(v(c.other)))}" placeholder="">
                <span class="help" id="runway-other-help"></span></label>
            <label class="field"><span class="field-label">Unemployment benefit ($/mo)</span>
                <input type="number" class="input" min="0" step="10" data-input="runway.set" data-key="benefit" value="${esc(String(v(c.benefit)))}" ${Array.isArray(c.benefits) && c.benefits.length ? 'disabled' : ''}>
                <span class="help">${ec ? 'The IESS pays 5 months if you have at least 24 contributions. <button type="button" class="link" data-action="runway.iess">Estimate it from my salary</button>' : 'It depends on your state (in Michigan, up to 26 weeks). Check what you\'d get.'}</span></label>
            <label class="field"><span class="field-label">For how many months?</span>
                <input type="number" class="input" min="0" max="24" step="1" data-input="runway.set" data-key="benefitMonths" value="${esc(String(v(c.benefitMonths)))}" ${Array.isArray(c.benefits) && c.benefits.length ? 'disabled' : ''}></label>
            <label class="field"><span class="field-label">${ec ? 'Severance when leaving ($)' : 'Severance when leaving ($)'}</span>
                <input type="number" class="input" min="0" step="100" data-input="runway.set" data-key="lump" value="${esc(String(v(c.lump)))}"></label>
            ${Array.isArray(c.benefits) && c.benefits.length ? `<p class="help sm:col-span-2"><i class="fa-solid fa-circle-info"></i> Estimated IESS insurance: ${c.benefits.map(b => money0(b)).join(' · ')}. <button type="button" class="link" data-action="runway.clearIess">Remove the estimate</button></p>` : ''}`);
        const list = lines(ctx);
        UI.html('runway-lines', list.length ? list.map(l => `<label class="runway-line"><input type="checkbox" data-change="runway.keep" data-id="${esc(l.id)}" ${l.on ? 'checked' : ''}><span class="flex-1 min-w-0 truncate" data-i18n-skip>${esc(l.name)}</span><span class="text-slate-500 whitespace-nowrap">${money0(l.amount)}${l.debt ? ' <span class="text-[10px]">min.</span>' : ''}</span></label>`).join('')
            : '<p class="help">Build your budget to see which expenses would continue.</p>');
        update(ctx);
    }

    function update(ctx) {
        if (!document.getElementById('metas-runway')) return;
        const x = compute(ctx);
        const { r } = x;
        const otherInput = document.getElementById('runway-other');
        if (otherInput) otherInput.placeholder = money0(x.autoOther);
        UI.text('runway-other-help', x.c.other === null || x.c.other === undefined ? `Empty = the other income in your budget (${money0(x.autoOther)}).` : '');
        const months = r.forever ? '∞' : r.months >= 60 ? '60+' : r.months.toFixed(1);
        const tone = r.forever || r.months >= 6 ? 'tone-emerald' : r.months >= 3 ? 'tone-amber' : 'tone-red';
        UI.html('runway-kpis', `
            <div class="kpi ${tone}"><span class="kpi-label">You'd last</span><span class="kpi-value">${months} <span class="text-sm font-semibold">months</span></span><span class="kpi-note">${r.forever ? 'What keeps coming in covers the essentials.' : `until ${Fmt.monthYear(Engine.addMonths(ctx.today, Math.floor(r.months)))}`}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Money on hand</span><span class="kpi-value">${money0(x.cash + (Number(x.c.lump) || 0))}</span><span class="kpi-note">emergency fund ${money0(ctx.pools.emergency)} + accounts ${money0(x.checking)}${Number(x.c.lump) ? ` + liquidación ${money0(x.c.lump)}` : ''}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Bare-bones spending</span><span class="kpi-value">${money0(x.needs)}<span class="text-sm font-semibold">/mo</span></span><span class="kpi-note">${x.other ? `minus ${money0(x.other)} that keeps coming in` : 'no other income'}</span></div>`);
        // Tips: the kept lines that would stretch it the most if cut (variable ones first).
        const cuts = x.list.filter(l => l.on && !l.debt && l.type === 'Gasto Variable').sort((a, b) => b.amount - a.amount).slice(0, 3);
        if (!r.forever && cuts.length) {
            const save = cuts.reduce((a, l) => a + l.amount * 0.5, 0);
            const r2 = Engine.jobLossRunway({ cash: x.cash, monthlyNeeds: x.needs - save, otherIncome: x.other, benefits: x.benefits, lumpSum: Number(x.c.lump) || 0 });
            UI.html('runway-tip', `<i class="fa-solid fa-lightbulb text-amber-500"></i> If you cut ${cuts.map(l => `<strong data-i18n-skip>${esc(l.name)}</strong>`).join(', ')} in half, you'd reach <strong>${r2.forever ? '∞' : r2.months >= 60 ? '60+' : r2.months.toFixed(1)} months</strong>.`);
        } else UI.html('runway-tip', '');
        const pal = UI.palette();
        const path = r.path.slice(0, Math.min(r.path.length, 25));
        UI.chart('runway-chart', {
            type: 'bar',
            data: { labels: path.map((_, i) => i === 0 ? 'Today' : Fmt.monthYear(Engine.addMonths(ctx.today, i))), datasets: [{ label: 'You\'d have left', data: path, backgroundColor: path.map(v => v > x.needs ? pal.alpha(pal.blue, 0.75) : pal.alpha(pal.orange, 0.8)), borderRadius: 4, borderSkipped: 'start' }] },
            options: { plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
        });
    }

    UI.register({
        'runway.set': (el) => {
            const c = cfg(), k = el.dataset.key;
            c[k] = el.value === '' ? (k === 'other' ? null : 0) : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        },
        'runway.keep': (el) => {
            const c = cfg();
            (c.keep || (c.keep = {}))[el.dataset.id] = el.checked;
            App.changed({ step: true });
        },
        'runway.iess': () => {
            const yd = Store.active();
            const c = cfg();
            App.undoable('IESS unemployment insurance estimated (5 months). Confirm it with the IESS.', () => { c.benefits = Engine.iessUnemployment(Number(yd.sueldo) || 0); });
        },
        'runway.clearIess': () => { const c = cfg(); App.undoable('Estimate removed', () => { delete c.benefits; }); }
    });

    window.Runway = { render, update };
})();
