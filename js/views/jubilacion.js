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

        const labels = r.schedule.map((_, i) => r.edadActual + i);
        const datasets = [{ label: 'Con tu aporte actual', data: r.schedule, borderColor: '#059669', backgroundColor: 'rgba(16,185,129,.1)', fill: true, tension: .3, pointRadius: 0 }];
        if (r.whatIf) datasets.push({ label: `Con +${money0(extra)}/mes`, data: r.whatIf.schedule, borderColor: '#9333ea', borderDash: [6, 4], fill: false, tension: .3, pointRadius: 0 });
        // Nothing saved or going in yet: keep a sensible axis instead of $0–$1 ticks.
        const empty = !r.schedule.some(v => v > 0.5) && !(r.whatIf && r.whatIf.schedule.some(v => v > 0.5));
        UI.chart('ret-chart', { type: 'line', data: { labels, datasets }, options: { scales: { x: { title: { display: true, text: 'Edad', font: { size: 10 } } }, y: { suggestedMax: empty ? 1000 : undefined } } } });
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
