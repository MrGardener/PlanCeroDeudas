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
            <div class="wi-head"><i class="fa-solid fa-wallet text-blue-600"></i> Del presupuesto de este mes</div>
            ${verdict(kind, kind === 'ok' ? 'Cabe' : kind === 'warn' ? 'Cabe, pero frena tu ahorro' : 'No alcanza')}
            <ul class="wi-list">
                ${safe.res ? change('Seguro para gastar hoy', safe.res.safe, safe.res.safe - amount) : '<li class="help">Agrega el saldo de tu cuenta para ver el efecto en tu efectivo.</li>'}
            </ul>
            <div class="section-label mt-3">Saldría de</div>
            <ul class="wi-list">${r.takes.map(t => `<li class="wi-change"><span>${esc(t.name)}${t.kind === 'goal' ? ' <span class="badge badge-purple">meta</span>' : t.kind === 'savings' ? ' <span class="badge badge-info">ahorro</span>' : ''}</span><span class="num">−${money(t.take)}${t.take < t.available - 0.004 ? ` <span class="text-slate-500 text-[11px]">de ${money(t.available)}</span>` : ' <span class="text-slate-500 text-[11px]">(todo)</span>'}</span></li>`).join('') || '<li class="help">—</li>'}
                ${r.short > 0 ? `<li class="wi-change text-red-600 font-bold"><span>Faltan (sin rubro de dónde sacar)</span><span class="num">${money(r.short)}</span></li>` : ''}</ul>
            <p class="help mt-2">Los pagos fijos y de deudas no se tocan. Si lo haces, cambia esos rubros en tu presupuesto del mes.</p>
        </div>`;
    }

    function fromSavings(amount, ctx) {
        const liquid = ctx.ef.liquid;
        const ef2 = Engine.emergencyFund({ liquid: Math.max(0, liquid - amount), budgetBase: ctx.year.budgetBase });
        const steps2 = Engine.babySteps({ liquid: ef2.liquid, consumerDebt: ctx.debts.totalBalance, monthsCovered: ef2.monthsCovered, savingsRate: ctx.savingsRate, mortgageBalance: ctx.netWorth.fields.mortgage, ownsHome: ctx.ownsHome, money: Fmt.money0 });
        const kind = amount > liquid || ef2.liquid < 1000 ? 'bad' : ef2.monthsCovered < 3 || steps2.current < ctx.steps.current ? 'warn' : 'ok';
        return `<div class="wi-col" id="wi-savings">
            <div class="wi-head"><i class="fa-solid fa-piggy-bank text-emerald-600"></i> De tus ahorros</div>
            ${verdict(kind, amount > liquid ? 'No tienes tanto ahorrado' : kind === 'ok' ? 'Tu fondo lo aguanta' : kind === 'warn' ? 'Debilita tu fondo' : 'Te deja sin colchón')}
            <ul class="wi-list">
                ${change('Ahorro disponible (DPF + cuentas de ahorro)', liquid, Math.max(0, liquid - amount))}
                ${change('Meses de gastos cubiertos', ctx.ef.monthsCovered, ef2.monthsCovered, v => v.toFixed(1))}
                ${change('Tu paso de Dave Ramsey', ctx.steps.current, steps2.current, v => `Paso ${v}`)}
            </ul>
            <p class="help mt-2">El fondo de emergencia es para imprevistos, no para compras planeadas. Si lo usas, repónlo con una meta.</p>
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
        const newDebt = { id: 'wi', name: st.description || 'Compra', balance: amount, rate, minPayment: cuota, monthly: cuota };
        const before = ctx.debts;
        const after = Engine.debtPayoff(s.debts.concat([newDebt]), s.debtPlan.strategy, extra);
        const missing = Math.max(0, cuota - pool);
        const when = (p) => p.never ? 'nunca' : p.totalBalance <= 0.01 ? 'ya' : Fmt.monthYear(Engine.addMonths(new Date(), p.months));
        const kind = after.never || missing > 0 ? 'bad' : 'warn';
        return `<div class="wi-col" id="wi-card">
            <div class="wi-head"><i class="fa-solid fa-credit-card text-purple-600"></i> Con tarjeta, ${months} cuota${months === 1 ? '' : 's'}</div>
            ${verdict(kind, kind === 'bad' ? 'Tu presupuesto no cubre la cuota' : 'Es una deuda nueva')}
            <ul class="wi-list">
                <li class="wi-change"><span>Cuota mensual</span><span class="num font-bold">${money(cuota)}</span></li>
                <li class="wi-change"><span>Intereses en total${rate === 0 ? ' (diferido sin intereses)' : ` (${rate}% anual)`}</span><span class="num ${interest > 0 ? 'text-red-600 font-bold' : ''}">${money(interest)}</span></li>
                ${change('Deudas de consumo', before.totalBalance, before.totalBalance + amount, money0, false)}
                <li class="wi-change"><span>Libre de deudas</span><span class="num"><span class="text-slate-500">${when(before)}</span> → <strong class="${after.months > before.months || after.never ? 'text-red-600' : ''}">${when(after)}</strong></span></li>
                ${missing > 0 ? `<li class="wi-change text-red-600"><span>Tu presupuesto para deudas no alcanza la cuota</span><span class="num">faltan ${money(missing)}/mes</span></li>` : `<li class="help">La cuota sale de lo que hoy va a tu bola de nieve (${money0(pool)}/mes).</li>`}
                ${ctx.steps.current > 2 ? '<li class="text-red-600 text-xs font-bold">Volverías al Paso 2: pagar deudas.</li>' : ''}
            </ul>
            <p class="help mt-2">Dave Ramsey: no financies compras. Si no puedes pagarlo en efectivo, ahorra para ello con una meta.</p>
        </div>`;
    }

    function results() {
        const host = document.getElementById('wi-results');
        if (!host) return;
        const amount = Math.round((Number(st.amount) || 0) * 100) / 100;
        if (!(amount > 0)) { host.innerHTML = '<p class="help">Escribe el monto para ver qué pasaría.</p>'; return; }
        const ctx = App.buildContext();
        host.innerHTML = `<div class="grid grid-cols-1 lg:grid-cols-3 gap-3">${fromBudget(amount)}${fromSavings(amount, ctx)}${onCard(amount, ctx)}</div>
            <div class="flex flex-wrap items-center justify-between gap-2 mt-4">
                <span class="help"><i class="fa-solid fa-flask"></i> Es solo una prueba: nada se guarda.</span>
                <button type="button" class="btn btn-secondary btn-sm" data-action="wi.record"><i class="fa-solid fa-receipt"></i> Registrar la compra</button>
            </div>`;
    }

    function open() {
        const mo = thisMonth();
        const card = (Store.state.debts || []).find(d => d.kind === 'tarjeta' && Number(d.rate) > 0);
        st = { description: '', amount: '', line: '', months: 3, rate: card ? Number(card.rate) : 16.5 };
        const lines = mo.items.filter(i => !Engine.isSavingsItem(i) && i.type !== 'Deuda' && i.type !== 'Ingreso');
        st.sheet = UI.sheet({
            title: '¿Y si compro…?', icon: 'fa-flask', wide: true, onClose: () => { st = null; },
            html: `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3">
                    <label class="field lg:col-span-2"><span class="field-label">¿Qué?</span><input id="wi-desc" class="input" placeholder="Ej: Pasaje a Galápagos" data-input="wi.input" data-key="description" autocomplete="off"></label>
                    <label class="field"><span class="field-label"><span>Monto (<span class="cur">${esc(Fmt.currency().symbol)}</span>)</span></span><input id="wi-amount" class="input" inputmode="decimal" placeholder="1200" data-input="wi.input" data-key="amount" autocomplete="off"></label>
                    <label class="field"><span class="field-label">Contaría en el rubro</span><select id="wi-line" class="input" data-change="wi.input" data-key="line"><option value="">Ninguno en especial</option>${lines.map(i => `<option value="${esc(String(i.id))}">${esc(i.name)}</option>`).join('')}</select></label>
                    <div class="field"><span class="field-label">Con tarjeta: cuotas y tasa</span><div class="flex gap-2"><input id="wi-months" type="number" min="1" max="60" class="input" value="3" data-input="wi.input" data-key="months" aria-label="Cuotas"><input id="wi-rate" type="number" min="0" step="0.1" class="input" value="${st.rate}" data-input="wi.input" data-key="rate" aria-label="Tasa anual %"></div><span class="help">Tasa 0 = diferido sin intereses.</span></div>
                </div>
                <div id="wi-results" class="mt-4"></div>`
        });
        st.sheet.el.querySelector('.modal').classList.add('modal-xwide');
        results();
        setTimeout(() => { const a = document.getElementById('wi-amount'); if (a) a.focus(); }, 30);
    }

    UI.register({
        'wi.open': () => open(),
        'wi.input': (el) => { if (!st) return; st[el.dataset.key] = el.value; results(); },
        'wi.record': () => {
            if (!st) return;
            const v = { type: 'Gasto', description: st.description || '', amount: Number(st.amount) || '', budgetLine: st.line || undefined };
            const line = st.line && thisMonth().items.find(i => String(i.id) === String(st.line));
            if (line && line.linkedCategory && line.linkedCategory !== 'none') v.parent = line.linkedCategory;
            st.sheet.close();
            TxnForm.prefill(v);
        }
    });

    window.WhatIf = { open };
})();
