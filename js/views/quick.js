/*
 * Quick entry: a floating "+" on every screen opens a small sheet to log a purchase or income
 * in seconds — amount (keypad), a category chip, optional note. Automatic rules and the usual
 * budget-line matching apply; everything else can be completed later in Transacciones.
 */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    let state = null;   // { type, amount: '', category, sheet }

    // The categories used most in the last 90 days first, then the rest of the taxonomy.
    function topCategories(type) {
        const tax = type === 'Ingreso' ? Store.state.taxonomy.income : Store.state.taxonomy.expense;
        const since = Engine.isoDate(new Date(Date.now() - 90 * 86400000));
        const count = {};
        Store.state.transactions.forEach(t => { if ((t.type || 'Gasto') === type && t.date >= since && tax[t.parentCategory]) count[t.parentCategory] = (count[t.parentCategory] || 0) + 1; });
        const used = Object.keys(count).sort((a, b) => count[b] - count[a]);
        return used.concat(Object.keys(tax).filter(c => !used.includes(c))).slice(0, 8);
    }

    function body() {
        const cats = topCategories(state.type);
        if (!state.category || !cats.includes(state.category)) state.category = cats[0];
        const members = Store.state.members || [];
        const keys = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '.', '0', '⌫'];
        return `
            <div class="segmented mb-3" role="tablist">
                <button type="button" data-action="quick.type" data-type="Gasto" class="${state.type === 'Gasto' ? 'active' : ''}">− Expense</button>
                <button type="button" data-action="quick.type" data-type="Ingreso" class="${state.type === 'Ingreso' ? 'active' : ''}">+ Income</button>
            </div>
            <label class="quick-amount ${state.type === 'Ingreso' ? 'inc' : ''}"><span class="cur">${esc(Fmt.currency().symbol)}</span><input id="quick-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(state.amount)}" data-input="quick.amount" aria-label="Amount"></label>
            <div class="quick-keys">${keys.map(k => `<button type="button" data-action="quick.key" data-k="${k}">${k}</button>`).join('')}</div>
            <div class="quick-chips">${cats.map(c => `<button type="button" class="quick-chip ${c === state.category ? 'on' : ''}" data-action="quick.cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
            ${state.type === 'Gasto' ? `<div class="quick-chips quick-pay mt-3" role="radiogroup" aria-label="Payment method">${PAYMENTS.map(([v, icon, label]) => `<button type="button" class="quick-chip ${v === state.payment ? 'on' : ''}" data-action="quick.pay" data-pay="${esc(v)}" role="radio" aria-checked="${v === state.payment}"><i class="fa-solid ${icon}"></i> ${label}</button>`).join('')}</div>` : ''}
            <div class="grid grid-cols-1 sm:grid-cols-${members.length ? 3 : 2} gap-2 mt-3">
                <input id="quick-note" class="input" placeholder="Note (optional): Walmart, taxi…" autocomplete="off">
                <input id="quick-date" type="date" class="input" value="${Engine.isoDate(new Date())}">
                ${members.length ? `<select id="quick-member" class="input">${Views.whoOptions(Store.ui.lastMember || '', 'Who? —')}</select>` : ''}
            </div>
            <button type="button" class="btn btn-primary w-full mt-3 justify-center" data-action="quick.save" id="quick-save"><i class="fa-solid fa-check"></i> Save</button>
            <p class="help mt-2 text-center">More details (subcategory, line, repeat)? <a href="#" class="link" data-action="quick.full">Open the full form</a></p>`;
    }

    // How it was paid matters: a credit-card purchase doesn't leave checking until the card is
    // paid, so it must not lower "safe to spend". The last choice is remembered.
    const PAYMENTS = [['Tarjeta de Débito', 'fa-building-columns', 'Debit'], ['Tarjeta de Crédito', 'fa-credit-card', 'Credit'], ['Efectivo', 'fa-money-bill-wave', 'Efectivo'], ['Transferencia', 'fa-right-left', 'Transferencia']];

    function open() {
        state = { type: (state && state.type) || 'Gasto', amount: '', category: null, payment: Store.ui.lastPayment || 'Tarjeta de Débito' };
        state.sheet = UI.sheet({ title: 'Quick entry', icon: 'fa-bolt', html: body(), onClose: () => { state.sheet = null; } });
        // On a phone the app's own keypad is the keyboard: focusing would open the system one on top.
        if (window.matchMedia && matchMedia('(pointer: fine)').matches) setTimeout(() => { const a = document.getElementById('quick-amount'); if (a) a.focus(); }, 30);
    }

    function redraw() {
        if (!state || !state.sheet) return;
        const note = document.getElementById('quick-note'), date = document.getElementById('quick-date');
        const keep = { note: note ? note.value : '', date: date ? date.value : '' };
        state.sheet.body.innerHTML = body();
        if (keep.note) document.getElementById('quick-note').value = keep.note;
        if (keep.date) document.getElementById('quick-date').value = keep.date;
    }

    const clean = (v) => { let s = String(v).replace(',', '.').replace(/[^\d.]/g, ''); const i = s.indexOf('.'); if (i >= 0) s = s.slice(0, i + 1) + s.slice(i + 1).replace(/\./g, '').slice(0, 2); return s.replace(/^0+(?=\d)/, ''); };

    UI.register({
        'quick.open': () => open(),
        'quick.type': (el) => { state.type = el.dataset.type; state.category = null; redraw(); },
        'quick.pay': (el) => { state.payment = el.dataset.pay; UI.$$('.quick-pay .quick-chip').forEach(b => { const on = b.dataset.pay === state.payment; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }); },
        'quick.cat': (el) => { state.category = el.dataset.cat; UI.$$('.quick-chip').forEach(b => b.classList.toggle('on', b.dataset.cat === state.category)); },
        'quick.amount': (el) => { const c = clean(el.value); if (c !== el.value) el.value = c; state.amount = c; },
        'quick.key': (el) => {
            const k = el.dataset.k;
            state.amount = k === '⌫' ? state.amount.slice(0, -1) : clean(state.amount + k);
            document.getElementById('quick-amount').value = state.amount;
        },
        'quick.full': () => {
            const amount = Number(state.amount) || '';
            const note = document.getElementById('quick-note').value.trim();
            state.sheet.close();
            TxnForm.prefill({ type: state.type, parent: state.category, description: note, amount, paymentType: state.type === 'Gasto' ? state.payment : undefined });
        },
        'quick.save': () => {
            const amount = Math.round((Number(state.amount) || 0) * 100) / 100;
            if (!(amount > 0)) { UI.toast('Type an amount greater than 0.', 'error'); document.getElementById('quick-amount').focus(); return; }
            const s = Store.state;
            const note = document.getElementById('quick-note').value.trim();
            const date = document.getElementById('quick-date').value || Engine.isoDate(new Date());
            const memberSel = document.getElementById('quick-member');
            const tax = state.type === 'Ingreso' ? s.taxonomy.income : s.taxonomy.expense;
            let cat = state.category;
            let line;
            const rule = note ? Importers.applyRules(s.rules, note) : null;
            if (rule && tax[rule.category]) { cat = rule.category; line = rule.budgetLine; }
            const t = { id: Store.nextId(s.transactions), type: state.type, description: (rule && rule.rename) || note || cat, store: '', parentCategory: cat, category: rule && rule.sub && rule.category === cat && (tax[cat] || []).includes(rule.sub) ? rule.sub : (tax[cat] || [])[0] || '', amount, date, paymentType: state.type === 'Ingreso' ? 'Transferencia' : state.payment, createdAt: new Date().toISOString() };
            if (state.type !== 'Ingreso') Store.ui.lastPayment = state.payment;
            if (line && state.type !== 'Ingreso') t.budgetLine = String(line);
            if (memberSel && memberSel.value) { t.memberId = Number(memberSel.value); Store.ui.lastMember = t.memberId; }
            s.transactions.push(t);
            state.sheet.close();
            App.changed({ structural: true, step: true });
            if (!TxnForm.warnIfImported(t)) UI.toast(`${state.type === 'Ingreso' ? '+' : '−'}${money(amount)} in ${cat} logged.`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
        }
    });

    window.QuickEntry = { open };

    // Enter in the amount saves.
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && (e.target.id === 'quick-amount' || e.target.id === 'quick-note')) { e.preventDefault(); UI.$('#quick-save') && UI.$('#quick-save').click(); } });
})();
