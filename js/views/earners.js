/*
 * Income & Taxes → "Other paychecks in the household" (US): anyone else who works enters their pay
 * before taxes (a salary or by the hour, with their pre-tax 401(k) and health deductions) and the
 * app figures their taxes with the main paycheck's (Engine.payrollUS: one return when filing
 * jointly). Each paycheck is an income line with `pay`; the budget counts its take-home.
 */
(function () {
    'use strict';
    const { money, esc, parseNum } = Fmt;
    const MEMBER_COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#4a3aa7', '#e34948'];

    const lines = () => (Store.active().otherIncomes || []);
    const payLine = (id) => lines().find(l => l.id === Number(id) && l.pay);
    const ded = (pay, kind) => (pay.payDeductions || []).find(d => d.kind === kind);
    const dedAmount = (pay, kind) => Number((ded(pay, kind) || {}).monthly) || 0;
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
        const rows = (e, gross) => [
            ['Pay before taxes', money(gross), 'text-slate-900'],
            e.pretaxM > 0 ? ['Pre-tax deductions (401(k), health…)', '−' + money(e.pretaxM), 'text-blue-700'] : null,
            ['Federal income tax', '−' + money(e.fedM), 'text-red-600'],
            ['Social Security and Medicare', '−' + money(e.ficaM), 'text-red-600'],
            ['State income tax', '−' + money(e.stateM), 'text-red-600'],
            e.localM > 0 ? ['City tax', '−' + money(e.localM), 'text-red-600'] : null
        ].filter(Boolean).map(([k, v, c]) => `<div class="flex justify-between py-1"><dt class="text-slate-600">${k}</dt><dd class="font-bold whitespace-nowrap ${c}">${v}</dd></div>`).join('');
        host.innerHTML = `<p class="help mb-3">${p.household && p.household.joint
            ? '<i class="fa-solid fa-people-roof text-emerald-600"></i> Married filing jointly: federal and state tax are figured on your combined pay (one return), then shared by each one\'s wages. Social Security, Medicare and city tax are per person.'
            : '<i class="fa-solid fa-user text-slate-500"></i> Each paycheck is taxed on its own (the others as single). Filing jointly? Change the filing status above.'}</p>
            ${pays.map(l => {
                const e = (p.earners || []).find(x => x.id === l.id) || {};
                const pay = l.pay, hourly = pay.payType === 'hourly', h = pay.hourly || {};
                return `<div class="panel tone-slate mb-3" data-earner="${l.id}">
                    <div class="flex items-center justify-between gap-2 mb-2"><strong data-i18n-skip>${esc(nameOf(l))}</strong>
                        <button type="button" class="row-del" data-action="earner.remove" data-id="${l.id}" aria-label="Remove this paycheck" title="Remove this paycheck"><i class="fa-solid fa-trash-can"></i></button></div>
                    <div class="grid grid-cols-2 sm:grid-cols-4 gap-2">
                        <label class="field"><span class="field-label">Paid</span><select class="input" data-change="earner.set" data-id="${l.id}" data-f="payType"><option value="salary" ${hourly ? '' : 'selected'}>A salary</option><option value="hourly" ${hourly ? 'selected' : ''}>By the hour</option></select></label>
                        ${hourly ? `<label class="field"><span class="field-label">Per hour</span><input type="number" class="input" min="0" step="0.25" inputmode="decimal" value="${Number(h.rate) || 0}" data-change="earner.set" data-id="${l.id}" data-f="rate"></label>
                            <label class="field"><span class="field-label">Hours a week</span><input type="number" class="input" min="0" max="100" step="1" inputmode="decimal" value="${Number(h.hours) || 0}" data-change="earner.set" data-id="${l.id}" data-f="hours"></label>`
                            : `<label class="field"><span class="field-label">Pay before taxes, a month</span><input type="number" class="input" min="0" step="50" inputmode="decimal" value="${Number(pay.sueldo) || 0}" data-change="earner.set" data-id="${l.id}" data-f="gross"></label>`}
                        <label class="field"><span class="field-label">401(k) / 403(b) a month</span><input type="number" class="input" min="0" step="10" inputmode="decimal" value="${dedAmount(pay, 'retirement')}" data-change="earner.set" data-id="${l.id}" data-f="retirement"></label>
                        <label class="field"><span class="field-label">Health, dental, vision, HSA a month</span><input type="number" class="input" min="0" step="10" inputmode="decimal" value="${dedAmount(pay, 'health')}" data-change="earner.set" data-id="${l.id}" data-f="health"></label>
                    </div>
                    ${city ? `<label class="check mt-2"><input type="checkbox" data-change="earner.set" data-id="${l.id}" data-f="localResident" ${pay.localResident === false ? '' : 'checked'}><span>Lives in the city <span class="block text-[11px] font-normal text-slate-500">If they only work there, the non-resident rate (half).</span></span></label>` : ''}
                    <dl class="text-xs divide-y divide-slate-100 mt-2">${rows(e, e.sueldo || 0)}</dl>
                    <div class="flex justify-between items-center mt-2"><span class="text-sm font-semibold">Take-home a month</span><span class="text-lg font-extrabold text-emerald-700">${money(e.netoM || 0)}</span></div>
                    <p class="help mt-1">Pre-tax deductions are taken out of the take-home too; the budget counts what reaches the bank.</p>
                </div>`;
            }).join('')}
            ${typed.map(l => `<div class="panel tone-amber mb-3"><p class="text-sm"><strong data-i18n-skip>${esc(nameOf(l))}</strong>: <span>typed as take-home,</span> <strong>${money(l.amount)}</strong> <span>a month, with no taxes figured.</span></p>
                <button type="button" class="btn btn-secondary btn-sm mt-2" data-action="earner.convert" data-id="${l.id}"><i class="fa-solid fa-calculator"></i> Enter it before taxes instead</button></div>`).join('')}
            <div class="flex flex-wrap gap-2">${free.map(m => `<button type="button" class="btn btn-secondary btn-sm" data-action="earner.add" data-member="${m.id}"><i class="fa-solid fa-plus"></i> <span>Paycheck for</span> <span data-i18n-skip>${esc(m.name)}</span></button>`).join('')}
                <button type="button" class="btn btn-secondary btn-sm" data-action="earner.add"><i class="fa-solid fa-user-plus"></i> Another person's paycheck</button></div>`;
    }

    function newPayLine(member, sueldo) {
        const list = Store.active().otherIncomes || (Store.active().otherIncomes = []);
        const line = { id: Store.nextId(list), name: `${member.name} (${I18n.t('paycheck')})`.slice(0, 60), amount: 0, category: 'Ingresos Laborales', memberId: member.id,
            pay: { payType: 'salary', sueldo: Math.max(0, Number(sueldo) || 0), hourly: { rate: 0, hours: 40 }, payDeductions: [] } };
        list.push(line);
        return line;
    }
    // The line's stored amount follows its take-home (what other screens read straight from it).
    function syncAmounts() {
        const eff = Store.effective(Store.state.activeYear);
        (Store.active().otherIncomes || []).forEach(l => { if (!l.pay) return; const e = (eff.otherIncomes || []).find(x => x.id === l.id); if (e) l.amount = e.amount; });
    }
    function setDeduction(pay, kind, monthly) {
        const list = pay.payDeductions || (pay.payDeductions = []);
        const names = { retirement: '401(k) / 403(b)', health: 'Health, dental, vision, HSA' };
        const groups = { retirement: 'retirement', health: 'insurance' };
        let d = list.find(x => x.kind === kind);
        if (!(monthly > 0)) { pay.payDeductions = list.filter(x => x !== d); return; }
        if (!d) { d = { id: list.length ? Math.max(...list.map(x => Number(x.id) || 0)) + 1 : 1, name: names[kind], group: groups[kind], kind, pretax: true }; list.push(d); }
        d.monthly = monthly;
    }

    UI.register({
        'earner.add': async (el) => {
            const s = Store.state;
            let member = (s.members || []).find(m => m.id === Number(el.dataset.member));
            if (!member) {
                const r = await UI.form({ title: 'Another person\'s paycheck', fields: [{ name: 'name', label: 'Name', placeholder: 'E.g. Luis' }, { name: 'gross', label: 'Pay before taxes, a month', type: 'number', inputmode: 'decimal' }],
                    confirmText: 'Add', validate: v => !v.name.trim() ? 'Type a name.' : !(v.gross >= 0) ? 'Type the pay (0 is fine for now).' : null });
                if (!r) return;
                App.undoable('Paycheck added', () => {
                    const list = s.members || (s.members = []);
                    const used = new Set(list.map(p => p.color));
                    member = { id: Store.nextId(list), name: r.name.trim().slice(0, 30), color: MEMBER_COLORS.find(c => !used.has(c)) || MEMBER_COLORS[list.length % MEMBER_COLORS.length] };
                    list.push(member);
                    newPayLine(member, Math.min(10000000, r.gross || 0));
                    syncAmounts();
                });
                return;
            }
            App.undoable('Paycheck added', () => { newPayLine(member, 0); syncAmounts(); });
        },
        'earner.set': (el) => {
            const l = payLine(el.dataset.id);
            if (!l) return;
            const pay = l.pay, f = el.dataset.f, v = Math.min(10000000, Math.max(0, parseNum(el.value, 0)));
            if (f === 'payType') {
                pay.payType = el.value === 'hourly' ? 'hourly' : 'salary';
                pay.hourly = Object.assign({ rate: 0, hours: 40 }, pay.hourly || {});
            } else if (f === 'gross') pay.sueldo = v;
            else if (f === 'rate') pay.hourly = Object.assign({ hours: 40 }, pay.hourly || {}, { rate: v });
            else if (f === 'hours') pay.hourly = Object.assign({ rate: 0 }, pay.hourly || {}, { hours: Math.min(168, v) });
            else if (f === 'retirement' || f === 'health') setDeduction(pay, f, v);
            else if (f === 'localResident') pay.localResident = !!el.checked;
            // Hourly pay keeps a monthly figure too (other screens and old versions read sueldo).
            if (pay.payType === 'hourly') pay.sueldo = Math.round(Engine.usGrossPay(Object.assign({}, pay, { bonuses: [] })).baseM * 100) / 100;
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
                l.pay = { payType: 'salary', sueldo: Math.round((Number(l.amount) || 0) / (1 - rate) / 50) * 50, hourly: { rate: 0, hours: 40 }, payDeductions: [] };
                syncAmounts();
            });
            UI.toast('Started from an estimate: correct the pay before taxes with the pay stub.');
        }
    });

    window.Earners = { render, syncAmounts };
})();
