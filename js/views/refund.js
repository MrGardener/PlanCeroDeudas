/* Ingresos (US) → ¿Te devuelven o debes?: the year's federal tax for the household against what will
 * have been withheld (so far + per paycheck × paychecks left), and the W-4 change that evens it out.
 * yd.withholding: { perCheck, ytd (null = estimated), spouseWages, spouseWithheld, untaxed }. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const cfg = (yd) => yd.withholding || (yd.withholding = { perCheck: null, ytd: null, spouseWages: 0, spouseWithheld: 0, untaxed: 0 });

    // Paychecks paid so far this year and still to come (the pay schedule, or every 2 weeks).
    function checks(today) {
        const sch = Store.state.settings.paySchedule || (Store.state.settings.paydays || []).length && Store.state.settings.paydays;
        const y = today.getFullYear(), t = Engine.isoDate(today);
        const next = Engine.isoDate(new Date(y, today.getMonth(), today.getDate() + 1));
        const paid = sch ? Engine.payDates(sch, `${y}-01-01`, t).length : Math.floor((today - new Date(y, 0, 1)) / 86400000 / 14);
        const left = sch ? Engine.payDates(sch, next, `${y}-12-31`).length : Math.ceil((new Date(y, 11, 31) - today) / 86400000 / 14);
        return { paid, left, assumed: !sch };
    }

    function render(ctx) {
        const el = document.getElementById('inc-refund');
        if (!el || ctx.year.country !== 'US' || ctx.state.activeYear !== ctx.today.getFullYear()) { if (el) { UI.html('inc-refund-in', ''); UI.html('inc-refund', '<p class="help">Available for the current year.</p>'); } return; }
        const yd = ctx.year, c = cfg(yd), p = ctx.pay, k = checks(ctx.today);
        const v = (x) => (x === null || x === undefined ? '' : esc(String(x)));
        const per = Number(c.perCheck) || 0;
        const ytd = c.ytd === null || c.ytd === undefined ? per * k.paid : Number(c.ytd) || 0;
        const field = (key, label, val, help, ph) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" min="0" step="10" data-input="refund.set" data-key="${key}" value="${v(val)}" ${ph ? `placeholder="${esc(ph)}"` : ''}>${help ? `<span class="help">${help}</span>` : ''}</label>`;
        const computedPer = k.paid + k.left > 0 ? p.fedM * 12 / (k.paid + k.left) : 0;
        const inputs = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${field('perCheck', 'Federal withholding per paycheck ($)', c.perCheck, `From your latest pay stub ("Federal Withholding"). Based on your W-4 it would be about ${money0(computedPer)}.`)}
            ${field('ytd', 'Withheld so far this year ($)', c.ytd, `The stub's year-to-date ("YTD"). Empty = ${k.paid} paychecks × the amount above.`, money0(per * k.paid))}
            ${field('spouseWages', 'Your spouse\'s yearly gross pay ($)', c.spouseWages, yd.filingStatus === 'mfj' ? 'If they also have W-2 wages.' : 'Only if you file jointly.')}
            ${field('spouseWithheld', 'Their federal withholding for the year ($)', c.spouseWithheld, '')}
            ${field('untaxed', 'Other income with no withholding ($/yr)', c.untaxed, 'Interest, side work, etc.')}
        </div>`;
        // Inputs are drawn once (re-drawing them while typing would lose the cursor).
        const box = document.getElementById('inc-refund-in');
        if (box && !box.contains(document.activeElement)) UI.html('inc-refund-in', inputs);
        if (!per && !Number(c.ytd)) { UI.html('inc-refund', '<p class="text-xs mt-3"><i class="fa-solid fa-circle-info text-blue-600"></i> Enter the federal withholding from your latest pay stub to see whether you\'ll get a refund or owe.</p>'); return; }
        const r = Engine.usRefundEstimate({ yd, wagesIncome: p.incomeWages, otherWages: c.spouseWages, otherWithheld: c.spouseWithheld, untaxedIncome: c.untaxed, withheldYtd: ytd, perCheck: per, checksLeft: k.left, stdExtra: window.Itemize ? Itemize.giftsOffStandard(ctx) : 0 });
        const big = Math.abs(r.diff) >= 500;
        const tone = r.diff >= 0 && r.diff < 1500 ? 'tone-emerald' : r.diff >= 0 ? 'tone-amber' : 'tone-red';
        const w4 = r.adjustPerCheck === null ? '' : r.diff < -100
            ? `<p class="text-xs mt-2"><strong>W-4:</strong> to avoid owing, ask for <strong>${money(r.adjustPerCheck)} more per paycheck</strong> (Step 4(c), "Extra withholding") on your ${k.left} remaining paychecks.${r.penaltyRisk ? ' <span class="text-red-700">Owing more than $1,000 can bring an underpayment penalty.</span>' : ''}</p>`
            : r.diff > 1500 ? `<p class="text-xs mt-2"><strong>W-4:</strong> you're lending the IRS ${money0(r.diff)} interest-free. You could withhold about <strong>${money(-r.adjustPerCheck)} less per paycheck</strong> and send that money to your plan each month.</p>`
            : '<p class="text-xs mt-2 text-emerald-700"><i class="fa-solid fa-circle-check"></i> Your withholding is well tuned.</p>';
        UI.html('inc-refund', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div class="kpi tone-slate"><span class="kpi-label">Federal tax for the year</span><span class="kpi-value">${money0(r.tax)}</span><span class="kpi-note">on ${money0(r.income)}, minus ${money0(r.dedApplied)} deduction${r.credits ? ` and ${money0(r.credits)} in credits` : ''}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Withheld for the year</span><span class="kpi-value">${money0(r.withheld)}</span><span class="kpi-note">${money0(ytd)} so far + ${k.left} paychecks${k.assumed ? ' (every 2 weeks)' : ''}</span></div>
                <div class="kpi ${tone}"><span class="kpi-label">${r.diff >= 0 ? 'Your refund would be' : 'Deberías'}</span><span class="kpi-value">${money0(Math.abs(r.diff))}</span><span class="kpi-note">${big ? (r.diff >= 0 ? 'in April' : 'when you file in April') : 'close to zero'}</span></div>
            </div>${w4}
            <p class="help mt-2">An estimate of federal tax on wages only (not state, nor special credits). For an exact W-4, use the IRS Tax Withholding Estimator.</p>`);
    }

    UI.register({
        'refund.set': (el) => {
            const c = cfg(Store.active()), k = el.dataset.key;
            c[k] = el.value === '' ? (k === 'perCheck' || k === 'ytd' ? null : 0) : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        }
    });

    window.Refund = { render };
})();
