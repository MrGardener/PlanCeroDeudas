/* Ingresos (US) → ¿Detallar o deducción estándar?: what you could itemize — mortgage interest (from
 * your mortgage), state and local taxes (from your paycheck and the escrow's property tax), gifts to
 * charity and medical costs (your last 12 months of transactions) — against the standard deduction,
 * and the federal tax each way (Engine.usItemizeCheck). Any amount can be typed over;
 * yd.itemizeInputs: { mortgage, property, charity, medical } (null = from your data). */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const CHARITY = ['Diezmo/Donaciones Religiosas', 'Donaciones Benéficas'];
    const cfg = (yd) => yd.itemizeInputs || (yd.itemizeInputs = { mortgage: null, property: null, charity: null, medical: null });

    // What your own data says for each amount.
    function auto(ctx) {
        const s = ctx.state, yd = ctx.year, t = ctx.today;
        const since = Engine.isoDate(new Date(t.getFullYear() - 1, t.getMonth(), t.getDate() + 1));
        const spent = (test) => s.transactions.filter(x => (x.type || 'Gasto') === 'Gasto' && x.date >= since && !x.fromGoal && test(x)).reduce((a, x) => a + Engine.spendAmount(x), 0);
        const m = s.mortgage || {};
        const balance = Number((yd.netWorth || {}).mortgage) || 0;
        const pay = Engine.loanPayment(m.amount, m.rate, (Number(m.years) || 30) * 12).payment;
        const mortgage = balance > 0 && Number(m.rate) > 0 ? Engine.loanInterestAhead(balance, m.rate, pay, 12) : 0;
        const property = balance > 0 && Number(m.propertyTax) > 0 ? Number(m.propertyTax) : spent(x => x.category === 'Impuesto Predial');
        return { mortgage, property, charity: spent(x => CHARITY.includes(x.category)), medical: spent(x => x.parentCategory === 'Salud' && x.category !== 'Seguro Médico') };
    }

    function check(ctx) {
        const yd = ctx.year, p = ctx.pay, c = cfg(yd), a = auto(ctx);
        const val = (k) => (c[k] === null || c[k] === undefined || c[k] === '' ? a[k] : Number(c[k]) || 0);
        const w = yd.withholding || {};
        // A joint return carries the other paychecks' wages and their state and city tax too.
        const j = Engine.jointWagesUS(p, w);
        const income = (Number(p.incomeWages) || 0) + j.wages + (Number(w.untaxed) || 0);
        const earners = j.joint ? p.earners || [] : [];
        const saltIncome = ((Number(p.stateM) || 0) + (Number(p.localM) || 0) + earners.reduce((a, e) => a + (Number(e.stateM) || 0) + (Number(e.localM) || 0), 0)) * 12;
        const r = Engine.usItemizeCheck({ yd, income, mortgageInterest: val('mortgage'), saltIncome, propertyTax: val('property'), charity: val('charity'), medical: val('medical') });
        return { yd, c, a, val, saltIncome, r };
    }

    // Cash gifts that still come off when taking the standard deduction (for the refund estimate).
    const giftsOffStandard = (ctx) => (Number(ctx.year.itemized) > 0 ? 0 : check(ctx).r.stdCharity);

    function render(ctx) {
        const el = document.getElementById('inc-itemize');
        if (!el) return;
        const { yd, c, a, val, saltIncome, r } = check(ctx);

        const v = (x) => (x === null || x === undefined ? '' : esc(String(x)));
        const field = (key, label, help) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" min="0" step="10" data-input="itemize.set" data-key="${key}" value="${v(c[key])}" placeholder="${esc(money0(a[key]))}"><span class="help">${help}</span></label>`;
        const box = document.getElementById('inc-itemize-in');
        if (box && !box.contains(document.activeElement)) UI.html('inc-itemize-in', `<div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
            ${field('mortgage', 'Mortgage interest per year ($)', 'Empty = estimated from your mortgage. The exact amount is on your Form 1098.')}
            ${field('property', 'Property tax per year ($)', 'Empty = from your escrow or your transactions.')}
            ${field('charity', 'Charitable gifts per year ($)', 'Empty = your gifts over the last 12 months.')}
            ${field('medical', 'Medical costs per year ($)', 'Empty = what you paid out of pocket in 12 months.')}
        </div>`);

        const note = (i) => i.key === 'salt' ? (i.raw > i.limit ? `tope ${money0(i.limit)}` : `${money0(saltIncome)} state and local + ${money0(val('property'))} property`)
            : i.key === 'charity' ? `${money0(i.raw)} minus ${money0(i.floor)} (0.5% of income)`
            : i.key === 'medical' ? `${money0(i.raw)} minus ${money0(i.floor)} (7.5% of income)` : '';
        const rows = r.items.map(i => `<tr><td>${esc(i.label)}${note(i) ? `<div class="text-[11px] text-slate-500">${note(i)}</div>` : ''}</td><td class="num">${money0(i.amount)}</td></tr>`).join('');
        const using = Number(yd.itemized) || 0;
        const verdict = r.itemize
            ? `<p><strong>Itemizing is better for you.</strong> You'd pay ${money0(r.saving)} less federal tax than with the standard deduction.</p>${Math.abs(using - r.itemized) >= 1 ? `<button type="button" class="btn btn-primary btn-sm mt-2" data-action="itemize.use" data-amount="${r.itemized}"><i class="fa-solid fa-check"></i> Use ${money0(r.itemized)} in my numbers</button>` : '<p class="text-emerald-700 mt-1"><i class="fa-solid fa-circle-check"></i> Already used in your numbers.</p>'}`
            : `<p><strong>The standard deduction is better for you.</strong> You'd need ${money0(r.short)} more in deductible expenses for itemizing to pay off.</p>${r.stdCharity > 0 ? `<p class="mt-1">From 2026, even with the standard deduction, your cash gifts to charity take off up to ${money0(r.stdCharity)}.</p>` : ''}${using > 0 ? `<button type="button" class="btn btn-secondary btn-sm mt-2" data-action="itemize.use" data-amount="0">Use the standard deduction</button>` : ''}`;
        const bunch = !r.itemize && r.short > 0 && val('charity') > 0 && r.short <= val('charity')
            ? `<p class="text-xs mt-2"><i class="fa-solid fa-lightbulb text-amber-500"></i> If you bunch two years of gifts into one (for example, January's in December), you'd itemize that year and take the standard deduction the next.</p>` : '';
        UI.html('inc-itemize', `<div class="grid grid-cols-1 md:grid-cols-2 gap-4 mt-4">
                <div class="table-wrap"><table class="table"><thead><tr><th>What you could itemize</th><th class="num">Deductible</th></tr></thead><tbody>${rows}</tbody>
                <tfoot><tr><td>Itemized total</td><td class="num">${money0(r.itemized)}</td></tr></tfoot></table></div>
                <div class="space-y-3">
                    <div class="grid grid-cols-2 gap-3">
                        <div class="kpi ${r.itemize ? 'tone-slate' : 'tone-emerald'}"><span class="kpi-label">Standard deduction</span><span class="kpi-value">${money0(r.standardTotal)}</span><span class="kpi-note">federal tax: ${money0(r.taxStandard)}</span></div>
                        <div class="kpi ${r.itemize ? 'tone-emerald' : 'tone-slate'}"><span class="kpi-label">Itemized deduction</span><span class="kpi-value">${money0(r.itemized)}</span><span class="kpi-note">federal tax: ${money0(r.taxItemized)}</span></div>
                    </div>
                    <div class="panel ${r.itemize ? 'tone-emerald' : 'tone-blue'} text-xs">${verdict}</div>${bunch}
                </div>
            </div>
            <p class="help mt-2">Estimated with the 2026 rules: state and local taxes up to ${money0(r.saltCap)}, charitable gifts above 0.5% of your income and medical costs above 7.5%. Costs paid from your HSA don't count.</p>`);
    }

    UI.register({
        'itemize.set': (el) => {
            const c = cfg(Store.active());
            c[el.dataset.key] = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        },
        'itemize.use': (el) => {
            const amount = Math.max(0, Number(el.dataset.amount) || 0);
            App.undoable(amount > 0 ? `Itemized deductions: ${money(amount)}` : 'Using the standard deduction', () => { Store.active().itemized = amount; });
        }
    });

    window.Itemize = { render, giftsOffStandard, check };
})();
