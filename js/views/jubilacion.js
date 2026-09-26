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
        linkedField('ret-tasa', 'ret-tasa-note', 'tasaRetorno', yd.tasa, s.retirement.tasaRetorno,
            `la Tasa DPF de <a href="#" class="link" data-goto="ahorro/proyeccion">${s.activeYear}</a> es ${Number(yd.tasa).toFixed(2)}%. Tu retorno en 20-30 años puede ser distinto a la tasa de hoy.`);
        linkedField('ret-sueldo', 'ret-sueldo-note', 'sueldoPromedio', yd.sueldo, s.retirement.sueldoPromedio,
            `tu sueldo de <a href="#" class="link" data-goto="presupuesto/ingresos">${s.activeYear}</a> es ${money0(yd.sueldo)}. El IESS usa tu sueldo cerca de la jubilación, que suele ser mayor.`);

        UI.text('ret-years', r.aniosRestantes);
        UI.text('ret-fv', money0(r.valorFuturo));
        UI.text('ret-income-savings', money0(r.ingresoAhorro));
        UI.text('ret-pension', money0(r.pension));
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
        UI.chart('ret-chart', { type: 'line', data: { labels, datasets }, options: { scales: { x: { title: { display: true, text: 'Edad', font: { size: 10 } } } } } });
    }

    UI.register({
        'ret.override': (el) => {
            const v = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            Store.state.retirement[el.dataset.field] = v;
            App.changed();
        },
        'ret.relink': (el) => {
            Store.state.retirement[el.dataset.field] = null;
            const input = document.getElementById(el.dataset.field === 'tasaRetorno' ? 'ret-tasa' : 'ret-sueldo');
            input.blur();
            App.changed();
        },
        'ret.whatIf': (el) => {
            Store.state.retirement.whatIfExtra = Number(el.value) || 0;
            App.changed();
        }
    });

    App.defineView('jubilacion', { render, update });
})();
