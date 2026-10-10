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
        const taxable = Number(ctx.pay.baseImponible) || 0;
        const br = (Engine.forStatus(t.brackets, Engine.usStatus(yd.filingStatus), 'brackets') || []).filter(([from]) => taxable > from).pop();
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
            ${field('extra', 'Extra money per month ($)', '', 10)}
            ${field('returnPct', 'Expected return when investing (%)', us ? 'Stock market historical average: ~10%, with bad years.' : 'For example, your CDs\' rate.', 0.5)}
            ${field('gainsTax', 'Tax on the gain (%)', us ? 'In a regular account, 15% for most people. 0 in a Roth IRA.' : '', 1)}
            ${us ? field('deduct', 'Tax saved on interest (%)', 'Your federal bracket if you itemize; 0 if you take the standard deduction.', 1) : ''}
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
        if (!r.wealthPrepay && r.wealthPrepay !== 0) { out.innerHTML = '<p class="help mt-3">Fill in your mortgage\'s amount, rate and term above.</p>'; return; }
        if (!(Number(c.extra) > 0)) { out.innerHTML = '<p class="help mt-3">Type how much extra money you\'d have each month.</p>'; return; }
        const end = Fmt.monthYear(Engine.addMonths(ctx.today, r.horizon));
        const kpi = (tone, label, value, note) => `<div class="kpi ${tone}"><span class="kpi-label">${label}</span><span class="kpi-value">${value}</span><span class="kpi-note">${note}</span></div>`;
        const win = r.winner;
        const verdict = win === 'invest'
            ? (ctx.budgetYear.country === 'US'
                ? `<p><strong>By the numbers, investing would leave ${money0(r.diff)} more</strong> if the money earns ${c.returnPct}% every year. But that return isn't guaranteed: some years the market falls. Paying down the house is a sure ${m.rate}% return.</p>`
                : `<p><strong>By the numbers, investing would leave ${money0(r.diff)} more</strong> if the money earns ${c.returnPct}% every year for the whole term. CD rates change when you renew them; paying down the house is a sure ${m.rate}% return.</p>`)
            : win === 'prepay' ? `<p><strong>Paying down the house leaves ${money0(-r.diff)} more</strong>, with no risk: at a ${c.returnPct}% return, investing doesn't beat the mortgage's ${m.rate}%.</p>`
            : '<p><strong>They come out about the same.</strong></p>';
        const be = r.breakEven === null ? '' : `<p class="mt-1">Investing only wins if it earns more than <strong>${r.breakEven.toFixed(1)}%</strong> a year on average for ${Fmt.monthsAsYears(r.horizon)}.</p>`;
        out.innerHTML = `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
                ${kpi(win === 'prepay' ? 'tone-emerald' : 'tone-slate', `Paying ${money0(c.extra)} extra a month`, money0(r.wealthPrepay), `House paid off ${Fmt.monthsAsYears(r.monthsSooner)} sooner, ${money0(r.interestSaved)} less interest; then you invest the payment`)}
                ${kpi(win === 'invest' ? 'tone-emerald' : 'tone-slate', `Investing ${money0(c.extra)} a month`, money0(r.wealthInvest), `Invested by ${end}, when the mortgage ends anyway`)}
            </div>
            <div class="panel ${win === 'invest' ? 'tone-blue' : 'tone-emerald'} text-xs mt-3">${verdict}${be}</div>
            <p class="help mt-2"><span>${now > 0 && now < Number(m.amount) ? `From your balance today (${money0(balance)}).` : 'From the loan amount.'}</span>${ctx.state.settings.mortgageSystem === 'aleman' ? ' <span>Calculated with a fixed payment (French system).</span>' : ''} <span>In the Baby Steps, paying off the house early is step 6: first the full emergency fund, 15% to retirement and the kids' college. And a paid-off house brings peace: with no payment, a hard month is easier to get through.</span></p>`;
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
