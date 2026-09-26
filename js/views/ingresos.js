/* Presupuesto → Ingresos e Impuestos: payroll (IESS + SRI), décimos and deductions. */
(function () {
    'use strict';
    const { money, pct } = Fmt;

    function update(ctx) {
        const yd = ctx.year, p = ctx.pay;
        UI.text('inc-sbu', money(yd.sbu));
        const rows = [
            ['Sueldo bruto mensual', money(p.sueldo), 'text-slate-900'],
            [`Aporte personal IESS (${pct(yd.iessRate, 2)})`, '−' + money(p.iessM), 'text-red-600'],
            ['Deducción de gastos personales (anual, aplicada)', money(p.dedApplied), 'text-blue-700'],
            ['Base imponible anual', money(p.baseImponible), 'text-slate-900'],
            ['Impuesto a la renta anual', money(p.isrAnual), 'text-amber-700'],
            ['Retención mensual en el rol', '−' + money(p.isrM), 'text-red-600']
        ];
        UI.html('inc-payroll', rows.map(([k, v, c]) => `<div class="flex justify-between py-2"><dt class="text-slate-600">${k}</dt><dd class="font-bold ${c}">${v}</dd></div>`).join(''));
        UI.text('inc-neto', money(p.netoM));

        UI.text('inc-cap', money(p.sriCap));
        UI.text('inc-ded-prep', money(p.deductibles.prep));
        UI.text('inc-ded-real', money(p.deductibles.real));
        const ratio = p.sriCap > 0 ? p.deductibles.real / p.sriCap : 1;
        const box = document.getElementById('inc-ded-status');
        let tone, icon, title, text;
        if (p.deductibles.real >= p.sriCap) {
            tone = 'tone-emerald'; icon = 'fa-circle-check text-emerald-600'; title = 'Deducción optimizada';
            text = `Tus gastos deducibles alcanzan el tope legal de ${money(p.sriCap)}.`;
        } else if (ratio >= 0.8) {
            tone = 'tone-amber'; icon = 'fa-triangle-exclamation text-amber-600'; title = 'Cerca del tope';
            text = `Te faltan ${money(p.sriCap - p.deductibles.real)} en gastos deducibles reales para llegar al tope.`;
        } else {
            tone = 'tone-red'; icon = 'fa-circle-info text-red-600'; title = 'Muy por debajo del tope';
            text = `Usas el ${Math.round(ratio * 100)}% del tope. Podrías declarar ${money(p.sriCap - p.deductibles.real)} más en gastos deducibles y pagar menos impuesto. Marca los rubros deducibles en el Presupuesto del Mes.`;
        }
        box.className = `panel ${tone}`;
        box.innerHTML = `<div class="text-xs font-bold text-slate-900"><i class="fa-solid ${icon}"></i> ${title}</div><p class="text-[11px] text-slate-700 mt-1">${text}</p>`;
    }

    App.defineView('presupuesto/ingresos', { update });
})();
