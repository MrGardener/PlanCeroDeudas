/* Jubilación: DPF future value + estimated IESS pension, with a "what if" contribution slider. */
(function () {
    'use strict';
    const { money, money0 } = Fmt;

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
        note.innerHTML = isOverride ? `✎ Personalizado para este escenario. ${describe}` : `🔗 Enlazado: ${describe}`;
    }

    function update(ctx) {
        const r = ctx.retirement, inp = ctx.retirementInputs, s = ctx.state, yd = ctx.year;
        UI.text('ret-ahorro', money(inp.ahorroActual));
        UI.text('ret-aporte', money(inp.aporteMensual));
        UI.text('ret-aporte-sweep', ctx.baseBudget.sweep > 0 ? `, incluido el barrido de ${money0(ctx.baseBudget.sweep)}` : '');
        linkedField('ret-tasa', 'ret-tasa-note', 'tasaRetorno', ctx.defaultReturn, s.retirement.tasaRetorno, yd.country === 'US'
            ? `${ctx.defaultReturn}% es el promedio histórico de la bolsa de EE. UU. (acciones, antes de inflación). Algunos años pierde; a 20-30 años suele acercarse a ese promedio.`
            : `la Tasa DPF de <a href="#" class="link" data-goto="futuro/proyeccion">${s.activeYear}</a> es ${Number(yd.tasa).toFixed(2)}%. Tu retorno en 20-30 años puede ser distinto a la tasa de hoy.`);
        linkedField('ret-infl', 'ret-infl-note', 'inflacion', Engine.DEFAULT_INFLATION[yd.country === 'US' ? 'US' : 'EC'], s.retirement.inflacion, yd.country === 'US'
            ? 'promedio histórico de EE. UU. (~3% al año). Todo se muestra en dólares de hoy.'
            : 'promedio de Ecuador desde la dolarización (~2.5% al año). Todo se muestra en dólares de hoy.');
        linkedField('ret-sueldo', 'ret-sueldo-note', 'sueldoPromedio', yd.sueldo, s.retirement.sueldoPromedio,
            `tu sueldo de <a href="#" class="link" data-goto="presupuesto/ingresos">${s.activeYear}</a> es ${money0(yd.sueldo)}. El IESS usa tu sueldo cerca de la jubilación, que suele ser mayor.`);

        UI.text('ret-years', r.aniosRestantes);
        UI.text('ret-fv', money0(r.valorFuturoHoy));
        UI.text('ret-fv-note', `en dólares de hoy · ${money0(r.valorFuturo)} en dólares de ${ctx.today.getFullYear() + r.aniosRestantes}`);
        UI.text('ret-income-savings', money0(r.ingresoAhorro));
        UI.text('ret-pension', money0(r.pension));
        UI.text('ret-pension-note', r.pensionDesde === null ? 'Aún no cumples los años mínimos de aportes' : `desde los ${r.pensionDesde} años`);
        const bridge = document.getElementById('ret-bridge');
        if (r.pensionDesde === null) bridge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Con tus años de aportes no alcanzas la pensión del IESS (mínimo 10 años a los 70, 15 a los 65, 30 a los 60 o 40 a cualquier edad). Tu jubilación dependería solo de tu ahorro.`;
        else if (r.aniosPuente > 0) bridge.innerHTML = `<i class="fa-solid fa-triangle-exclamation"></i> Entre los ${r.edadJubilacion} y los ${r.pensionDesde} años no recibirás ${yd.country === 'US' ? 'el Seguro Social' : 'la pensión'}: vivirías solo de tu ahorro (${money0(r.ingresoAhorro)}/mes).`;
        UI.show(bridge, r.pensionDesde === null || r.aniosPuente > 0);
        UI.text('ret-total', money(r.ingresoTotal));

        const extra = Number(s.retirement.whatIfExtra) || 0;
        UI.text('ret-whatif-label', `+${money0(extra)}/mes`);
        const delta = document.getElementById('ret-total-delta');
        if (r.whatIf) {
            UI.text('ret-whatif-text', `Aportando ${money0(extra)} más al mes tendrías ${money0(r.whatIf.gain)} adicionales al jubilarte (${money0(r.whatIf.valorFuturo)} en vez de ${money0(r.valorFuturo)}), y tu ingreso mensual total subiría a ${money(r.whatIf.ingresoTotal)}.`);
            delta.textContent = `+${money(r.whatIf.deltaIngreso)}/mes con el simulador`;
        } else {
            UI.text('ret-whatif-text', 'Mueve el control para ver cuánto más tendrías con un aporte mayor.');
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
            { label: `Pesimista (${lowRate}%)`, data: low.schedule, borderColor: 'transparent', backgroundColor: 'transparent', pointRadius: 0, pointHoverRadius: 0, fill: false, tension: 0 },
            { label: `Optimista (${highRate}%)`, data: high.schedule, borderColor: 'transparent', backgroundColor: pal.alpha(pal.blue, 0.14), pointRadius: 0, pointHoverRadius: 0, fill: '-1', tension: 0 },
            { label: `Esperado (${rate}%)`, data: r.schedule, borderColor: pal.blue, backgroundColor: pal.blue, borderWidth: 2, fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 4 }
        ];
        if (r.whatIf) datasets.push({ label: `Con +${money0(extra)}/mes`, data: r.whatIf.schedule, borderColor: pal.orange, backgroundColor: pal.orange, borderDash: [6, 4], borderWidth: 2, fill: false, tension: 0, pointRadius: 0, pointHoverRadius: 4 });
        // Nothing saved or going in yet: keep a sensible axis instead of $0–$1 ticks.
        const empty = !high.schedule.some(v => v > 0.5) && !(r.whatIf && r.whatIf.schedule.some(v => v > 0.5));
        // Legend: the band reads as one entry ("Rango"), not two invisible lines.
        const bandLabel = `Rango ${lowRate}%–${highRate}%`;
        UI.chart('ret-chart', {
            type: 'line', data: { labels, datasets },
            options: {
                scales: { x: { title: { display: true, text: 'Edad', font: { size: 10 } } }, y: { suggestedMax: empty ? 1000 : undefined } },
                plugins: {
                    legend: { position: 'top', align: 'start', labels: { filter: (item) => item.datasetIndex !== 0, generateLabels: (chart) => Chart.defaults.plugins.legend.labels.generateLabels(chart).map(l => (l.datasetIndex === 1 ? Object.assign(l, { text: I18n.t(bandLabel), fillStyle: pal.alpha(pal.blue, 0.25), strokeStyle: 'transparent', lineWidth: 0 }) : l)) } },
                    tooltip: { itemSort: (a, b) => b.datasetIndex - a.datasetIndex }
                }
            }
        });
        const tile = (label, value, rateTxt, strong) => `<div class="kpi tone-slate text-center" style="padding:.6rem .35rem"><span class="kpi-label">${label}</span><span class="kpi-value" title="${money0(value)}" style="font-size:${strong ? '1.05rem' : '.95rem'}">${Math.abs(value) >= 1e6 ? `${money(value / 1e6)}M` : money0(value)}</span><span class="kpi-note">${rateTxt}</span></div>`;
        UI.html('ret-range', tile('Pesimista', low.valorFuturoHoy, `al ${lowRate}% anual`) + tile('Esperado', r.valorFuturoHoy, `al ${rate}% anual`, true) + tile('Optimista', high.valorFuturoHoy, `al ${highRate}% anual`));
        UI.text('ret-range-note', `A los ${r.edadJubilacion} años, en dólares de hoy. Nadie sabe el retorno de los próximos ${r.aniosRestantes} años: con 2 puntos menos o más al año, tu ahorro terminaría entre ${money0(low.valorFuturoHoy)} y ${money0(high.valorFuturoHoy)}.`);
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
        'ret.whatIf': (el) => {
            Store.state.retirement.whatIfExtra = Number(el.value) || 0;
            App.changed();
        }
    });

    App.defineView('futuro/jubilacion', { render, update });
})();
