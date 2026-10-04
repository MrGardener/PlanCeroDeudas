/* Futuro → Hipoteca → ¿Abonar a la hipoteca o invertir?: the same extra money each month, put
 * toward the house (then the whole payment invested once it's paid) or invested from today, and
 * what each leaves at the end of the loan's normal term (Engine.prepayOrInvest). The inputs live
 * on screen only (Store.ui.prepay); they start from your extra payment and your expected return. */
(function () {
    'use strict';
    const { money0, esc } = Fmt;

    // The tax saved per dollar of mortgage interest: your federal bracket, only when you itemize.
    function deductDefault(ctx) {
        const yd = ctx.year, t = yd.usTax;
        if (ctx.budgetYear.country !== 'US' || !t || !(Number(yd.itemized) > (ctx.pay.stdDeduction || 0))) return 0;
        const status = ['single', 'mfj', 'hoh'].includes(yd.filingStatus) ? yd.filingStatus : 'single';
        const taxable = Number(ctx.pay.baseImponible) || 0;
        const br = ((t.brackets || {})[status] || []).filter(([from]) => taxable > from).pop();
        return br ? Math.round(br[1] * 100) : 0;
    }

    function st(ctx) {
        if (!Store.ui.prepay) {
            const us = ctx.budgetYear.country === 'US';
            Store.ui.prepay = { extra: Number(ctx.state.mortgage.extraPayment) || 200, returnPct: Number(ctx.defaultReturn) || (us ? 10 : 7), gainsTax: us ? 15 : 0, deduct: deductDefault(ctx) };
        }
        return Store.ui.prepay;
    }

    function render(ctx) {
        if (!document.getElementById('mort-prepay')) return;
        const c = st(ctx), us = ctx.budgetYear.country === 'US';
        const field = (key, label, help, step) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" min="0" step="${step}" data-input="prepay.set" data-key="${key}" value="${esc(String(c[key]))}">${help ? `<span class="help">${help}</span>` : ''}</label>`;
        const box = document.getElementById('mort-prepay-in');
        if (box && !box.contains(document.activeElement)) box.innerHTML = `<div class="grid grid-cols-2 ${us ? 'lg:grid-cols-4' : 'lg:grid-cols-3'} gap-3">
            ${field('extra', 'Dinero extra al mes ($)', '', 10)}
            ${field('returnPct', 'Rendimiento esperado al invertir (%)', us ? 'Promedio histórico de la bolsa: ~10%, con años malos.' : 'Por ejemplo, la tasa de tus pólizas.', 0.5)}
            ${field('gainsTax', 'Impuesto sobre la ganancia (%)', us ? 'En una cuenta normal, 15% para la mayoría. 0 en un Roth IRA.' : '', 1)}
            ${us ? field('deduct', 'Ahorro de impuesto por interés (%)', 'Tu tramo federal si detallas deducciones; 0 si tomas la estándar.', 1) : ''}
        </div>`;
        update(ctx);
    }

    function update(ctx) {
        const out = document.getElementById('mort-prepay-out');
        if (!out) return;
        const c = st(ctx), m = ctx.state.mortgage, yd = ctx.year;
        const months = Math.max(1, Math.round(Number(m.years) || 1)) * 12;
        const payment = Engine.loanPayment(m.amount, m.rate, months).payment;
        const now = Number((yd.netWorth || {}).mortgage) || 0;
        const balance = now > 0 && now < Number(m.amount) ? now : Number(m.amount) || 0;
        const r = Engine.prepayOrInvest({ balance, ratePct: m.rate, payment, extra: c.extra, returnPct: c.returnPct, gainsTaxPct: c.gainsTax, deductPct: c.deduct });
        if (!r.wealthPrepay && r.wealthPrepay !== 0) { out.innerHTML = '<p class="help mt-3">Completa el monto, la tasa y el plazo de tu hipoteca arriba.</p>'; return; }
        if (!(Number(c.extra) > 0)) { out.innerHTML = '<p class="help mt-3">Escribe cuánto dinero extra tendrías cada mes.</p>'; return; }
        const end = Fmt.monthYear(Engine.addMonths(ctx.today, r.horizon));
        const kpi = (tone, label, value, note) => `<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-note">${note}</span></div>`;
        const win = r.winner;
        const verdict = win === 'invest'
            ? (ctx.budgetYear.country === 'US'
                ? `<p><strong>Por números, invertir dejaría ${money0(r.diff)} más</strong> si el dinero rinde ${c.returnPct}% cada año. Pero ese rendimiento no está garantizado: hay años en que la bolsa cae. Abonar a la casa es una ganancia segura del ${m.rate}%.</p>`
                : `<p><strong>Por números, invertir dejaría ${money0(r.diff)} más</strong> si el dinero rinde ${c.returnPct}% cada año durante todo el plazo. Las tasas de las pólizas cambian al renovarlas; abonar a la casa es una ganancia segura del ${m.rate}%.</p>`)
            : win === 'prepay' ? `<p><strong>Abonar a la casa deja ${money0(-r.diff)} más</strong>, y sin riesgo: con un rendimiento de ${c.returnPct}%, invertir no le gana al ${m.rate}% de la hipoteca.</p>`
            : '<p><strong>Quedan casi iguales.</strong></p>';
        const be = r.breakEven === null ? '' : `<p class="mt-1">Invertir gana solo si rinde más de <strong>${r.breakEven.toFixed(1)}%</strong> al año en promedio durante ${Fmt.monthsAsYears(r.horizon)}.</p>`;
        out.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                ${kpi(win === 'prepay' ? 'tone-emerald' : 'tone-slate', `Abonando ${money0(c.extra)} al mes`, money0(r.wealthPrepay), `Casa pagada ${Fmt.monthsAsYears(r.monthsSooner)} antes, ${money0(r.interestSaved)} menos de interés; luego inviertes la cuota`)}
                ${kpi(win === 'invest' ? 'tone-emerald' : 'tone-slate', `Invirtiendo ${money0(c.extra)} al mes`, money0(r.wealthInvest), `Invertido en ${end}, cuando la hipoteca termina igual`)}
            </div>
            <div class="panel ${win === 'invest' ? 'tone-blue' : 'tone-emerald'} text-xs mt-3">${verdict}${be}</div>
            <p class="help mt-2"><span>${now > 0 && now < Number(m.amount) ? `Desde tu saldo de hoy (${money0(balance)}).` : 'Desde el monto del préstamo.'}</span>${ctx.state.settings.mortgageSystem === 'aleman' ? ' <span>Se calcula con una cuota fija (sistema francés).</span>' : ''} <span>En los Baby Steps, pagar la casa antes es el paso 6: primero el fondo de emergencia completo, el 15% a la jubilación y la universidad de los hijos. Y una casa pagada da tranquilidad: sin cuota, un mes difícil se lleva mejor.</span></p>`;
    }

    UI.register({
        'prepay.set': (el) => {
            const c = st(App.buildContext());
            c[el.dataset.key] = Math.max(0, Fmt.parseNum(el.value, 0));
            update(App.buildContext());
        }
    });

    window.Prepay = { render, update };
})();
