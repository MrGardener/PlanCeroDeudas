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

    // Where the rows without details of their own are edited (investments, CDs, property, mortgage).
    function openRow(type, id) {
        if (type === 'account' || type === 'debt') { openDetails(type, id); return; }
        const goto = { holding: ['patrimonio', 'nw-holdings'], poliza: ['futuro/polizas', ''], asset: ['patrimonio', 'asset-registry'], field: ['patrimonio', ''] }[type];
        if (!goto) return;
        App.go(goto[0], goto[1] ? { focus: goto[1] } : {});
        if (type === 'field') { const el = document.querySelector(`[data-input="nw.set"][data-field="${CSS.escape(id)}"]`); if (el) { el.scrollIntoView({ block: 'center' }); el.focus(); } }
    }

    // ------------------------------------------------------------ account details
    // One account (or debt): Activity (12 months of money in and out, and its transactions) and
    // Details (name, type, rate, minimum, due day, credit limit, original balance). A card linked to
    // its debt edits both: the debt is what the snowball uses.
    let det = null;   // { account, debt, tab, sheet }
    const ACCOUNT_TYPES = [{ value: 'corriente', label: 'Checking' }, { value: 'ahorros', label: 'Savings' }, { value: 'efectivo', label: 'Cash' }, { value: 'retiro', label: 'Retirement / investment' }, { value: 'tarjeta', label: 'Credit Card' }];
    const DEBT_TYPES = [{ value: 'tarjeta', label: 'Credit Card' }].concat(LOANS_LIST());
    function LOANS_LIST() { return [{ value: 'vehicular', label: 'Auto loan' }, { value: 'personal', label: 'Personal loan' }, { value: 'estudiantil', label: 'Student loan' }, { value: 'otra', label: 'Other debt' }]; }

    function resolve(type, id) {
        const s = Store.state;
        if (type === 'account') {
            const account = (s.accounts || []).find(a => a.id === id);
            const debt = account && account.kind === 'tarjeta' && account.debtId ? (s.debts || []).find(d => d.id === account.debtId) : null;
            return account ? { account, debt } : null;
        }
        const debt = (s.debts || []).find(d => d.id === id);
        const account = debt ? (s.accounts || []).find(a => a.kind === 'tarjeta' && a.debtId === debt.id) : null;
        return debt ? { account: account || null, debt } : null;
    }
    const owedKind = (d) => !!d.debt || (d.account && d.account.kind === 'tarjeta');
    const balanceOf = (d) => d.debt ? Number(d.debt.balance) || 0 : d.account.kind === 'tarjeta' ? Math.max(0, -(Number(d.account.balance) || 0)) : Number(d.account.balance) || 0;
    const nameOf = (d) => (d.account ? d.account.name : d.debt.name) || '';
    const typeLabel = (d) => d.account && !d.debt ? (ACCOUNT_TYPES.find(t => t.value === d.account.kind) || ACCOUNT_TYPES[0]).label : (DEBT_TYPES.find(t => t.value === d.debt.kind) || DEBT_TYPES[0]).label;

    function openDetails(type, id) {
        const d = resolve(type, id);
        if (!d) return;
        det = Object.assign(d, { tab: 'activity' });
        det.sheet = UI.sheet({ title: 'Account details', icon: 'fa-building-columns', wide: true, html: '<div id="acd-body"></div>', onClose: () => { det = null; } });
        drawDetails();
    }

    function drawDetails() {
        if (!det) return;
        const host = document.getElementById('acd-body');
        if (!host) return;
        const owed = owedKind(det), bal = balanceOf(det);
        const field = (f, label, value, opts = {}) => `<label class="acd-field"><span>${label}</span>${opts.select
            ? `<select class="input" data-change="acd.set" data-field="${f}">${Views.selectOptions(opts.select, value)}</select>`
            : `<input class="input" ${opts.number ? 'type="number" inputmode="decimal" step="any" min="0"' : ''} ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''} value="${esc(value === undefined || value === null || value === '' ? '' : String(value))}" data-change="acd.set" data-field="${f}">`}</label>`;
        const src = det.debt || det.account;
        const card = owed && (!det.debt || det.debt.kind === 'tarjeta');
        const details = `<div class="acd-fields">
            ${field('name', 'Account name', nameOf(det), {})}
            ${field('kind', 'Account type', det.account && !det.debt ? det.account.kind : det.debt.kind, { select: det.account && !det.debt ? ACCOUNT_TYPES : DEBT_TYPES })}
            ${field('balance', owed ? 'What you owe' : 'Balance', Math.round(bal * 100) / 100, { number: true })}
            ${field('rate', owed ? 'Interest rate (APR %)' : 'Interest rate (APY %)', src.rate, { number: true })}
            ${owed ? field('minPayment', 'Minimum payment', src.minPayment, { number: true }) + field('dueDay', 'Payment due day', src.dueDay, { number: true, ph: 'Day of the month (1–31)' }) : ''}
            ${card ? field('creditLimit', 'Credit limit', (det.account || det.debt).creditLimit, { number: true }) : ''}
            ${owed ? field('originalBalance', 'Original balance', src.originalBalance, { number: true }) : ''}
        </div>
        ${det.account && det.account.kind === 'tarjeta' && !det.debt ? '<p class="help mt-3">This card isn\'t in your debt plan yet. <button type="button" class="link" data-action="acd.toDebt">Add it to my debts</button> so the snowball pays it off.</p>' : ''}
        ${det.debt ? '<p class="help mt-3">Changes here are the same debt your snowball plan uses.</p>' : ''}`;
        let activity = '<p class="help">This account has no transactions yet. Import a statement into it, or pick it when you log one.</p>';
        const acctId = det.account ? det.account.id : null;
        const a = Engine.accountActivity(Store.state.transactions, acctId, { end: new Date(), months: 12 });
        if (a.txns.length) {
            const shown = a.txns.slice(0, 50);
            activity = `<div class="chart-box"><canvas id="acd-chart" aria-label="Money out and money in, month by month"></canvas></div>
                <div class="acd-txns mt-3">${shown.map(t => { const inn = (t.type || 'Gasto') === 'Ingreso' || t.refund || (t.type === 'Transferencia' && Number(t.signed) > 0);
                    return `<div class="acd-txn"><span class="text-xs text-slate-500 whitespace-nowrap">${esc(Fmt.dayMonth(new Date(t.date + 'T00:00:00')))}</span><span class="min-w-0"><span class="block truncate font-semibold" data-i18n-skip>${esc(t.description || '—')}</span><span class="block truncate text-[11px] text-slate-500">${esc(I18n.t(t.category || t.parentCategory || ''))}</span></span><span class="font-semibold whitespace-nowrap ${inn ? 'text-emerald-700' : ''}">${inn ? '+ ' : ''}${money(Math.abs(Number(t.amount) || 0))}</span></div>`; }).join('')}</div>
                ${a.txns.length > shown.length ? `<p class="help mt-1">The 50 most recent of ${a.txns.length}.</p>` : ''}`;
        }
        host.innerHTML = `<div class="acd-head"><span class="hub-logo hub-${owed ? 'card' : 'checking'}" aria-hidden="true">${esc(initials(nameOf(det)))}</span>
                <div class="min-w-0 flex-1"><div class="font-bold truncate" data-i18n-skip>${esc(nameOf(det))}</div><div class="text-xs text-slate-500">${esc(I18n.t(typeLabel(det)))}</div></div>
                <div class="acd-bal ${owed && bal > 0 ? 'text-red-600' : ''}">${money(bal)}</div></div>
            <div class="segmented my-3" role="tablist"><button type="button" role="tab" data-action="acd.tab" data-tab="activity" class="${det.tab === 'activity' ? 'active' : ''}">Activity</button><button type="button" role="tab" data-action="acd.tab" data-tab="details" class="${det.tab === 'details' ? 'active' : ''}">Details</button></div>
            <div>${det.tab === 'activity' ? activity : details}</div>`;
        if (det.tab === 'activity' && a.txns.length) {
            const pal = UI.palette();
            UI.chart('acd-chart', {
                type: 'bar',
                data: { labels: a.months.map(k => `${Fmt.MONTH_SHORT[Number(k.slice(5)) - 1]} ${k.slice(2, 4)}`), datasets: [
                    { label: 'Money out', data: a.out.map(v => Math.round(v * 100) / 100), backgroundColor: pal.series[0], borderRadius: 4 },
                    { label: 'Money in', data: a.in.map(v => Math.round(v * 100) / 100), backgroundColor: pal.muted, borderRadius: 4 }] },
                options: { plugins: { legend: { position: 'top', align: 'start' } } }
            });
        }
    }

    function setField(el) {
        if (!det) return;
        const f = el.dataset.field, num = Math.max(0, Fmt.parseNum(el.value, 0));
        const { account, debt } = det;
        if (f === 'name') { const v = el.value.trim().slice(0, 40); if (!v) return; if (account) account.name = v; else debt.name = v; }
        else if (f === 'kind') { if (account && !debt) account.kind = el.value; else debt.kind = el.value; }
        else if (f === 'balance') {
            if (debt) { debt.balance = num; if (num > (Number(debt.originalBalance) || 0)) debt.originalBalance = num; }
            if (account) { account.balance = account.kind === 'tarjeta' ? -num : Fmt.parseNum(el.value, 0); account.updatedAt = Engine.isoDate(new Date()); }
        } else if (f === 'creditLimit') { (account || debt).creditLimit = num; }
        else if (f === 'dueDay') { const day = Math.round(num); const t = debt || account; if (day >= 1 && day <= 31) t.dueDay = day; else delete t.dueDay; }
        else {
            const t = debt || account;
            // A budgeted amount that was just the minimum keeps following it (as in Debts).
            if (f === 'minPayment' && debt && Math.abs((Number(debt.monthly) || 0) - (Number(debt.minPayment) || 0)) < 0.005) debt.monthly = num;
            t[f] = num;
        }
        App.changed({ structural: f === 'kind' || f === 'name' });
        drawDetails();
    }

    // An unlinked card becomes a debt in the plan, linked to the account.
    function toDebt() {
        if (!det || !det.account || det.debt) return;
        const a = det.account, s = Store.state, owed = Math.max(0, -(Number(a.balance) || 0));
        App.undoable(`"${a.name}" added to your debts`, () => {
            const debts = s.debts || (s.debts = []);
            const min = Number(a.minPayment) || Math.max(25, Math.round(owed * 0.02));
            const d = { id: Store.nextId(debts), name: a.name, kind: 'tarjeta', balance: owed, originalBalance: Math.max(owed, Number(a.originalBalance) || 0), rate: Number(a.rate) || 0, minPayment: min, monthly: min, createdYear: new Date().getFullYear() };
            if (a.dueDay) d.dueDay = a.dueDay;
            debts.push(d);
            a.debtId = d.id;
            det.debt = d;
        });
        drawDetails();
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
        'hub.save': () => save(),
        'acd.tab': (el) => { if (det) { det.tab = el.dataset.tab === 'details' ? 'details' : 'activity'; drawDetails(); } },
        'acd.set': (el) => setField(el),
        'acd.toDebt': () => toDebt()
    });

    window.AccountsHub = { update, openDetails, get last() { return hub; } };
})();
