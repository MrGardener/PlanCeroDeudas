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

        UI.text('mort-system', system === 'aleman' ? 'German (declining payment)' : 'French (fixed payment)');
        const slider = document.getElementById('mort-extra-slider');
        slider.value = Math.min(Number(m.extraPayment) || 0, Number(slider.max) || 0);

        const tiles = system === 'aleman'
            ? [['tone-blue', 'First payment', money(base.firstPayment)], ['tone-blue', 'Last payment', money(base.lastPayment)]]
            : [['tone-blue', 'Monthly payment', money(base.firstPayment)], ['tone-slate', 'Term', Fmt.monthsAsYears(months)]];
        tiles.push(['tone-red', 'Total interest', money0(base.totalInterest)], ['tone-slate', 'Total paid', money0(base.totalPaid)]);
        // US: what you really pay each month (PITI).
        if (ctx.budgetYear.country === 'US') {
            const p = Engine.pitiMonthly(Object.assign({ payment: base.firstPayment, schedule: (extra || base).schedule }, m));
            const pmiEnd = p.pmi && p.pmiMonths !== null ? ` (por ${Fmt.monthsAsYears(p.pmiMonths)}, ${money0(p.pmiTotal)} en total)` : '';
            tiles.unshift(['tone-amber', 'Total monthly payment (PITI)', `${money(p.total)}<span class="kpi-note block">Principal & interest ${money(p.pi)} · tax ${money(p.tax)} · insurance ${money(p.ins)}${p.pmi ? ` · PMI ${money(p.pmi)}${pmiEnd}` : ''}${p.hoa ? ` · HOA ${money(p.hoa)}` : ''}</span>`]);
        }
        let html = tiles.map(([tone, label, value]) => `<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span></div>`).join('');
        if (extra) {
            html += `<div class="kpi tone-emerald col-span-2"><span class="kpi-label"><i class="fa-solid fa-piggy-bank"></i> With ${money0(m.extraPayment)} extra a month</span><span class="kpi-value">You finish in ${Fmt.monthsAsYears(extra.months)}</span><span class="kpi-note">Instead of ${Fmt.monthsAsYears(months)} · ${Fmt.monthsAsYears(months - extra.months)} sooner</span></div>
                     <div class="kpi tone-emerald col-span-2"><span class="kpi-label">Interest you save</span><span class="kpi-value">${money0(base.totalInterest - extra.totalInterest)}</span><span class="kpi-note">You pay ${money0(extra.totalInterest)} in total interest</span></div>`;
        }
        UI.html('mort-summary', html);
        if (window.Prepay) Prepay.render(ctx);

        // Rate sensitivity: the same loan 1 point lower and higher (adjustable rates, refinancing).
        const sc = Engine.loanRateScenarios(system, m.amount, m.rate, months);
        const cur = sc[1];
        const delta = (x, y) => (Math.abs(x - y) < 0.5 ? '' : `${x > y ? '+' : '−'}${money0(Math.abs(x - y))}`);
        UI.html('mort-rates', Number(m.amount) > 0 && Number(m.rate) > 0 ? `<div class="section-label"><i class="fa-solid fa-percent text-slate-500"></i> What if the rate changes?</div>
            <div class="grid grid-cols-3 gap-2 sm:gap-3">${sc.map(x => `<div class="kpi ${x.delta === 0 ? 'tone-blue' : 'tone-slate'} text-center" style="padding:.6rem .4rem">
                <span class="kpi-label">${x.delta === 0 ? 'Your rate' : x.delta < 0 ? '1 point lower' : '1 point higher'} · ${x.rate}%</span>
                <span class="kpi-value" style="font-size:1rem">${money(x.payment)}<span class="text-[11px] font-semibold">${system === 'aleman' ? ' 1.ª' : '/mes'}</span></span>
                <span class="kpi-note">${x.delta === 0 ? `${money0(x.totalInterest)} in interest` : `${delta(x.payment, cur.payment)}/mo · ${delta(x.totalInterest, cur.totalInterest)} in interest`}</span></div>`).join('')}</div>
            <p class="help mt-2">${ctx.budgetYear.country === 'US' ? 'With an adjustable rate (ARM), this is how your payment would change when it resets. With a fixed rate, it tells you what refinancing at a lower rate would save (minus closing costs).' : 'Many mortgages (BIESS, banks) have an adjustable rate: this is how your payment would change if the rate went up or down 1 point.'}</p>` : '');

        const axis = Engine.chartAxis(base.schedule.length);
        const pal = UI.palette();
        // A single line needs no legend: the panel title names it.
        const opts = { scales: { x: { title: { display: true, text: axis.title, font: { size: 10 } } } }, plugins: { legend: { display: !!extra } } };
        const dataset = (label, schedule, field, cumulative, dashed) => ({
            label, data: Engine.sampleSchedule(schedule, axis, field, cumulative),
            borderColor: dashed ? pal.orange : pal.blue, borderDash: dashed ? [6, 4] : [], backgroundColor: dashed ? 'transparent' : pal.alpha(pal.blue, 0.1),
            borderWidth: 2, fill: !dashed, tension: 0, pointRadius: 0, spanGaps: false
        });
        UI.chart('mort-balance-chart', { type: 'line', options: opts, data: { labels: axis.labels, datasets: [dataset('Remaining balance', base.schedule, 'balance', false, false)].concat(extra ? [dataset('Balance with extra payment', extra.schedule, 'balance', false, true)] : []) } });

        // Principal vs. interest paid each loan year (Engine.amortizationByYear): the early years
        // are mostly interest. With an extra payment, a switch shows either scenario.
        const useExtra = !!extra && Store.ui.mortSplit !== 'base';
        UI.show('mort-split-toggle', !!extra);
        UI.$$('#mort-split-toggle [data-plan]').forEach(b => b.classList.toggle('active', (b.dataset.plan === 'extra') === useExtra));
        const years = Engine.amortizationByYear((useExtra ? extra : base).schedule);
        const yearLabel = (y) => (y.months < 12 ? `Year ${y.year} (${y.months}m)` : `Year ${y.year}`);
        const topRound = { topLeft: 4, topRight: 4, bottomLeft: 0, bottomRight: 0 };
        UI.chart('mort-split-chart', {
            type: 'bar',
            data: {
                labels: years.map(yearLabel),
                datasets: [
                    { label: 'Principal', data: years.map(y => Math.round(y.principal)), backgroundColor: pal.blue, stack: 'p', maxBarThickness: 24, borderSkipped: false, borderRadius: 0 },
                    { label: 'Interest', data: years.map(y => Math.round(y.interest)), backgroundColor: pal.orange, stack: 'p', maxBarThickness: 24, borderColor: pal.surface, borderWidth: { bottom: 2, top: 0, left: 0, right: 0 }, borderSkipped: false, borderRadius: topRound }
                ]
            },
            options: {
                scales: { x: { stacked: true, ticks: { maxTicksLimit: 8, maxRotation: 0, autoSkip: true } }, y: { stacked: true } },
                plugins: { legend: { position: 'top', align: 'start' } }
            }
        });
        const firstY = years[0], lastY = years[years.length - 1];
        const half = years.findIndex(y => y.principal >= y.interest);
        UI.html('mort-split-note', firstY ? `<span>In year 1 you pay ${money0(firstY.interest)} in interest and ${money0(firstY.principal)} in principal${half > 0 ? `; from year ${half + 1} on, most of it goes to principal` : ''}.</span> <span>${useExtra ? `With the extra payment it ends in year ${lastY.year}.` : `It ends in year ${lastY.year}.`}</span>` : '');
        UI.html('mort-split-table', years.map(y => `<tr><td>${yearLabel(y)}</td><td class="num">${money0(y.principal)}</td><td class="num">${money0(y.interest)}</td><td class="num">${money0(y.balance)}</td></tr>`).join(''));

        const rows = (extra || base).schedule;
        UI.text('mort-table-note', extra ? `with ${money0(m.extraPayment)} extra a month` : '');
        UI.html('mort-body', rows.map(r => `<tr><td class="text-center">${r.period}</td><td class="num font-bold">${money(r.payment)}</td><td class="num text-red-600">${money(r.interest)}</td><td class="num text-emerald-700">${money(r.principal)}</td><td class="num font-semibold">${money(r.balance)}</td></tr>`).join(''));
    }

    UI.register({
        'mortgage.split': (el) => { Store.ui.mortSplit = el.dataset.plan; App.update(); },
        'mortgage.slider': (el) => {
            Store.state.mortgage.extraPayment = Number(el.value) || 0;
            const input = document.querySelector('[data-bind="mortgage.extraPayment"]');
            if (input) input.value = Store.state.mortgage.extraPayment;
            App.changed();
        }
    });

    App.defineView('futuro/hipoteca', { render, update });
})();
