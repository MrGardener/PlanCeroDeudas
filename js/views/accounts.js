/* Net Worth → All accounts: everything you have and owe in one list, by type (Engine.accountsHub),
   like the bank's Accounts page. On the phone the types are chips that jump to their section; on a
   wide screen they're a list on the left. "+ Add an account" adds a manual one of any type. */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    const ICONS = { checking: 'fa-money-check', savings: 'fa-piggy-bank', cash: 'fa-wallet', investment: 'fa-chart-column', property: 'fa-house', card: 'fa-credit-card', mortgage: 'fa-house-chimney', loan: 'fa-file-invoice-dollar' };
    const initials = (name) => String(name || '?').replace(/[^\p{L}\p{N} ]/gu, ' ').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?';
    const SUB = { holding: 'Investment', poliza: 'CD', corriente: 'Checking', ahorros: 'Savings', efectivo: 'Cash', retiro: 'Retirement', tarjeta: 'Credit Card', vehicular: 'Auto loan', personal: 'Personal loan', estudiantil: 'Student loan', otra: 'Other debt', mortgage: 'Mortgage', 'Bienes Raíces': 'Real estate', 'Vehículo': 'Vehicle', 'Otro': 'Other' };
    let hub = null;

    function update(ctx) {
        const host = document.getElementById('hub-body');
        if (!host) return;
        const s = ctx.state, year = ctx.today.getFullYear();
        hub = Engine.accountsHub({ accounts: s.accounts, holdings: s.holdings, polizas: s.polizas, assets: s.assets, debts: s.debts, years: s.years, year });
        const shown = hub.groups.filter(g => g.rows.length);
        const amt = (g, v) => `<span class="${g.owed && v > 0 ? 'text-red-600' : ''}">${money(v)}</span>`;
        const nav = hub.groups.map(g => g.rows.length
            ? `<button type="button" class="hub-type" data-action="hub.jump" data-key="${g.key}"><i class="fa-solid ${ICONS[g.key]}"></i><span><span class="hub-type-name">${esc(g.label)}</span><strong>${amt(g, g.total)}</strong></span></button>`
            : '').join('');
        host.innerHTML = shown.length ? `<div class="hub">
                <nav class="hub-nav" aria-label="Account types">
                    <div class="hub-all"><i class="fa-solid fa-building-columns"></i> All accounts</div>${nav}
                    <div class="hub-sum"><span>Own <strong>${money(hub.assets)}</strong></span><span>Owe <strong class="text-red-600">${money(hub.liabilities)}</strong></span></div>
                </nav>
                <div class="hub-list">${shown.map(g => `<section class="hub-group" id="hub-${g.key}">
                    <header><span>${esc(g.label)}</span>${amt(g, g.total)}</header>
                    ${g.rows.map(r => `<button type="button" class="hub-row" data-action="hub.open" data-type="${r.ref.type}" data-id="${esc(String(r.ref.id))}">
                        <span class="hub-logo hub-${g.key}" aria-hidden="true">${esc(initials(r.name))}</span>
                        <span class="hub-name"><span data-i18n-skip>${esc(r.name)}</span><small>${esc(I18n.t(SUB[r.kind] || g.label))}${r.sub ? ` · <span data-i18n-skip>${esc(r.sub)}</span>` : ''}</small></span>
                        <span class="hub-amt">${amt(g, r.balance)}</span></button>`).join('')}
                </section>`).join('')}</div>
            </div>`
            : `<p class="help">No accounts yet. Add your checking account first: its balance is the start of your cash flow.</p>`;
    }

    // Where each kind of row is edited today (account details come in the next step).
    function openRow(type, id) {
        const goto = { account: ['patrimonio', 'nw-accounts'], holding: ['patrimonio', 'nw-holdings'], poliza: ['futuro/polizas', ''], asset: ['patrimonio', 'asset-registry'], debt: ['futuro/metas', 'metas-debts'], field: ['patrimonio', ''] }[type];
        if (!goto) return;
        App.go(goto[0], goto[1] ? { focus: goto[1] } : {});
        if (type === 'field') { const el = document.querySelector(`[data-input="nw.set"][data-field="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }
    }

    // "+ Add an account": a manual account of any type.
    const TYPES = [
        { value: 'corriente', label: 'Checking' }, { value: 'ahorros', label: 'Savings' }, { value: 'efectivo', label: 'Cash' },
        { value: 'retiro', label: 'Retirement / investment' }, { value: 'tarjeta', label: 'Credit Card' },
        { value: 'property', label: 'Property' }, { value: 'loan', label: 'Loan' }
    ];
    const PROPERTY = [{ value: 'Bienes Raíces', label: 'Real estate' }, { value: 'Vehículo', label: 'Vehicle' }, { value: 'Otro', label: 'Other (art, jewelry…)' }];
    const LOANS = [{ value: 'vehicular', label: 'Auto loan' }, { value: 'personal', label: 'Personal loan' }, { value: 'estudiantil', label: 'Student loan' }, { value: 'otra', label: 'Other debt' }];

    function addSheet() {
        const sheet = UI.sheet({ title: 'Add an account', icon: 'fa-building-columns', html: `
            <p class="help mb-3">Accounts are added by hand and kept up to date by importing your statements: nothing connects to your bank.</p>
            <div class="grid grid-cols-1 gap-3">
                <label class="field"><span class="field-label">Account type</span><select id="hub-new-type" class="input" data-change="hub.newType">${Views.selectOptions(TYPES, 'corriente')}</select></label>
                <label class="field hidden" id="hub-new-sub-f"><span class="field-label" id="hub-new-sub-l">Property type</span><select id="hub-new-sub" class="input"></select></label>
                <label class="field"><span class="field-label">Account name</span><input id="hub-new-name" class="input" maxlength="40" placeholder="E.g. Chase Checking"></label>
                <label class="field"><span class="field-label" id="hub-new-bal-l">Balance today ($)</span><input id="hub-new-bal" class="input" type="number" inputmode="decimal" step="any" min="0"></label>
            </div>
            <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-primary" data-action="hub.save"><i class="fa-regular fa-circle-check"></i> Save</button></div>` });
        addOpen = sheet;
    }
    let addOpen = null;
    function newType() {
        const t = (document.getElementById('hub-new-type') || {}).value;
        const sub = t === 'property' ? PROPERTY : t === 'loan' ? LOANS : null;
        UI.show('hub-new-sub-f', !!sub);
        if (sub) { UI.html('hub-new-sub', Views.selectOptions(sub, sub[0].value)); UI.text('hub-new-sub-l', t === 'property' ? 'Property type' : 'Loan type'); }
        UI.text('hub-new-bal-l', t === 'tarjeta' || t === 'loan' ? 'What you owe today ($)' : t === 'property' ? 'What it\'s worth today ($)' : 'Balance today ($)');
    }
    function save() {
        const t = document.getElementById('hub-new-type').value, sub = document.getElementById('hub-new-sub').value;
        const name = document.getElementById('hub-new-name').value.trim().slice(0, 40), bal = Math.abs(Fmt.parseNum(document.getElementById('hub-new-bal').value, 0));
        if (!name) { UI.toast('Give the account a name.', 'error'); return; }
        const s = Store.state, today = Engine.isoDate(new Date()), year = new Date().getFullYear();
        App.undoable(`Account added: ${name}`, () => {
            if (t === 'property') {
                const list = s.assets || (s.assets = []);
                list.push({ id: Store.nextId(list), name, category: sub || 'Otro', purchaseYear: year, purchaseValue: bal, status: 'Activo', saleValue: 0, saleYear: null, proceedsAdded: false, valuesByYear: {} });
            } else if (t === 'loan') {
                const list = s.debts || (s.debts = []);
                list.push({ id: Store.nextId(list), name, kind: sub || 'personal', balance: bal, originalBalance: bal, rate: 0, minPayment: 0, monthly: 0, createdYear: year });
            } else {
                const list = s.accounts || (s.accounts = []);
                list.push({ id: Store.nextId(list), name, kind: t, balance: t === 'tarjeta' ? -bal : bal, updatedAt: today });
            }
        });
        if (addOpen) { addOpen.close(); addOpen = null; }
    }

    UI.register({
        'hub.jump': (el) => { const g = document.getElementById('hub-' + el.dataset.key); if (g) g.scrollIntoView({ block: 'start', behavior: 'smooth' }); },
        'hub.open': (el) => openRow(el.dataset.type, el.dataset.type === 'field' ? el.dataset.id : Number(el.dataset.id)),
        'hub.add': () => addSheet(),
        'hub.newType': () => newType(),
        'hub.save': () => save()
    });

    window.AccountsHub = { update, get last() { return hub; } };
})();
