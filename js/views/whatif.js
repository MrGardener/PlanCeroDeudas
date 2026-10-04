/*
 * "¿Y si compro…?" — a sandbox for one purchase. Three ways to pay it side by side: from this
 * month's budget, from savings, or on a credit card in installments, each with what it would
 * starve or delay. Nothing is saved; "Registrar la compra" only prefills the form.
 */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    let st = null;   // { sheet, description, amount, line, months, rate }

    function thisMonth() {
        const t = new Date();
        const y = t.getFullYear(), m = String(t.getMonth() + 1);
        const yd = Store.effective(Store.state.years[y] ? y : Store.state.activeYear);
        const items = Engine.monthItems(yd, m);
        const spend = Engine.lineSpend(items, Store.state.transactions, y, m);
        const mb = Engine.monthBudget(yd, m, Engine.payroll(yd));
        return { items, spend, free: Math.max(0, mb.balanceReal), sweep: mb.sweep };
    }

    const verdict = (kind, text) => `<span class="badge ${kind === 'ok' ? 'badge-ok' : kind === 'warn' ? 'badge-warn' : 'badge-bad'}"><i class="fa-solid ${kind === 'ok' ? 'fa-circle-check' : kind === 'warn' ? 'fa-triangle-exclamation' : 'fa-circle-xmark'}"></i> ${text}</span>`;
    const change = (label, before, after, fmt = money0, worseWhenLower = true) => {
        const worse = worseWhenLower ? after < before - 0.004 : after > before + 0.004;
        return `<li class="wi-change"><span>${label}</span><span class="num"><span class="text-slate-500">${fmt(before)}</span> → <strong class="${worse ? 'text-red-600' : ''}">${fmt(after)}</strong></span></li>`;
    };

    function fromBudget(amount) {
        const mo = thisMonth();
        const r = Engine.starveLines({ items: mo.items, spend: mo.spend, amount, lineId: st.line, free: mo.free, sweep: mo.sweep });
        const safe = Cash.safeContext(new Date());
        const goalsHit = r.takes.filter(t => t.kind === 'goal' || t.kind === 'savings');
        const kind = r.short > 0 || (safe.res && safe.res.safe - amount < 0) ? 'bad' : goalsHit.length ? 'warn' : 'ok';
        return `<div class="wi-col" id="wi-budget">
            <div class="wi-head"><i class="fa-solid fa-wallet text-blue-600"></i> From this month's budget</div>
            ${verdict(kind, kind === 'ok' ? 'Fits' : kind === 'warn' ? 'Fits, but slows your saving' : 'Doesn\'t fit')}
            <ul class="wi-list">
                ${safe.res ? change('Safe to spend today', safe.res.safe, safe.res.safe - amount) : '<li class="help">Add your account balance to see the effect on your cash.</li>'}
            </ul>
            <div class="section-label mt-3">It would come from</div>
            <ul class="wi-list">${r.takes.map(t => `<li class="wi-change"><span>${esc(t.name)}${t.kind === 'goal' ? ' <span class="badge badge-purple">goal</span>' : t.kind === 'savings' ? ' <span class="badge badge-info">ahorro</span>' : ''}</span><span class="num">−${money(t.take)}${t.take < t.available - 0.004 ? ` <span class="text-slate-500 text-[11px]">de ${money(t.available)}</span>` : ' <span class="text-slate-500 text-[11px]">(all)</span>'}</span></li>`).join('') || '<li class="help">—</li>'}
                ${r.short > 0 ? `<li class="wi-change text-red-600 font-bold"><span>Missing (no line to take it from)</span><span class="num">${money(r.short)}</span></li>` : ''}</ul>
            <p class="help mt-2">Fixed bills and debt payments aren't touched. If you do it, change those lines in this month's budget.</p>
        </div>`;
    }

    function fromSavings(amount, ctx) {
        const liquid = ctx.ef.liquid;
        const ef2 = Engine.emergencyFund({ liquid: Math.max(0, liquid - amount), budgetBase: ctx.year.budgetBase });
        const steps2 = Engine.babySteps({ liquid: ef2.liquid, consumerDebt: ctx.debts.totalBalance, monthsCovered: ef2.monthsCovered, savingsRate: ctx.savingsRate, mortgageBalance: ctx.netWorth.fields.mortgage, ownsHome: ctx.ownsHome, money: Fmt.money0 });
        const kind = amount > liquid || ef2.liquid < 1000 ? 'bad' : ef2.monthsCovered < 3 || steps2.current < ctx.steps.current ? 'warn' : 'ok';
        return `<div class="wi-col" id="wi-savings">
            <div class="wi-head"><i class="fa-solid fa-piggy-bank text-emerald-600"></i> From your savings</div>
            ${verdict(kind, amount > liquid ? 'You don\'t have that much saved' : kind === 'ok' ? 'Your fund can handle it' : kind === 'warn' ? 'Weakens your fund' : 'Leaves you without a cushion')}
            <ul class="wi-list">
                ${change('Available savings (CDs + savings accounts)', liquid, Math.max(0, liquid - amount))}
                ${change('Months of expenses covered', ctx.ef.monthsCovered, ef2.monthsCovered, v => v.toFixed(1))}
                ${change('Your Dave Ramsey step', ctx.steps.current, steps2.current, v => `Step ${v}`)}
            </ul>
            <p class="help mt-2">The emergency fund is for emergencies, not planned purchases. If you use it, rebuild it with a goal.</p>
        </div>`;
    }

    function onCard(amount, ctx) {
        const s = Store.state;
        const months = Math.max(1, Math.min(60, Number(st.months) || 1));
        const rate = Math.max(0, Number(st.rate) || 0);
        const cuota = Engine.frenchPayment(amount, rate, months);
        const interest = cuota * months - amount;
        const pool = ctx.debtExtraRubros;
        const extra = Math.max(0, pool - cuota);
        const newDebt = { id: 'wi', name: st.description || 'Purchase', balance: amount, rate, minPayment: cuota, monthly: cuota };
        const before = ctx.debts;
        const after = Engine.debtPayoff(s.debts.concat([newDebt]), s.debtPlan.strategy, extra);
        const missing = Math.max(0, cuota - pool);
        const when = (p) => p.never ? 'nunca' : p.totalBalance <= 0.01 ? 'ya' : Fmt.monthYear(Engine.addMonths(new Date(), p.months));
        const kind = after.never || missing > 0 ? 'bad' : 'warn';
        return `<div class="wi-col" id="wi-card">
            <div class="wi-head"><i class="fa-solid fa-credit-card text-purple-600"></i> On a card, ${months} installment${months === 1 ? '' : 's'}</div>
            ${verdict(kind, kind === 'bad' ? 'Your budget doesn\'t cover the payment' : 'It\'s new debt')}
            <ul class="wi-list">
                <li class="wi-change"><span>Monthly payment</span><span class="num font-bold">${money(cuota)}</span></li>
                <li class="wi-change"><span>Total interest${rate === 0 ? ' (no-interest installments)' : ` (${rate}% a year)`}</span><span class="num ${interest > 0 ? 'text-red-600 font-bold' : ''}">${money(interest)}</span></li>
                ${change('Consumer debt', before.totalBalance, before.totalBalance + amount, money0, false)}
                <li class="wi-change"><span>Debt-free</span><span class="num"><span class="text-slate-500">${when(before)}</span> → <strong class="${after.months > before.months || after.never ? 'text-red-600' : ''}">${when(after)}</strong></span></li>
                ${missing > 0 ? `<li class="wi-change text-red-600"><span>Your debt budget doesn't cover the payment</span><span class="num">${money(missing)}/mo short</span></li>` : `<li class="help">The payment comes out of what goes to your snowball today (${money0(pool)}/mo).</li>`}
                ${ctx.steps.current > 2 ? '<li class="text-red-600 text-xs font-bold">You\'d go back to Step 2: paying off debt.</li>' : ''}
            </ul>
            <p class="help mt-2">Dave Ramsey: don't finance purchases. If you can't pay cash, save for it with a goal.</p>
        </div>`;
    }

    function results() {
        const host = document.getElementById('wi-results');
        if (!host) return;
        const amount = Math.round((Number(st.amount) || 0) * 100) / 100;
        if (!(amount > 0)) { host.innerHTML = '<p class="help">Type the amount to see what would happen.</p>'; return; }
        const ctx = App.buildContext();
        host.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-3">${fromBudget(amount)}${fromSavings(amount, ctx)}${onCard(amount, ctx)}</div>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-4">
                <span class="help"><i class="fa-solid fa-flask"></i> It's only a test: nothing is saved.</span>
                <button type="button" class="btn btn-secondary btn-sm" data-action="wi.record"><i class="fa-solid fa-receipt"></i> Log the purchase</button>
            </div>`;
    }

    function open() {
        const mo = thisMonth();
        const card = (Store.state.debts || []).find(d => d.kind === 'tarjeta' && Number(d.rate) > 0);
        st = { description: '', amount: '', line: '', months: 3, rate: card ? Number(card.rate) : 16.5 };
        const lines = mo.items.filter(i => !Engine.isSavingsItem(i) && i.type !== 'Deuda' && i.type !== 'Ingreso');
        st.sheet = UI.sheet({
            title: 'What if I buy…?', icon: 'fa-flask', wide: true, onClose: () => { st = null; },
            html: `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <label class="field lg:col-span-2"><span class="field-label">What?</span><input id="wi-desc" class="input" placeholder="E.g. Flight to Hawaii" data-input="wi.input" data-key="description" autocomplete="off"></label>
                    <label class="field"><span class="field-label"><span>Amount (<span class="cur">${esc(Fmt.currency().symbol)}</span>)</span></span><input id="wi-amount" class="input" inputmode="decimal" placeholder="1200" data-input="wi.input" data-key="amount" autocomplete="off"></label>
                    <label class="field"><span class="field-label">Would count in the line</span><select id="wi-line" class="input" data-change="wi.input" data-key="line"><option value="">None in particular</option>${lines.map(i => `<option value="${esc(String(i.id))}">${esc(i.name)}</option>`).join('')}</select></label>
                    <div class="field"><span class="field-label">On a card: installments and rate</span><div class="flex gap-2"><input id="wi-months" type="number" min="1" max="60" class="input" value="3" data-input="wi.input" data-key="months" aria-label="Installments"><input id="wi-rate" type="number" min="0" step="0.1" class="input" value="${st.rate}" data-input="wi.input" data-key="rate" aria-label="Annual rate %"></div><span class="help">Rate 0 = no-interest installments.</span></div>
                </div>
                <div id="wi-results" class="mt-4"></div>`
        });
        st.sheet.el.querySelector('.modal').classList.add('modal-xwide');
        results();
        // Start on the amount, unless you're already typing somewhere in the sheet.
        setTimeout(() => { const a = document.getElementById('wi-amount'); if (a && st && !st.sheet.el.contains(document.activeElement)) a.focus(); }, 30);
    }

    UI.register({
        'wi.open': () => open(),
        'wi.input': (el) => { if (!st) return; st[el.dataset.key] = el.value; results(); },
        'wi.record': () => {
            if (!st) return;
            // Read the fields themselves too, in case the last keystroke hasn't reached `st` yet.
            const field = (id) => (document.getElementById(id) || {}).value || '';
            const v = { type: 'Gasto', description: st.description || field('wi-desc'), amount: Number(st.amount) || Number(field('wi-amount')) || '', budgetLine: st.line || undefined };
            const line = st.line && thisMonth().items.find(i => String(i.id) === String(st.line));
            if (line && line.linkedCategory && line.linkedCategory !== 'none') v.parent = line.linkedCategory;
            st.sheet.close();
            TxnForm.prefill(v);
        }
    });

    window.WhatIf = { open };
})();
