/* Hipoteca: amortization for the configured system, with an optional monthly extra payment. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    function render(ctx) {
        const slider = document.getElementById('mort-extra-slider');
        slider.max = ctx.state.settings.mortgageWhatIfMax;
        update(ctx);
    }

    function update(ctx) {
        const m = ctx.state.mortgage;
        const system = ctx.state.settings.mortgageSystem === 'aleman' ? 'aleman' : 'frances';
        const months = Math.max(1, Math.round(Number(m.years) || 1)) * 12;
        const base = Engine.amortization(system, m.amount, m.rate, months, 0);
        const extra = Number(m.extraPayment) > 0 ? Engine.amortization(system, m.amount, m.rate, months, m.extraPayment) : null;

        UI.text('mort-system', system === 'aleman' ? 'Alemán (cuota decreciente)' : 'Francés (cuota fija)');
        const slider = document.getElementById('mort-extra-slider');
        slider.value = Math.min(Number(m.extraPayment) || 0, Number(slider.max) || 0);

        const tiles = system === 'aleman'
            ? [['tone-blue', 'Primera cuota', money(base.firstPayment)], ['tone-blue', 'Última cuota', money(base.lastPayment)]]
            : [['tone-blue', 'Cuota mensual', money(base.firstPayment)], ['tone-slate', 'Plazo', Fmt.monthsAsYears(months)]];
        tiles.push(['tone-red', 'Interés total', money0(base.totalInterest)], ['tone-slate', 'Total pagado', money0(base.totalPaid)]);
        // US: what you really pay each month (PITI).
        if (ctx.budgetYear.country === 'US') {
            const p = Engine.pitiMonthly(Object.assign({ payment: base.firstPayment, schedule: (extra || base).schedule }, m));
            const pmiEnd = p.pmi && p.pmiMonths !== null ? ` (por ${Fmt.monthsAsYears(p.pmiMonths)}, ${money0(p.pmiTotal)} en total)` : '';
            tiles.unshift(['tone-amber', 'Pago mensual total (PITI)', `${money(p.total)}<span class="kpi-note block">Capital e interés ${money(p.pi)} · impuesto ${money(p.tax)} · seguro ${money(p.ins)}${p.pmi ? ` · PMI ${money(p.pmi)}${pmiEnd}` : ''}${p.hoa ? ` · HOA ${money(p.hoa)}` : ''}</span>`]);
        }
        let html = tiles.map(([tone, label, value]) => `<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span></div>`).join('');
        if (extra) {
            html += `<div class="kpi tone-emerald col-span-2"><span class="kpi-label"><i class="fa-solid fa-piggy-bank"></i> Con ${money0(m.extraPayment)} extra al mes</span><span class="kpi-value">Terminas en ${Fmt.monthsAsYears(extra.months)}</span><span class="kpi-note">En vez de ${Fmt.monthsAsYears(months)} · ${Fmt.monthsAsYears(months - extra.months)} antes</span></div>
                     <div class="kpi tone-emerald col-span-2"><span class="kpi-label">Interés que te ahorras</span><span class="kpi-value">${money0(base.totalInterest - extra.totalInterest)}</span><span class="kpi-note">Pagas ${money0(extra.totalInterest)} de interés en total</span></div>`;
        }
        UI.html('mort-summary', html);

        const axis = Engine.chartAxis(base.schedule.length);
        const color = system === 'aleman' ? '#059669' : '#3b82f6';
        const opts = { scales: { x: { title: { display: true, text: axis.title, font: { size: 10 } } } } };
        const dataset = (label, schedule, field, cumulative, dashed) => ({
            label, data: Engine.sampleSchedule(schedule, axis, field, cumulative),
            borderColor: dashed ? '#eb6834' : color, borderDash: dashed ? [6, 4] : [], backgroundColor: dashed ? 'transparent' : 'rgba(59,130,246,.08)',
            fill: !dashed, tension: .2, pointRadius: 0, spanGaps: false
        });
        UI.chart('mort-balance-chart', { type: 'line', options: opts, data: { labels: axis.labels, datasets: [dataset('Saldo pendiente', base.schedule, 'balance', false, false)].concat(extra ? [dataset('Saldo con pago extra', extra.schedule, 'balance', false, true)] : []) } });
        UI.chart('mort-interest-chart', { type: 'line', options: opts, data: { labels: axis.labels, datasets: [dataset('Interés acumulado', base.schedule, 'interest', true, false)].concat(extra ? [dataset('Interés con pago extra', extra.schedule, 'interest', true, true)] : []) } });

        const rows = (extra || base).schedule;
        UI.text('mort-table-note', extra ? `con ${money0(m.extraPayment)} extra al mes` : '');
        UI.html('mort-body', rows.map(r => `<tr><td class="text-center">${r.period}</td><td class="num font-bold">${money(r.payment)}</td><td class="num text-red-600">${money(r.interest)}</td><td class="num text-emerald-700">${money(r.principal)}</td><td class="num font-semibold">${money(r.balance)}</td></tr>`).join(''));
    }

    UI.register({
        'mortgage.slider': (el) => {
            Store.state.mortgage.extraPayment = Number(el.value) || 0;
            const input = document.querySelector('[data-bind="mortgage.extraPayment"]');
            if (input) input.value = Store.state.mortgage.extraPayment;
            App.changed();
        }
    });

    App.defineView('futuro/hipoteca', { render, update });
})();
