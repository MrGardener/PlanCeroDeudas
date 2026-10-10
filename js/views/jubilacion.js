/* Jubilación: DPF future value + estimated IESS pension, with a "what if" contribution slider. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    // Whose: retirement accounts by owner, the other paychecks' 401(k), Social Security per earner.
    function byPerson(ctx) {
        const s = ctx.state, r = ctx.retirement, people = s.members || [];
        const nameOf = (id) => (people.find(m => m.id === id) || {}).name;
        const ret = (s.accounts || []).filter(Engine.isRetirementMoney);
        const owners = {};
        ret.forEach(a => { const k = a.memberId && nameOf(a.memberId) ? nameOf(a.memberId) : ''; owners[k] = (owners[k] || 0) + (Number(a.balance) || 0); });
        const who = (k) => (k ? `<span data-i18n-skip>${esc(k)}</span>` : '<span>Household</span>');
        UI.html('ret-ahorro-who', ret.some(a => a.memberId) ? `<span>Retirement accounts:</span> ${Object.keys(owners).map(k => `${who(k)} ${money0(owners[k])}`).join(' · ')}` : '');
        const er = (ctx.earnersRetirement || []).filter(e => e.own + e.match > 0);
        UI.html('ret-aporte-who', er.length ? `<span>Includes the other paychecks:</span> ${er.map(e => `${who(nameOf(e.memberId) || e.name)} <span>401(k)</span> ${money0(e.own)}${e.match > 0 ? ` + ${money0(e.match)} <span>match</span>` : ''}`).join(' · ')}` : '');
        return (r.pensions || []).length > 1 ? r.pensions.map(x => `${who(x.name)} ${money0(x.amount)}`).join(' · ') : '';
    }

    function render(ctx) {
        const slider = document.getElementById('ret-whatif');
        slider.max = ctx.state.settings.retireWhatIfMax;
        slider.value = Math.min(Number(ctx.state.retirement.whatIfExtra) || 0, Number(slider.max));
        update(ctx);
    }

    // Linked fields show the live app value until the user types an override; ↻ re-links.
    function linkedField(inputId, noteId, field, linkedValue, overrideValue, describe) {
        const input = document.getElementById(inputId);
        const isOverride = overrideValue !== null && overrideValue !== undefined;
        if (input !== document.activeElement) input.value = isOverride ? overrideValue : linkedValue;
        const relink = document.querySelector(`[data-action="ret.relink"][data-field="${field}"]`);
        if (relink) relink.classList.toggle('invisible', !isOverride);
        const note = document.getElementById(noteId);
        note.className = isOverride ? 'help text-purple-700' : 'linked';
        note.innerHTML = isOverride ? `✎ Customized for this scenario. ${describe}` : `🔗 Linked: ${describe}`;
    }

    // Need vs. have: the income you want (default 80% of what you live on today), minus the
    // pension, through the 4% rule — against what your savings are on track to become.
    function gap(ctx) {
        const r = ctx.retirement, inp = ctx.retirementInputs, s = ctx.state;
        const { g, desired, def } = Views.retireGap(ctx);
        const input = document.getElementById('ret-desired');
        if (input && input !== document.activeElement) { input.value = s.retirement.ingresoDeseado === null || s.retirement.ingresoDeseado === undefined ? '' : desired; input.placeholder = money0(def); }
        UI.text('ret-desired-help', s.retirement.ingresoDeseado === null || s.retirement.ingresoDeseado === undefined ? `Empty = 80% of your income today (${money0(def)}).` : '');
        const pct = Math.round(g.pct * 100);
        const tone = g.pct >= 1 ? 'tone-emerald' : g.pct >= 0.7 ? 'tone-amber' : 'tone-red';
        const pensionName = s.settings.country === 'US' ? 'Seguro Social' : 'IESS pension';
        UI.html('ret-gap', `<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div class="kpi tone-slate"><span class="kpi-label">You'd need</span><span class="kpi-value">${money0(g.need)}</span><span class="kpi-note">${money0(Math.max(0, desired - r.pension))}/mo from savings (your ${pensionName} covers ${money0(r.pension)})</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">You're on track to have</span><span class="kpi-value">${money0(g.have)}</span><span class="kpi-note">at age ${r.edadJubilacion}</span></div>
                <div class="kpi ${tone}"><span class="kpi-label">You're at</span><span class="kpi-value">${pct > 999 ? '999+' : pct}%</span><span class="kpi-note">${g.gap > 0 ? `${money0(g.gap)} short` : 'you\'ll have enough!'}</span></div>
            </div>
            <div class="progress-track mt-3"><div class="progress-fill" style="width:${Math.min(100, pct)}%"></div></div>
            <p class="text-xs mt-3">${g.gap > 0 ? (g.extraMonthly === null ? 'You\'ve reached your retirement age: the gap would have to come from working longer or spending less.' : `Saving <strong>${money0(g.extraMonthly)} more a month</strong> (in today's dollars) closes it. <button type="button" class="link" data-action="ret.tryGap" data-extra="${Math.ceil(g.extraMonthly / 10) * 10}">Try it in the simulator</button>`) : 'With what you save today you\'d live the way you want. Check it every year.'}${g.bridge > 0 ? ` <span class="text-slate-500">Includes ${money0(g.bridge)} for the ${r.aniosPuente} years before your ${pensionName} starts.</span>` : ''}</p>
            <p class="help mt-1">The ${inp.tasaRetiroSegura}% rule: for every $1 a month you want to draw from savings you need ${money0(1200 / Math.max(0.1, inp.tasaRetiroSegura))} saved.</p>`);
    }

    function update(ctx) {
        const r = ctx.retirement, inp = ctx.retirementInputs, s = ctx.state, yd = ctx.year;
        gap(ctx);
        if (window.RetireTools) RetireTools.render(ctx);
        UI.text('ret-ahorro', money(inp.ahorroActual));
        UI.text('ret-aporte', money(inp.aporteMensual));
        UI.text('ret-aporte-sweep', ctx.baseBudget.sweep > 0 ? `, including the ${money0(ctx.baseBudget.sweep)} sweep` : '');
        linkedField('ret-tasa', 'ret-tasa-note', 'tasaRetorno', ctx.defaultReturn, s.retirement.tasaRetorno, yd.country === 'US'
            ? `${ctx.defaultReturn}% is the US stock market's historical average (stocks, before inflation). Some years it loses; over 20-30 years it tends to come close to that average.`
            : `the savings rate of <a href="#" class="link" data-goto="futuro/proyeccion">${s.activeYear}</a> is ${Number(yd.tasa).toFixed(2)}%. Your return over 20-30 years may differ from today's rate.`);
        linkedField('ret-infl', 'ret-infl-note', 'inflacion', Engine.DEFAULT_INFLATION[yd.country === 'US' ? 'US' : 'EC'], s.retirement.inflacion, yd.country === 'US'
            ? 'US historical average (~3% a year). Everything is shown in today\'s dollars.'
            : 'Ecuador\'s average since dollarization (~2.5% a year). Everything is shown in today\'s dollars.');
        linkedField('ret-sueldo', 'ret-sueldo-note', 'sueldoPromedio', yd.sueldo, s.retirement.sueldoPromedio,
            `your salary from <a href="#" class="link" data-goto="presupuesto/ingresos">${s.activeYear}</a> is ${money0(yd.sueldo)}. The pension uses your salary near retirement, which is usually higher.`);

        UI.text('ret-years', r.aniosRestantes);
        UI.text('ret-fv', money0(r.valorFuturoHoy));
        UI.text('ret-fv-note', `in today's dollars · ${money0(r.valorFuturo)} in ${ctx.today.getFullYear() + r.aniosRestantes} dollars`);
        UI.text('ret-income-savings', money0(r.ingresoAhorro));
        UI.text('ret-pension', money0(r.pension));
        const each = byPerson(ctx);
        UI.html('ret-pension-note', r.pensionDesde === null ? 'You don\'t have the minimum years of contributions yet' : `<span>from age ${r.pensionDesde}</span>${each ? ` · ${each}` : ''}`);
        const bridge = document.getElementById('ret-bridge');
        if (r.pensionDesde === null) bridge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> With your years of contributions you don't qualify for the IESS pension (at least 10 years at 70, 15 at 65, 30 at 60 or 40 at any age). Your retirement would depend on your savings alone.`;
        else if (r.aniosPuente > 0) bridge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Between ages ${r.edadJubilacion} and ${r.pensionDesde} you won't receive ${yd.country === 'US' ? 'Social Security' : 'the pension'}: you'd live on your savings alone (${money0(r.ingresoAhorro)}/month).`;
        UI.show(bridge, r.pensionDesde === null || r.aniosPuente > 0);
        UI.text('ret-total', money(r.ingresoTotal));

        const extra = Number(s.retirement.whatIfExtra) || 0;
        UI.text('ret-whatif-label', `+${money0(extra)}/mo`);
        const delta = document.getElementById('ret-total-delta');
        if (r.whatIf) {
            UI.text('ret-whatif-text', `Contributing ${money0(extra)} more a month you'd have ${money0(r.whatIf.gain)} more at retirement (${money0(r.whatIf.valorFuturo)} instead of ${money0(r.valorFuturo)}), and your total monthly income would rise to ${money(r.whatIf.ingresoTotal)}.`);
            delta.textContent = `+${money(r.whatIf.deltaIngreso)}/mo with the simulator`;
        } else {
            UI.text('ret-whatif-text', 'Move the slider to see how much more you\'d have with a bigger contribution.');
        }
        UI.show(delta, !!r.whatIf);

        // The expected line with a range: the same plan at the return −2 and +2 points
        // (Engine.retirement with tasaRetorno ± 2), shaded between; the what-if dashed on top.
        const pal = UI.palette();
        const rate = Number(inp.tasaRetorno) || 0;
        const lowRate = Math.max(0, rate - 2), highRate = rate + 2;
        const low = Engine.retirement({ ...inp, tasaRetorno: lowRate, whatIfExtra: 0 });
        const high = Engine.retirement({ ...inp, tasaRetorno: highRate, whatIfExtra: 0 });
        const labels = r.schedule.map((_, i) => r.edadActual + i);
        const datasets = [
            { label: `Pessimistic (${lowRate}%)`, data: low.schedule, borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0 },
            { label: `Optimistic (${highRate}%)`, data: high.schedule, borderColor: 'transparent', backgroundColor: pal.alpha(pal.blue, 0.14), pointRadius: 0, pointHoverRadius: 0, fill: '-1', tension: 0 },
            { label: `Expected (${rate}%)`, data: r.schedule, borderColor: pal.blue, backgroundColor: pal.blue, borderWidth: 2, fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 4 }
        ];
        if (r.whatIf) datasets.push({ label: `With +${money0(extra)}/mo`, data: r.whatIf.schedule, borderColor: pal.orange, backgroundColor: pal.orange, borderDash: [6, 4], borderWidth: 2, fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 4 });
        // Nothing saved or going in yet: keep a sensible axis instead of $0–$1 ticks.
        const empty = !high.schedule.some(v => v > 0.5) && !(r.whatIf && r.whatIf.schedule.some(v => v > 0.5));
        // Legend: the band reads as one entry ("Rango"), not two invisible lines.
        const bandLabel = `Range ${lowRate}%–${highRate}%`;
        UI.chart('ret-chart', {
            type: 'line', data: { labels, datasets },
            options: {
                scales: { x: { title: { display: true, text: 'Age', font: { size: 10 } } }, y: { suggestedMax: empty ? 1000 : undefined } },
                plugins: {
                    legend: { position: 'top', align: 'start', labels: { filter: (item) => item.datasetIndex !== 0, generateLabels: (chart) => Chart.defaults.plugins.legend.labels.generateLabels(chart).map(l => (l.datasetIndex === 1 ? Object.assign(l, { text: I18n.t(bandLabel), fillStyle: pal.alpha(pal.blue, 0.25), strokeStyle: 'transparent', lineWidth: 0 }) : l)) } },
                    tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex }
                }
            }
        });
        const tile = (label, value, rateTxt, strong) => `<div class="kpi tone-slate text-center" style="padding:.6rem .35rem"><span class="kpi-label">${label}</span><span class="kpi-value" title="${money0(value)}" style="font-size:${strong ? '1.05rem' : '.95rem'}">${Math.abs(value) >= 1e6 ? `${money(value / 1e6)}M` : money0(value)}</span><span class="kpi-note">${rateTxt}</span></div>`;
        UI.html('ret-range', tile('Pessimistic', low.valorFuturoHoy, `at ${lowRate}% a year`) + tile('Expected', r.valorFuturoHoy, `at ${rate}% a year`, true) + tile('Optimistic', high.valorFuturoHoy, `at ${highRate}% a year`));
        UI.text('ret-range-note', `At age ${r.edadJubilacion}, in today's dollars. Nobody knows the return of the next ${r.aniosRestantes} years: with 2 points less or more a year, your savings would end between ${money0(low.valorFuturoHoy)} and ${money0(high.valorFuturoHoy)}.`);
        UI.html('ret-range-table', labels.map((age, i) => ({ age, i })).filter(({ i }) => i % 5 === 0 || i === labels.length - 1).map(({ age, i }) => `<tr><td>${age}</td><td class="num">${money0(low.schedule[i])}</td><td class="num font-bold">${money0(r.schedule[i])}</td><td class="num">${money0(high.schedule[i])}</td></tr>`).join(''));
    }

    UI.register({
        'ret.override': (el) => {
            const v = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            Store.state.retirement[el.dataset.field] = v;
            App.changed();
        },
        'ret.relink': (el) => {
            Store.state.retirement[el.dataset.field] = null;
            const input = document.getElementById({ tasaRetorno: 'ret-tasa', inflacion: 'ret-infl' }[el.dataset.field] || 'ret-sueldo');
            input.blur();
            App.changed();
        },
        'ret.desired': (el) => {
            Store.state.retirement.ingresoDeseado = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        },
        // Put the gap's monthly amount in the what-if slider and show it.
        'ret.tryGap': (el) => {
            Store.state.retirement.whatIfExtra = Number(el.dataset.extra) || 0;
            App.changed();
            const w = document.getElementById('ret-whatif');
            if (w) { if (Number(w.max) < Number(el.dataset.extra)) w.max = el.dataset.extra; w.value = el.dataset.extra; w.scrollIntoView({ block: 'center', behavior: 'smooth' }); }
        },
        'ret.whatIf': (el) => {
            Store.state.retirement.whatIfExtra = Number(el.value) || 0;
            App.changed();
        }
    });

    App.defineView('futuro/jubilacion', { render, update });
})();
