/* Transactions → tap one: its details, like the bank's. Payee (with the bank's original text under
   it), date, category (a picker with search, grouped, "+ Add subcategory"), tags and memo; the "…"
   menu flags it, excludes it or splits it. Excluded transactions move to state.excludedTxns (like
   the trash): kept and searchable, but no budget, report or total sees them until included again. */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    let sheet = null, txnId = null, menuOpen = false, view = 'details';

    const find = (id) => Store.state.transactions.find(t => t.id === id) || (Store.state.excludedTxns || []).find(t => t.id === id);
    const isExcluded = (t) => (Store.state.excludedTxns || []).includes(t);
    const taxonomyOf = (t) => ((t.type || 'Gasto') === 'Ingreso' ? Store.state.taxonomy.income : Store.state.taxonomy.expense) || {};
    const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';

    // opts.back: where the ← at the top returns (the list it was opened from).
    let backTo = null;
    function open(id, opts = {}) {
        const t = find(id);
        if (!t) return;
        txnId = id; menuOpen = false; view = 'details'; backTo = opts.back || null;
        sheet = UI.sheet({ title: 'Transaction details', icon: 'fa-receipt', html: '<div id="tdt-body"></div>', onClose: () => { sheet = null; txnId = null; } });
        draw();
    }

    function draw() {
        const host = document.getElementById('tdt-body');
        const t = txnId !== null && find(txnId);
        if (!host || !t) return;
        if (view === 'category') { drawCategoryView(host); return; }
        const type = t.type || 'Gasto', tr = type === 'Transferencia', inc = type === 'Ingreso' || t.refund;
        const acct = t.accountId && (Store.state.accounts || []).find(a => a.id === t.accountId);
        const cat = tr ? I18n.t('Transfer') : `${I18n.t(t.parentCategory || '')}${t.category ? ' › ' + I18n.t(t.category) : ''}`;
        const ex = isExcluded(t);
        host.innerHTML = `${backTo ? '<button type="button" class="link text-sm mb-2" data-action="tdt.backTo"><i class="fa-solid fa-arrow-left"></i> Back</button>' : ''}
            <div class="acd-head">
                <span class="hub-logo" aria-hidden="true">${esc(initials(t.description))}</span>
                <div class="min-w-0 flex-1"><div class="font-bold truncate" data-i18n-skip>${esc(t.description || '—')}</div><div class="text-xs text-slate-500" data-i18n-skip>${esc(acct ? acct.name : I18n.t(t.paymentType || ''))}</div></div>
                <div class="acd-bal ${inc ? 'text-emerald-700' : ''}">${inc ? '+' : ''}${money(Math.abs(Number(t.amount) || 0))}</div>
                <div class="relative"><button type="button" class="icon-btn icon-btn-light" data-action="tdt.menu" aria-label="More" aria-expanded="${menuOpen}"><i class="fa-solid fa-ellipsis"></i></button>
                    ${menuOpen ? `<div class="tdt-menu" role="menu">
                        <button type="button" role="menuitem" data-action="tdt.flag"><i class="fa-${t.flagged ? 'solid' : 'regular'} fa-flag"></i> ${t.flagged ? 'Remove flag' : 'Flag'}</button>
                        <button type="button" role="menuitem" data-action="tdt.exclude"><i class="fa-solid fa-ban"></i> ${ex ? 'Include again' : 'Exclude'}</button>
                        ${type === 'Gasto' && !ex ? '<button type="button" role="menuitem" data-action="tdt.split"><i class="fa-solid fa-code-branch"></i> Split</button>' : ''}
                    </div>` : ''}</div>
            </div>
            ${ex ? '<div class="bs-banner warn mt-3"><i class="fa-solid fa-ban"></i> Excluded: it doesn\'t count in budgets, reports or totals.</div>' : ''}
            ${t.flagged ? '<div class="text-xs text-amber-700 mt-2"><i class="fa-solid fa-flag"></i> Flagged</div>' : ''}
            <div class="acd-fields mt-3">
                <label class="acd-field"><span>Payee</span><span><input class="input" value="${esc(t.description || '')}" data-change="tdt.set" data-field="description" maxlength="120">
                    ${t.original && t.original !== t.description ? `<span class="block text-[11px] text-slate-500 mt-1">On the statement: <span data-i18n-skip>${esc(t.original)}</span></span>` : ''}</span></label>
                <label class="acd-field"><span>Date</span><input type="date" class="input" value="${esc(t.date)}" data-change="tdt.set" data-field="date"></label>
                <div class="acd-field"><span>Category</span>${tr ? `<span>${esc(cat)}</span>` : `<button type="button" class="input text-left" data-action="tdt.category"><span data-i18n-skip>${esc(cat)}</span> <i class="fa-solid fa-pen text-[10px] text-slate-400"></i></button>`}</div>
                <div class="acd-field"><span>Tags</span><span class="flex flex-wrap items-center gap-1">${(t.tags || []).map(g => `<span class="tag-chip" data-i18n-skip>#${esc(g)} <button type="button" data-action="tdt.untag" data-tag="${esc(g)}" aria-label="Remove tag">×</button></span>`).join('')}
                    <input class="input" style="max-width:9rem" placeholder="+ tag" data-change="tdt.tag" aria-label="Add a tag"></span></div>
                <label class="acd-field"><span>Memo</span><input class="input" value="${esc(t.memo || '')}" placeholder="Add a memo" maxlength="200" data-change="tdt.set" data-field="memo"></label>
            </div>`;
    }

    // Category picker (inside the same sheet: one sheet at a time): search, categories with their
    // subcategories, "+ Add subcategory". Back returns to the details.
    let catOpen = null;
    function pickCategory() {
        const t = find(txnId);
        if (!t) return;
        catOpen = t.parentCategory || null;
        view = 'category';
        draw();
    }
    function drawCategoryView(host) {
        // The ← and the search stay at the top while the categories scroll under them.
        host.innerHTML = `<div class="sheet-sticky"><div class="flex items-center gap-2 mb-2"><button type="button" class="icon-btn icon-btn-light" data-action="tdt.back" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong>Select a category</strong></div>
            <input type="search" class="input" id="tdt-cat-q" placeholder="Search for a category" data-input="tdt.catSearch" aria-label="Search for a category"></div><div id="tdt-cats"></div>`;
        drawCats('');
        const m = host.closest('.modal');
        if (m) m.scrollTop = 0;
    }
    function drawCats(q) {
        const t = find(txnId), host = document.getElementById('tdt-cats');
        if (!t || !host) return;
        const tax = taxonomyOf(t), needle = q.trim().toLowerCase();
        const hit = (s) => !needle || I18n.t(s).toLowerCase().includes(needle) || s.toLowerCase().includes(needle);
        host.innerHTML = Object.keys(tax).map(p => {
            const subs = (tax[p] || []).filter(sub => hit(sub) || hit(p));
            if (needle && !subs.length && !hit(p)) return '';
            const openNow = needle || catOpen === p;
            return `<div class="cat-pick">
                <button type="button" class="cat-pick-head" data-action="tdt.catOpen" data-parent="${esc(p)}"><span>${esc(I18n.t(p))}</span><i class="fa-solid ${openNow ? 'fa-minus' : 'fa-plus'} text-slate-400"></i></button>
                ${openNow ? `<div class="cat-pick-subs">
                    <button type="button" data-action="tdt.catSet" data-parent="${esc(p)}" data-sub="">${esc(I18n.t(p))} <span class="text-slate-400">(${esc(I18n.t('no subcategory'))})</span>${t.parentCategory === p && !t.category ? ' <i class="fa-solid fa-circle-check text-emerald-600"></i>' : ''}</button>
                    ${subs.map(sub => `<button type="button" data-action="tdt.catSet" data-parent="${esc(p)}" data-sub="${esc(sub)}">${esc(I18n.t(sub))}${t.parentCategory === p && t.category === sub ? ' <i class="fa-solid fa-circle-check text-emerald-600"></i>' : ''}</button>`).join('')}
                    <button type="button" class="link" data-action="tdt.catAdd" data-parent="${esc(p)}"><i class="fa-solid fa-plus"></i> Add new subcategory</button>
                </div>` : ''}</div>`;
        }).join('') || `<p class="help">${esc(I18n.t('No category matches.'))}</p>`;
    }

    function change(mutate, opts = {}) {
        const t = find(txnId);
        if (!t) return;
        mutate(t);
        App.changed({ structural: true, step: !!opts.step });
        draw();
    }

    UI.register({
        'txn.details': (el) => open(Number(el.dataset.id)),
        'tdt.menu': () => { menuOpen = !menuOpen; draw(); },
        'tdt.set': (el) => {
            const f = el.dataset.field;
            if (f === 'date' && !/^\d{4}-\d\d-\d\d$/.test(el.value)) return;
            if (f === 'description' && !el.value.trim()) return;
            change(t => { t[f] = f === 'memo' ? el.value.trim().slice(0, 200) : el.value.trim().slice(0, 120); if (f === 'memo' && !t.memo) delete t.memo; }, { step: f === 'date' });
        },
        'tdt.tag': (el) => {
            const tags = Engine.parseTags(el.value);
            if (!tags.length) return;
            change(t => { t.tags = [...new Set((t.tags || []).concat(tags))]; });
        },
        'tdt.untag': (el) => change(t => { t.tags = (t.tags || []).filter(g => g !== el.dataset.tag); if (!t.tags.length) delete t.tags; }),
        'tdt.flag': () => { menuOpen = false; change(t => { if (t.flagged) delete t.flagged; else t.flagged = true; }); },
        'tdt.exclude': () => {
            const t = find(txnId);
            if (!t) return;
            menuOpen = false;
            const s = Store.state, ex = isExcluded(t);
            App.undoable(ex ? `"${t.description}" counts again` : `"${t.description}" excluded: it no longer counts`, () => {
                if (ex) { s.excludedTxns = s.excludedTxns.filter(x => x !== t); s.transactions.push(t); }
                else { s.transactions = s.transactions.filter(x => x !== t); (s.excludedTxns || (s.excludedTxns = [])).push(t); }
            });
            draw();
        },
        'tdt.split': () => {
            const id = txnId;
            if (sheet) sheet.close();
            const t = find(id);
            if (t && window.BudgetSimple && BudgetSimple.openSplit) BudgetSimple.openSplit(t);
        },
        'tdt.category': () => pickCategory(),
        'tdt.back': () => { view = 'details'; draw(); },
        'tdt.backTo': () => { const b = backTo; if (sheet) sheet.close(); if (b) b(); },
        'tdt.catSearch': (el) => drawCats(el.value),
        'tdt.catOpen': (el) => {
            catOpen = catOpen === el.dataset.parent ? null : el.dataset.parent;
            drawCats((document.getElementById('tdt-cat-q') || {}).value || '');
            // Bring the opened category and its subcategories into view (a long list on a phone).
            const head = catOpen && [...document.querySelectorAll('#tdt-cats .cat-pick-head')].find(b => b.dataset.parent === catOpen);
            if (head) head.closest('.cat-pick').scrollIntoView({ block: 'nearest', behavior: 'smooth' });
        },
        'tdt.catSet': (el) => {
            const p = el.dataset.parent, sub = el.dataset.sub || '';
            view = 'details';
            // A new category means a new budget line by category (as when editing in the form).
            change(t => { if (t.parentCategory !== p) delete t.budgetLine; t.parentCategory = p; t.category = sub; }, { step: true });
            UI.toast('Category updated.', 'ok');
        },
        'tdt.catAdd': async (el) => {
            const p = el.dataset.parent, t = find(txnId);
            const r = await UI.form({ title: 'Add new subcategory', fields: [{ name: 'name', label: `Subcategory of ${I18n.t(p)}`, value: '' }], confirmText: 'Add' });
            if (!r || !r.name.trim() || !t) return;
            const name = r.name.trim().slice(0, 60), tax = taxonomyOf(t);
            if (!(tax[p] || []).includes(name)) (tax[p] = tax[p] || []).push(name);
            view = 'details';
            change(x => { if (x.parentCategory !== p) delete x.budgetLine; x.parentCategory = p; x.category = name; }, { step: true });
        }
    });

    window.TxnDetails = { open };
})();
