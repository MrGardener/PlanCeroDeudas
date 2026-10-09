/* Futuro → Calculadoras: quick what-ifs that don't touch the plan — a loan's payment, paying off
 * a credit card (vs. only the minimum), how money grows, and how much to save for something.
 * Inputs start from your own numbers where there are some, and live only on screen (Store.ui). */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    function defaults() {
        const s = Store.state;
        const card = (s.debts || []).find(d => d.kind === 'tarjeta' && Number(d.balance) > 0);
        const goal = (s.goals || []).find(g => (Number(g.target) || 0) > (Number(g.current) || 0));
        const r = s.retirement || {};
        return {
            loan: { amount: 20000, rate: 7, years: 5 },
            card: { balance: card ? Number(card.balance) : 5000, rate: card ? Number(card.rate) : 24, payment: card ? Math.max(Number(card.monthly) || 0, 100) : 200 },
            grow: { initial: 1000, monthly: 200, rate: Store.COUNTRY === 'US' ? 10 : 7, years: 20, inflation: Store.COUNTRY === 'US' ? 3 : 2.5 },
            goal: { target: goal ? Number(goal.target) : 5000, have: goal ? Number(goal.current) || 0 : 0, rate: goal ? Number(goal.rate) || 0 : 4, months: 24, monthly: goal ? Number(goal.monthly) || 0 : 150 },
            _age: r.edadActual
        };
    }
    const st = () => Store.ui.calc || (Store.ui.calc = defaults());

    const field = (calc, key, label, opts = {}) => `<label class="field"><span class="field-label">${label}</span>
        <input type="number" class="input" inputmode="decimal" min="0" step="${opts.step || 'any'}" data-input="calc.set" data-calc="${calc}" data-key="${key}" value="${esc(String(st()[calc][key]))}"></label>`;
    const result = (rows) => `<div class="calc-result">${rows.map(([k, v, strong]) => `<div class="flex justify-between gap-3"><span>${k}</span><span class="${strong ? 'font-black text-base' : 'font-bold'} whitespace-nowrap">${v}</span></div>`).join('')}</div>`;

    function render() {
        UI.html('calc-loan-in', field('loan', 'amount', 'Loan amount ($)', { step: 100 }) + field('loan', 'rate', 'Annual rate (%)', { step: 0.1 }) + field('loan', 'years', 'Term (years)', { step: 1 }));
        UI.html('calc-card-in', field('card', 'balance', 'Card balance ($)', { step: 50 }) + field('card', 'rate', 'Annual rate (%)', { step: 0.1 }) + field('card', 'payment', 'You\'d pay each month ($)', { step: 10 }));
        UI.html('calc-grow-in', field('grow', 'initial', 'You have today ($)', { step: 100 }) + field('grow', 'monthly', 'You add each month ($)', { step: 10 }) + field('grow', 'rate', 'Annual return (%)', { step: 0.1 }) + field('grow', 'years', 'Years', { step: 1 }) + field('grow', 'inflation', 'Annual inflation (%)', { step: 0.1 }));
        UI.html('calc-goal-in', field('goal', 'target', 'You need ($)', { step: 100 }) + field('goal', 'have', 'You already have ($)', { step: 100 }) + field('goal', 'rate', 'Annual interest on savings (%)', { step: 0.1 }) + field('goal', 'months', 'You want it in (months)', { step: 1 }) + field('goal', 'monthly', 'Or you can put in per month ($)', { step: 10 }));
        update();
    }

    function update() {
        const c = st(), today = new Date();
        const L = Engine.loanPayment(c.loan.amount, c.loan.rate, (Number(c.loan.years) || 0) * 12);
        UI.html('calc-loan-out', result([['Monthly payment', money(L.payment), true], ['Total you pay', money0(L.total)], ['Of that, interest', money0(L.interest)]])
            + `<p class="help mt-2">${L.interest > 0 ? `Interest is ${Math.round(L.interest / Math.max(1, Number(c.loan.amount)) * 100)}% of what you borrow. A shorter term or a bigger down payment lowers it.` : 'No interest.'}</p>`);

        const K = Engine.cardPayoff(c.card.balance, c.card.rate, c.card.payment);
        const when = (n) => Fmt.monthYear(Engine.addMonths(today, n));
        const fixed = K.fixed.never ? ['With your payment', 'Never: it doesn\'t cover the interest', true] : ['With your payment', `${K.fixed.months} months (${when(K.fixed.months)})`, true];
        const rows = [fixed];
        if (!K.fixed.never) rows.push(['Interest you\'d pay', money0(K.fixed.interest)]);
        rows.push(['Minimum payment only', K.minimum.never ? 'Never' : `${K.minimum.months} months · ${money0(K.minimum.interest)} interest`]);
        const saved = !K.fixed.never && !K.minimum.never ? K.minimum.interest - K.fixed.interest : null;
        UI.html('calc-card-out', result(rows) + `<p class="help mt-2">${saved && saved > 0 ? `<span>Paying ${money0(c.card.payment)} instead of the minimum saves you <strong>${money0(saved)}</strong> and ${Math.max(0, K.minimum.months - K.fixed.months)} months.</span> ` : ''}<span>Typical minimum: 1% of the balance + the month's interest (at least $25).</span></p>`);

        const G = Engine.growthValue(c.grow.initial, c.grow.monthly, c.grow.rate, c.grow.years, c.grow.inflation);
        UI.html('calc-grow-out', result([[`In ${Number(c.grow.years) || 0} years you'd have`, money0(G.value), true], ['In today\'s dollars', money0(G.today)], ['What you put in', money0(G.contributed)], ['What it grew', money0(G.growth)]])
            + `<p class="help mt-2">${G.contributed > 0 && G.growth > G.contributed ? 'Compound interest earned more than your own deposits: that\'s why starting early pays.' : 'With more years, growth matters more and more than what you put in.'}</p>`);

        const need = Engine.monthlyToReach(c.goal.target, c.goal.have, c.goal.rate, c.goal.months);
        const g = Engine.goalMonths({ target: c.goal.target, current: c.goal.have, monthly: c.goal.monthly, rate: c.goal.rate });
        const inMonths = g.status === 'never' || g.months === null ? 'Never' : g.months === 0 ? 'You already have it' : `${g.months} months (${when(g.months)})`;
        UI.html('calc-goal-out', result([[`To have it in ${Number(c.goal.months) || 0} months`, need > 0 ? `${money(need)}/mo` : 'You already have it', true], [`With ${money0(c.goal.monthly)}/mo you get there in`, inMonths]]));
    }

    UI.register({
        'calc.set': (el) => {
            const c = st();
            c[el.dataset.calc][el.dataset.key] = Math.max(0, Fmt.parseNum(el.value, 0));
            update();
        },
        'calc.reset': () => { Store.ui.calc = defaults(); render(); }
    });

    App.defineView('futuro/calculadoras', { render, update });
})();
