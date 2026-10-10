/*
 * Income & Taxes → "Other paychecks in the household" (US): anyone else who works enters their pay
 * before taxes with the same editor as the main paycheck (payedit.js: a yearly salary or by the
 * hour, how often, overtime, each deduction by type) and the app figures their taxes with the main
 * paycheck's (Engine.payrollUS: one return when filing jointly). Each paycheck is an income line
 * with `pay`; the budget counts its take-home.
 */
(function () {
    'use strict';
    const { money, esc, parseNum } = Fmt;
    const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

    const lines = () => (Store.active().otherIncomes || []);
    const payLine = (id) => lines().find(l => l.id === Number(id) && l.pay);
    // The household's first person is the main earner (the setup guide puts them there).
    const mainEarner = (s) => (s.members || [])[0] || null;

    function render(ctx) {
        const host = document.getElementById('inc-earners');
        if (!host) return;
        const s = ctx.state, p = ctx.pay, people = s.members || [], main = mainEarner(s);
        const pays = (ctx.year.otherIncomes || []).filter(l => l.pay);
        const typed = (ctx.year.otherIncomes || []).filter(l => !l.pay && l.memberId && l.memberId !== (main && main.id) && l.category === 'Ingresos Laborales');
        const taken = new Set(pays.concat(typed).map(l => l.memberId));
        const free = people.filter(m => m !== main && !taken.has(m.id));
        const nameOf = (l) => { const m = people.find(x => x.id === l.memberId); return m ? m.name : l.name; };
        const city = !!(ctx.year.localName || Number(ctx.year.localRate) > 0);
        // Per paycheck and a month (payedit.js), like the main paycheck's breakdown.
        const rows = (e) => [
            ['Pay before taxes', e.sueldo || 0, 'text-slate-900'],
            e.pretaxM > 0 ? ['Pre-tax deductions (traditional 401(k), health insurance, FSA, HSA…)', -e.pretaxM, 'text-blue-700'] : null,
            ['Federal income tax', -e.fedM, 'text-red-600'],
            ['Social Security and Medicare', -e.ficaM, 'text-red-600'],
            ['State income tax', -e.stateM, 'text-red-600'],
            e.localM > 0 ? ['City tax', -e.localM, 'text-red-600'] : null,
            e.otrosDescuentosM - e.pretaxM > 0.004 ? ['After-tax deductions (Roth 401(k), life and disability insurance…)', -(e.otrosDescuentosM - e.pretaxM), 'text-red-600'] : null,
            ['Take-home pay', e.netoM || 0, 'text-emerald-700']
        ].filter(Boolean);
        host.innerHTML = `<p class="help mb-3">${p.household && p.household.joint
            ? '<i class="fa-solid fa-people-roof text-emerald-600"></i> Married filing jointly: federal and state tax are figured on your combined pay (one return), then shared by each one\'s wages. Social Security, Medicare and city tax are per person.'
            : '<i class="fa-solid fa-user text-slate-500"></i> Each paycheck is taxed on its own (the others as single). Filing jointly? Change the filing status above.'}</p>
            ${pays.map(l => {
                const e = (p.earners || []).find(x => x.id === l.id) || {};
                const pay = l.pay;
                return `<div class="panel tone-slate mb-3 space-y-3" data-earner="${l.id}">
                    <div class="flex items-center justify-between gap-2"><strong data-i18n-skip>${esc(nameOf(l))}</strong>
                        <button type="button" class="row-del" data-action="earner.remove" data-id="${l.id}" aria-label="Remove this paycheck" title="Remove this paycheck"><i class="fa-solid fa-trash-can"></i></button></div>
                    ${PayEdit.fields(l.id)}
                    ${city ? `<label class="check"><input type="checkbox" data-change="earner.set" data-id="${l.id}" data-f="localResident" ${pay.localResident === false ? '' : 'checked'}><span>Lives in the city <span class="block text-[11px] font-normal text-slate-500">If they only work there, the non-resident rate (half).</span></span></label>` : ''}
                    <div><span class="field-label">Paycheck deductions</span>${PayEdit.table(l.id)}</div>
                    <div class="table-wrap">${PayEdit.breakdown(rows(e), e.ppy || 26)}</div>
                    <p class="help">Taxes are figured on the whole year; the budget counts the take-home that reaches the bank.${e.groupLifeY > 0 ? ` <span>${groupLifeNote(e.groupLifeY)}</span>` : ''}</p>
                    ${pay.lastPaystub && window.PayScan ? `<p class="help">${PayScan.lastNote(pay.lastPaystub, e.netoM || 0)}</p>` : ''}
                </div>`;
            }).join('')}
            ${typed.map(l => `<div class="panel tone-amber mb-3"><p class="text-sm"><strong data-i18n-skip>${esc(nameOf(l))}</strong>: <span>typed as take-home,</span> <strong>${money(l.amount)}</strong> <span>a month, with no taxes figured.</span></p>
                <button type="button" class="btn btn-secondary btn-sm mt-2" data-action="earner.convert" data-id="${l.id}"><i class="fa-solid fa-calculator"></i> Enter it before taxes instead</button></div>`).join('')}
            <div class="flex flex-wrap gap-2">${free.map(m => `<button type="button" class="btn btn-secondary btn-sm" data-action="earner.add" data-member="${m.id}"><i class="fa-solid fa-plus"></i> <span>Paycheck for</span> <span data-i18n-skip>${esc(m.name)}</span></button>`).join('')}
                <button type="button" class="btn btn-secondary btn-sm" data-action="earner.add"><i class="fa-solid fa-user-plus"></i> Another person's paycheck</button></div>`;
    }

    // Group-term life over $50,000 in the taxes (not in the pay).
    const groupLifeNote = (y) => `Taxes include ${money(y)} a year of group-term life over $50,000 (taxed as pay, not paid).`;

    function newPayLine(member, sueldo) {
        const list = Store.active().otherIncomes || (Store.active().otherIncomes = []);
        const line = { id: Store.nextId(list), name: `${member.name} (${I18n.t('paycheck')})`.slice(0, 60), amount: 0, category: 'Ingresos Laborales', memberId: member.id,
            pay: { payType: 'salary', sueldo: Math.max(0, Number(sueldo) || 0), paysPerYear: 26, hourly: { rate: 0, hours: 40, otRate: 1.5 }, payDeductions: [] } };
        list.push(line);
        return line;
    }
    // The line's stored amount follows its take-home (what other screens read straight from it).
    function syncAmounts() {
        const eff = Store.effective(Store.state.activeYear);
        (Store.active().otherIncomes || []).forEach(l => { if (!l.pay) return; const e = (eff.otherIncomes || []).find(x => x.id === l.id); if (e) l.amount = e.amount; });
    }
    UI.register({
        'earner.add': async (el) => {
            const s = Store.state;
            let member = (s.members || []).find(m => m.id === Number(el.dataset.member));
            if (!member) {
                const r = await UI.form({ title: 'Another person\'s paycheck', fields: [{ name: 'name', label: 'Name', placeholder: 'E.g. Luis' }, { name: 'gross', label: 'Yearly salary before taxes', type: 'number', inputmode: 'decimal' }],
                    confirmText: 'Add', validate: v => !v.name.trim() ? 'Type a name.' : !(v.gross >= 0) ? 'Type the pay (0 is fine for now).' : null });
                if (!r) return;
                App.undoable('Paycheck added', () => {
                    const list = s.members || (s.members = []);
                    const used = new Set(list.map(p => p.color));
                    member = { id: Store.nextId(list), name: r.name.trim().slice(0, 30), color: MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[list.length % MEMBER_COLORS.length] };
                    list.push(member);
                    newPayLine(member, Math.min(1e8, r.gross || 0) / 12);
                    syncAmounts();
                });
                return;
            }
            App.undoable('Paycheck added', () => { newPayLine(member, 0); syncAmounts(); });
        },
        'earner.set': (el) => {
            const l = payLine(el.dataset.id);
            if (!l) return;
            if (el.dataset.f === 'localResident') l.pay.localResident = !!el.checked;
            syncAmounts();
            App.changed({ structural: true });
        },
        'earner.remove': (el) => {
            const l = payLine(el.dataset.id);
            if (!l) return;
            App.undoable('Paycheck removed', () => { Store.active().otherIncomes = lines().filter(x => x !== l); });
        },
        // A take-home typed earlier: start from an estimate of the pay before taxes (at the main
        // paycheck's average tax rate), to be corrected with the pay stub.
        'earner.convert': (el) => {
            const l = lines().find(x => x.id === Number(el.dataset.id) && !x.pay);
            if (!l) return;
            const rate = Math.min(0.5, Math.max(0, App.buildContext().pay.avgTaxRate || 0.2));
            App.undoable('Paycheck entered before taxes', () => {
                l.pay = { payType: 'salary', sueldo: Math.round((Number(l.amount) || 0) / (1 - rate) / 50) * 50, paysPerYear: 26, hourly: { rate: 0, hours: 40, otRate: 1.5 }, payDeductions: [] };
                syncAmounts();
            });
            UI.toast('Started from an estimate: correct the pay before taxes with the pay stub.');
        }
    });

    window.Earners = { render, syncAmounts, groupLifeNote };
})();
