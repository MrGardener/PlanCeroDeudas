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
        UI.html('calc-loan-in', field('loan', 'amount', 'Monto del préstamo ($)', { step: 100 }) + field('loan', 'rate', 'Tasa anual (%)', { step: 0.1 }) + field('loan', 'years', 'Plazo (años)', { step: 1 }));
        UI.html('calc-card-in', field('card', 'balance', 'Saldo de la tarjeta ($)', { step: 50 }) + field('card', 'rate', 'Tasa anual (%)', { step: 0.1 }) + field('card', 'payment', 'Pagarías cada mes ($)', { step: 10 }));
        UI.html('calc-grow-in', field('grow', 'initial', 'Tienes hoy ($)', { step: 100 }) + field('grow', 'monthly', 'Pones cada mes ($)', { step: 10 }) + field('grow', 'rate', 'Rendimiento anual (%)', { step: 0.1 }) + field('grow', 'years', 'Años', { step: 1 }) + field('grow', 'inflation', 'Inflación anual (%)', { step: 0.1 }));
        UI.html('calc-goal-in', field('goal', 'target', 'Necesitas ($)', { step: 100 }) + field('goal', 'have', 'Ya tienes ($)', { step: 100 }) + field('goal', 'rate', 'Interés anual del ahorro (%)', { step: 0.1 }) + field('goal', 'months', 'Lo quieres en (meses)', { step: 1 }) + field('goal', 'monthly', 'O puedes poner al mes ($)', { step: 10 }));
        update();
    }

    function update() {
        const c = st(), today = new Date();
        const L = Engine.loanPayment(c.loan.amount, c.loan.rate, (Number(c.loan.years) || 0) * 12);
        UI.html('calc-loan-out', result([['Cuota mensual', money(L.payment), true], ['Pagas en total', money0(L.total)], ['De eso, intereses', money0(L.interest)]])
            + `<p class="help mt-2">${L.interest > 0 ? `Los intereses son el ${Math.round(L.interest / Math.max(1, Number(c.loan.amount)) * 100)}% de lo que pides. Un plazo más corto o una entrada más grande los bajan.` : 'Sin intereses.'}</p>`);

        const K = Engine.cardPayoff(c.card.balance, c.card.rate, c.card.payment);
        const when = (n) => Fmt.monthYear(Engine.addMonths(today, n));
        const fixed = K.fixed.never ? ['Con tu pago', 'Nunca: no cubre los intereses', true] : ['Con tu pago', `${K.fixed.months} meses (${when(K.fixed.months)})`, true];
        const rows = [fixed];
        if (!K.fixed.never) rows.push(['Intereses que pagarías', money0(K.fixed.interest)]);
        rows.push(['Solo el pago mínimo', K.minimum.never ? 'Nunca' : `${K.minimum.months} meses · ${money0(K.minimum.interest)} de intereses`]);
        const saved = !K.fixed.never && !K.minimum.never ? K.minimum.interest - K.fixed.interest : null;
        UI.html('calc-card-out', result(rows) + `<p class="help mt-2">${saved && saved > 0 ? `<span>Pagando ${money0(c.card.payment)} en vez del mínimo te ahorras <strong>${money0(saved)}</strong> y ${Math.max(0, K.minimum.months - K.fixed.months)} meses.</span> ` : ''}<span>Mínimo típico: 1% del saldo + los intereses del mes (al menos $25).</span></p>`);

        const G = Engine.growthValue(c.grow.initial, c.grow.monthly, c.grow.rate, c.grow.years, c.grow.inflation);
        UI.html('calc-grow-out', result([[`En ${Number(c.grow.years) || 0} años tendrías`, money0(G.value), true], ['En dinero de hoy', money0(G.today)], ['Lo que pusiste', money0(G.contributed)], ['Lo que creció', money0(G.growth)]])
            + `<p class="help mt-2">${G.contributed > 0 && G.growth > G.contributed ? 'El interés compuesto ganó más que tus propios depósitos: por eso conviene empezar temprano.' : 'Con más años, el crecimiento pesa cada vez más que lo que pones.'}</p>`);

        const need = Engine.monthlyToReach(c.goal.target, c.goal.have, c.goal.rate, c.goal.months);
        const n = Engine.goalMonths({ target: c.goal.target, current: c.goal.have, monthly: c.goal.monthly, rate: c.goal.rate });
        const inMonths = n === 'never' || n === null || n === undefined ? 'Nunca' : n === 0 ? 'Ya lo tienes' : `${n} meses (${when(n)})`;
        UI.html('calc-goal-out', result([[`Para tenerlo en ${Number(c.goal.months) || 0} meses`, need > 0 ? `${money(need)}/mes` : 'Ya lo tienes', true], [`Con ${money0(c.goal.monthly)}/mes llegas en`, inMonths]]));
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
