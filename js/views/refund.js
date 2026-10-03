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
        if (!el || ctx.year.country !== 'US' || ctx.state.activeYear !== ctx.today.getFullYear()) { if (el) { UI.html('inc-refund-in', ''); UI.html('inc-refund', '<p class="help">Disponible para el año en curso.</p>'); } return; }
        const yd = ctx.year, c = cfg(yd), p = ctx.pay, k = checks(ctx.today);
        const v = (x) => (x === null || x === undefined ? '' : esc(String(x)));
        const per = Number(c.perCheck) || 0;
        const ytd = c.ytd === null || c.ytd === undefined ? per * k.paid : Number(c.ytd) || 0;
        const field = (key, label, val, help, ph) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" min="0" step="10" data-input="refund.set" data-key="${key}" value="${v(val)}" ${ph ? `placeholder="${esc(ph)}"` : ''}>${help ? `<span class="help">${help}</span>` : ''}</label>`;
        const computedPer = k.paid + k.left > 0 ? p.fedM * 12 / (k.paid + k.left) : 0;
        const inputs = `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
            ${field('perCheck', 'Retención federal por pago ($)', c.perCheck, `De tu último talón ("Federal Withholding"). Con tu W-4 sería unos ${money0(computedPer)}.`)}
            ${field('ytd', 'Retenido en el año hasta hoy ($)', c.ytd, `El acumulado del talón ("YTD"). Vacío = ${k.paid} pagos × lo de arriba.`, money0(per * k.paid))}
            ${field('spouseWages', 'Sueldo bruto de tu pareja al año ($)', c.spouseWages, yd.filingStatus === 'mfj' ? 'Si también trabaja con W-2.' : 'Solo si declaran juntos.')}
            ${field('spouseWithheld', 'Su retención federal del año ($)', c.spouseWithheld, '')}
            ${field('untaxed', 'Otros ingresos sin retención ($/año)', c.untaxed, 'Intereses, trabajos por tu cuenta, etc.')}
        </div>`;
        // Inputs are drawn once (re-drawing them while typing would lose the cursor).
        const box = document.getElementById('inc-refund-in');
        if (box && !box.contains(document.activeElement)) UI.html('inc-refund-in', inputs);
        if (!per && !Number(c.ytd)) { UI.html('inc-refund', '<p class="text-xs mt-3"><i class="fa-solid fa-circle-info text-blue-600"></i> Escribe la retención federal de tu último talón de pago para ver si te devolverán o deberás.</p>'); return; }
        const r = Engine.usRefundEstimate({ yd, wagesIncome: p.incomeWages, otherWages: c.spouseWages, otherWithheld: c.spouseWithheld, untaxedIncome: c.untaxed, withheldYtd: ytd, perCheck: per, checksLeft: k.left });
        const big = Math.abs(r.diff) >= 500;
        const tone = r.diff >= 0 && r.diff < 1500 ? 'tone-emerald' : r.diff >= 0 ? 'tone-amber' : 'tone-red';
        const w4 = r.adjustPerCheck === null ? '' : r.diff < -100
            ? `<p class="text-xs mt-2"><strong>W-4:</strong> para no deber, pide <strong>${money(r.adjustPerCheck)} más por pago</strong> (paso 4(c), "Extra withholding") en tus ${k.left} pagos que quedan.${r.penaltyRisk ? ' <span class="text-red-700">Deber más de $1,000 puede traer multa por pago insuficiente.</span>' : ''}</p>`
            : r.diff > 1500 ? `<p class="text-xs mt-2"><strong>W-4:</strong> le prestas ${money0(r.diff)} sin intereses al IRS. Podrías retener unos <strong>${money(-r.adjustPerCheck)} menos por pago</strong> y mandar ese dinero a tu plan cada mes.</p>`
            : '<p class="text-xs mt-2 text-emerald-700"><i class="fa-solid fa-circle-check"></i> Tu retención está bien ajustada.</p>';
        UI.html('inc-refund', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3 mt-4">
                <div class="kpi tone-slate"><span class="kpi-label">Impuesto federal del año</span><span class="kpi-value">${money0(r.tax)}</span><span class="kpi-note">sobre ${money0(r.income)}, menos ${money0(r.dedApplied)} de deducción${r.credits ? ` y ${money0(r.credits)} en créditos` : ''}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Retenido en el año</span><span class="kpi-value">${money0(r.withheld)}</span><span class="kpi-note">${money0(ytd)} hasta hoy + ${k.left} pagos${k.assumed ? ' (cada 2 semanas)' : ''}</span></div>
                <div class="kpi ${tone}"><span class="kpi-label">${r.diff >= 0 ? 'Te devolverían' : 'Deberías'}</span><span class="kpi-value">${money0(Math.abs(r.diff))}</span><span class="kpi-note">${big ? (r.diff >= 0 ? 'en abril' : 'al declarar en abril') : 'casi en cero'}</span></div>
            </div>${w4}
            <p class="help mt-2">Estimado solo del impuesto federal sobre sueldos (no estatal, ni créditos especiales). Para el W-4 exacto, usa el Tax Withholding Estimator del IRS.</p>`);
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
