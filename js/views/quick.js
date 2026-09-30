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
                <button type="button" data-action="quick.type" data-type="Gasto" class="${state.type === 'Gasto' ? 'active' : ''}">− Gasto</button>
                <button type="button" data-action="quick.type" data-type="Ingreso" class="${state.type === 'Ingreso' ? 'active' : ''}">+ Ingreso</button>
            </div>
            <label class="quick-amount ${state.type === 'Ingreso' ? 'inc' : ''}"><span class="cur">${esc(Fmt.currency().symbol)}</span><input id="quick-amount" inputmode="decimal" autocomplete="off" placeholder="0" value="${esc(state.amount)}" data-input="quick.amount" aria-label="Monto"></label>
            <div class="quick-keys">${keys.map(k => `<button type="button" data-action="quick.key" data-k="${k}">${k}</button>`).join('')}</div>
            <div class="quick-chips">${cats.map(c => `<button type="button" class="quick-chip ${c === state.category ? 'on' : ''}" data-action="quick.cat" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>
            <div class="grid grid-cols-1 sm:grid-cols-${members.length ? 3 : 2} gap-2 mt-3">
                <input id="quick-note" class="input" placeholder="Nota (opcional): Supermaxi, taxi…" autocomplete="off">
                <input id="quick-date" type="date" class="input" value="${Engine.isoDate(new Date())}">
                ${members.length ? `<select id="quick-member" class="input"><option value="">¿Quién? —</option>${members.map(p => `<option value="${p.id}" ${String(p.id) === String(Store.ui.lastMember || '') ? 'selected' : ''}>${esc(p.name)}</option>`).join('')}</select>` : ''}
            </div>
            <button type="button" class="btn btn-primary w-full mt-3 justify-center" data-action="quick.save" id="quick-save"><i class="fa-solid fa-check"></i> Guardar</button>
            <p class="help mt-2 text-center">¿Más detalles (subcategoría, rubro, repetir)? <a href="#" class="link" data-action="quick.full">Abrir el formulario completo</a></p>`;
    }

    function open() {
        state = { type: (state && state.type) || 'Gasto', amount: '', category: null };
        state.sheet = UI.sheet({ title: 'Registro rápido', icon: 'fa-bolt', html: body(), onClose: () => { state.sheet = null; } });
        setTimeout(() => { const a = document.getElementById('quick-amount'); if (a) a.focus(); }, 30);
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
            TxnForm.prefill({ type: state.type, parent: state.category, description: note, amount });
        },
        'quick.save': () => {
            const amount = Math.round((Number(state.amount) || 0) * 100) / 100;
            if (!(amount > 0)) { UI.toast('Escribe un monto mayor a 0.', 'error'); document.getElementById('quick-amount').focus(); return; }
            const s = Store.state;
            const note = document.getElementById('quick-note').value.trim();
            const date = document.getElementById('quick-date').value || Engine.isoDate(new Date());
            const memberSel = document.getElementById('quick-member');
            const tax = state.type === 'Ingreso' ? s.taxonomy.income : s.taxonomy.expense;
            let cat = state.category;
            let line;
            const rule = note ? Importers.applyRules(s.rules, note) : null;
            if (rule && tax[rule.category]) { cat = rule.category; line = rule.budgetLine; }
            const t = { id: Store.nextId(s.transactions), type: state.type, description: note || cat, store: '', parentCategory: cat, category: (tax[cat] || [])[0] || '', amount, date, paymentType: 'Efectivo', createdAt: new Date().toISOString() };
            if (line && state.type !== 'Ingreso') t.budgetLine = String(line);
            if (memberSel && memberSel.value) { t.memberId = Number(memberSel.value); Store.ui.lastMember = t.memberId; }
            s.transactions.push(t);
            state.sheet.close();
            App.changed({ structural: true, step: true });
            if (!TxnForm.warnIfImported(t)) UI.toast(`${state.type === 'Ingreso' ? '+' : '−'}${money(amount)} en ${cat} registrado.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    });

    // Enter in the amount saves.
    document.addEventListener('keydown', (e) => { if (e.key === 'Enter' && e.target && (e.target.id === 'quick-amount' || e.target.id === 'quick-note')) { e.preventDefault(); UI.$('#quick-save') && UI.$('#quick-save').click(); } });
})();
