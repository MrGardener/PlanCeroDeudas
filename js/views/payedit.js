/*
 * The paycheck editor (US), the same for your paycheck and every other earner's (js/views/earners.js):
 * how they're paid (a yearly salary or by the hour), how often, overtime on a usual paycheck, and
 * each deduction by type — what it does to taxes (Engine.US_DEDUCTIONS) — per paycheck, as a % of
 * pay or a month. Controls carry data-target: "main" (this year's own paycheck) or an income
 * line's id (another member's paycheck, line.pay).
 */
(function () {
    'use strict';
    const { money, esc, parseNum } = Fmt;
    const FREQ = [[52, 'Every week'], [26, 'Every 2 weeks'], [24, 'Twice a month'], [12, 'Once a month']];
    const TAX = {
        retire: ['Lowers income tax', 'badge-ok'],
        sec125: ['Lowers income tax, Social Security and Medicare', 'badge-ok'],
        after: ['After tax', 'badge-muted'],
        employer: ['Paid by the employer', 'badge-info']
    };
    const PER = { check: 'per paycheck', percent: '% of pay', month: 'a month' };
    const round2 = (v) => Math.round(v * 100) / 100;

    // The pay a control edits, and how the engine sees it (the household's settings; the main
    // paycheck with its pay calendar).
    function target(t) {
        const yd = Store.active();
        if (String(t) === 'main') return { pay: yd, line: null };
        const line = (yd.otherIncomes || []).find(l => l.id === Number(t) && l.pay);
        return line ? { pay: line.pay, line } : null;
    }
    function engineView(t) {
        const eff = Store.effective(Store.state.activeYear);
        if (String(t) === 'main') return eff;
        const o = Engine.otherEarners(eff).find(x => x.line.id === Number(t));
        return o ? o.yd : null;
    }
    const attrs = (t) => `data-target="${esc(String(t))}"`;

    // How they're paid, how often, overtime.
    function fields(t) {
        const e = engineView(t);
        if (!e) return '';
        const g = Engine.usGrossPay(e), hourly = g.payType === 'hourly', h = e.hourly || {}, ppy = g.ppy;
        const num = (f, label, value, extra, help, id) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" ${extra} inputmode="decimal" value="${value === '' || value === undefined || value === null ? '' : value}" data-change="payx.set" ${attrs(t)} data-f="${f}"${id ? ` id="${id}"` : ''}>${help ? `<span class="help">${help}</span>` : ''}</label>`;
        const freq = FREQ.some(([n]) => n === ppy) ? FREQ : FREQ.concat([[ppy, `${ppy} a year (your pay calendar)`]]);
        const ot = h.otPerCheck !== undefined && h.otPerCheck !== null && h.otPerCheck !== '' ? h.otPerCheck : hourly && Number(h.otHours) > 0 ? round2(Number(h.otHours) * 52 / ppy) : '';
        const main = String(t) === 'main';
        return `<div class="grid grid-cols-2 lg:grid-cols-4 gap-3">
                <label class="field"><span class="field-label">Pay type</span><select class="input" data-change="payx.set" ${attrs(t)} data-f="payType"><option value="salary" ${hourly ? '' : 'selected'}>A yearly salary</option><option value="hourly" ${hourly ? 'selected' : ''}>By the hour</option></select></label>
                <label class="field"><span class="field-label">How often</span><select class="input" data-change="payx.set" ${attrs(t)} data-f="paysPerYear">${freq.map(([n, l]) => `<option value="${n}" ${n === ppy ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
                ${hourly ? num('rate', 'Per hour ($)', Number(h.rate) || '', 'min="0" step="0.01"', '', main ? 'inc-rate' : '') + num('hours', 'Regular hours a week', Number(h.hours) || 0, 'min="0" max="100" step="0.5"')
                    : num('yearly', 'Yearly salary before taxes ($)', round2(g.baseM * 12) || '', 'min="0" step="500"', '', main ? 'inc-yearly' : '')}
                <div class="field"><span class="field-label">Each paycheck</span><strong class="text-lg">${money(g.baseM * 12 / ppy)}</strong><span class="help">${hourly ? `${money(g.baseM)} a month · ${money(g.baseM * 12)} a year` : `${money(g.baseM)} a month (the year ÷ 12)`}</span></div>
            </div>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 items-start">
                ${num('otPerCheck', 'Overtime hours on a usual paycheck', ot, 'min="0" max="200" step="0.5"', hourly ? '' : 'Only if you get overtime pay (non-exempt).')}
                ${num('otRate', 'Overtime pay (× the hourly rate)', Number(h.otRate) || 1.5, 'min="1" max="3" step="0.1"', 'Usually 1.5 (time and a half).')}
                <label class="check sm:col-span-2"><input type="checkbox" data-change="payx.set" ${attrs(t)} data-f="otInBudget" ${h.otInBudget ? 'checked' : ''}><span>Count overtime in the budget <span class="block text-[11px] font-normal text-slate-500">Dave Ramsey: budget on the pay you can count on, and give overtime a job when it comes. It always counts in taxes.</span></span></label>
            </div>
            ${g.overtimeM > 0 ? `<p class="help"><i class="fa-solid fa-clock text-amber-600"></i> <span>Overtime: ${money(g.overtimeM * 12 / ppy)} a paycheck, ${money(g.overtimeM)} a month,</span> <span>at ${money(g.rate)} an hour.</span>${hourly ? '' : ' <span>(The salary ÷ 2,080 hours.)</span>'} <span>The extra half of time-and-a-half comes off federal taxable income (2025–2028).</span></p>` : ''}`;
    }

    // Deduction types for a select, in their sets (Retirement, Health…).
    function typeOptions(selected) {
        const sets = [];
        Engine.US_DEDUCTIONS.forEach(x => { let s = sets.find(z => z.name === x.set); if (!s) sets.push(s = { name: x.set, list: [] }); s.list.push(x); });
        return sets.map(s => `<optgroup label="${esc(I18n.t(s.name))}">${s.list.map(x => `<option value="${x.type}" ${x.type === selected ? 'selected' : ''}>${esc(I18n.t(x.label))}</option>`).join('')}</optgroup>`).join('');
    }
    const perOf = (d, ty) => (d.per === 'percent' && ty.percent ? 'percent' : d.per === 'check' ? 'check' : 'month');
    const amountOf = (d, per) => (per === 'percent' ? Number(d.percent) || 0 : per === 'check' ? Number(d.perPay) || 0 : Number(d.monthly) || 0);

    // The deductions table's rows. opts.loanLink: a loan can say which debt it pays (your paycheck).
    function rows(t, opts) {
        const e = engineView(t);
        if (!e) return '';
        const list = Engine.resolveDeductions(Object.assign({}, e, { country: 'US' }));
        if (!list.length) return '<tr class="empty-row"><td colspan="6">No deductions besides taxes yet.</td></tr>';
        const debts = Store.state.debts || [];
        return list.map(x => {
            const d = x.d, ty = x.t, per = perOf(d, ty), tax = TAX[ty.tax] || TAX.after;
            // An HSA's yearly limit depends on the health plan it goes with.
            const cover = ty.limit === 'hsa' ? `<select class="cell-input text-xs mt-1" data-change="payx.ded" ${attrs(t)} data-id="${d.id}" data-f="coverage" aria-label="HSA coverage"><option value="family" ${d.coverage === 'self' ? '' : 'selected'}>Family coverage</option><option value="self" ${d.coverage === 'self' ? 'selected' : ''}>Self-only coverage</option></select>` : '';
            const loan = opts && opts.loanLink && ty.group === 'loan'
                ? `<select class="cell-input text-xs mt-1" data-change="ded.debt" data-id="${d.id}" aria-label="Debt it pays"><option value="">Not linked to a debt</option>${debts.map(z => `<option value="${z.id}" ${Number(d.debtId) === Number(z.id) ? 'selected' : ''}>Pays: ${esc(z.name)}</option>`).join('')}</select>` : '';
            return `<tr data-row="${d.id}">
                <td><input class="cell-input font-semibold" style="min-width:8rem" value="${esc(d.name || I18n.t(ty.label))}" data-change="payx.ded" ${attrs(t)} data-id="${d.id}" data-f="name" aria-label="Name" data-i18n-skip></td>
                <td><select class="cell-input text-xs" style="min-width:12rem" data-change="payx.ded" ${attrs(t)} data-id="${d.id}" data-f="type" aria-label="Type">${typeOptions(ty.type)}</select></td>
                <td><div class="flex items-center gap-1"><input type="number" class="cell-input num" style="width:5.5rem" min="0" ${per === 'percent' ? 'max="100" step="0.5"' : 'step="0.01"'} value="${amountOf(d, per)}" data-change="payx.ded" ${attrs(t)} data-id="${d.id}" data-f="amount" aria-label="Amount">
                    <select class="cell-input text-xs" style="width:auto;min-width:7.5rem" data-change="payx.ded" ${attrs(t)} data-id="${d.id}" data-f="per" aria-label="How">${Object.keys(PER).filter(k => k !== 'percent' || ty.percent).map(k => `<option value="${k}" ${k === per ? 'selected' : ''}>${PER[k]}</option>`).join('')}</select></div></td>
                <td class="num whitespace-nowrap">${money(x.monthly)}</td>
                <td><span class="badge ${tax[1]}">${tax[0]}</span>${loan}${cover}</td>
                <td class="text-center"><button type="button" class="row-del" data-action="payx.dedDel" ${attrs(t)} data-id="${d.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`;
        }).join('');
    }
    const HEAD = '<tr><th>Deduction</th><th>Type</th><th>Amount</th><th class="num">A month</th><th>Taxes</th><th></th></tr>';

    // Yearly limits gone over (Engine.deductionLimits); `age` when known (catch-up contributions).
    function limits(t, age) {
        const e = engineView(t);
        if (!e || !e.usTax) return '';
        return Engine.deductionLimits(e, e.usTax, age).map(x => `<div class="bs-banner warn mt-2"><i class="fa-solid fa-triangle-exclamation"></i> <span>${esc(I18n.t(x.label))}:</span> <span>${money(x.amount)} a year, over the ${money(x.limit)} limit.</span></div>`).join('');
    }

    // A table of deductions for another earner (the main one lives in its own card: payscan.js),
    // with their pay stub scan (read on this device, never stored).
    function table(t) {
        const id = `earner-file-${esc(String(t))}`;
        return `<div class="table-wrap mt-2"><table class="table"><thead>${HEAD}</thead><tbody>${rows(t)}</tbody></table></div>
            <div class="flex flex-wrap gap-2 mt-2">
                <label class="btn btn-secondary btn-sm cursor-pointer"><i class="fa-solid fa-camera"></i> Scan their pay stub (PDF or photo)<input type="file" id="${id}" class="hidden" accept="application/pdf,image/*" data-change="ded.file" ${attrs(t)} data-status="earner-status-${esc(String(t))}"></label>
                <button type="button" class="btn btn-secondary btn-sm" data-app-only data-action="cam.photo" data-for="${id}"><i class="fa-solid fa-camera-retro"></i> Take a photo</button>
                <button type="button" class="btn btn-secondary btn-sm" data-action="payx.dedAdd" ${attrs(t)}><i class="fa-solid fa-plus"></i> Add a deduction</button></div>
            <div id="earner-status-${esc(String(t))}" class="text-sm mt-1"></div>${limits(t, null)}${groupLife(t)}`;
    }

    // Life insurance from the employer: coverage over $50,000 is taxed as pay (IRS Table I, by
    // age), not paid (Engine.groupLifeImputed). Or the "GTL" amount on the pay stub.
    function groupLife(t) {
        const e = engineView(t);
        if (!e) return '';
        const gl = e.groupLife || {}, w = Engine.usWages(Object.assign({}, e, { country: 'US' }), e.usTax || {}), g = w.groupLife, ppy = w.pay.ppy;
        const val = (v) => (Number(v) > 0 ? Number(v) : '');
        const num = (f, label, value, extra, help) => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" ${extra} inputmode="decimal" value="${value}" data-change="payx.gtl" ${attrs(t)} data-f="${f}">${help ? `<span class="help">${help}</span>` : ''}</label>`;
        const result = g.needsAge ? '<span class="text-amber-700">Type the age to figure it.</span>'
            : w.imputed > 0 ? `<strong class="text-lg">${money(w.imputed)}</strong><span class="help">${money(w.imputed / ppy)} a paycheck</span>` : `<strong class="text-lg">${money(0)}</strong><span class="help">Up to $50,000 isn't taxed.</span>`;
        return `<details class="panel tone-slate mt-3" ${w.imputed > 0 || g.needsAge || Number(gl.coverage) > 0 ? 'open' : ''}><summary class="text-sm font-semibold cursor-pointer"><i class="fa-solid fa-shield-heart text-slate-500"></i> Life insurance from the employer</summary>
            <div class="grid grid-cols-2 lg:grid-cols-4 gap-3 mt-2">
                ${num('coverage', 'Group life coverage ($)', val(gl.coverage), 'min="0" max="100000000" step="1000"', 'Paid for by the employer.')}
                ${num('age', 'Age at the end of the year', val(gl.age), 'min="0" max="120" step="1"', '')}
                ${num('perCheck', 'Or the pay stub\'s "GTL" amount (per paycheck)', val(gl.perCheck), 'min="0" max="100000" step="0.01"', 'It wins when typed.')}
                <div class="field"><span class="field-label">Taxed as pay, a year</span>${result}</div>
            </div>
            <p class="help mt-2">Group-term life coverage over $50,000 counts as income (the IRS's table, by age), less what you pay for it after tax. It isn't paid to you: it adds to income tax, Social Security and Medicare.</p></details>`;
    }

    // Per paycheck and per month, side by side: [label, a month, class] rows.
    function breakdown(items, ppy) {
        return `<table class="table text-xs"><thead><tr><th></th><th class="num">Per paycheck</th><th class="num">A month</th></tr></thead><tbody>${items.map(([k, m, c]) => `<tr><td class="text-slate-600">${k}</td><td class="num whitespace-nowrap font-bold ${c || ''}">${m < 0 ? '−' : ''}${money(Math.abs(m) * 12 / ppy)}</td><td class="num whitespace-nowrap ${c || ''}">${m < 0 ? '−' : ''}${money(Math.abs(m))}</td></tr>`).join('')}</tbody></table>`;
    }

    function after(tg) {
        if (tg.line && window.Earners) Earners.syncAmounts();
        App.changed({ structural: true, step: true });
    }
    // A deduction's amount a month right now (to switch between per paycheck, % and a month).
    function monthlyOf(t, d) {
        const e = engineView(t);
        const x = e && Engine.resolveDeductions(Object.assign({}, e, { country: 'US' })).find(z => z.d.id === d.id);
        return x ? x.monthly : Number(d.monthly) || 0;
    }
    function setType(d, type) {
        const ty = Engine.US_DEDUCTIONS.find(x => x.type === type);
        if (!ty) return null;
        Object.assign(d, { type: ty.type, group: ty.group, kind: ty.kind, pretax: ty.tax === 'retire' || ty.tax === 'sec125' });
        if (ty.group !== 'loan') delete d.debtId;
        return ty;
    }

    UI.register({
        'payx.set': (el) => {
            const tg = target(el.dataset.target);
            if (!tg) return;
            const pay = tg.pay, f = el.dataset.f, v = Math.max(0, parseNum(el.value, 0));
            pay.hourly = Object.assign({ rate: 0, hours: 40, otRate: 1.5 }, pay.hourly || {});
            if (f === 'payType') {
                const to = el.value === 'hourly' ? 'hourly' : 'salary';
                // Start from the same base pay: the salary's hourly rate (2,080 hours a year).
                if (to === 'hourly' && pay.payType !== 'hourly') { pay.hourly.rate = round2((Number(pay.sueldo) || 0) * 12 / 2080); pay.hourly.hours = Number(pay.hourly.hours) || 40; }
                pay.payType = to;
            } else if (f === 'yearly') pay.sueldo = Math.min(1e8, v) / 12;
            else if (f === 'rate') pay.hourly.rate = Math.min(1e5, v);
            else if (f === 'hours') pay.hourly.hours = Math.min(100, v);
            else if (f === 'paysPerYear') { const n = Number(el.value); if (Engine.PAY_FREQUENCIES.includes(n)) pay.paysPerYear = n; }
            else if (f === 'otPerCheck') pay.hourly.otPerCheck = Math.min(200, v);
            else if (f === 'otRate') pay.hourly.otRate = Math.min(3, Math.max(1, v || 1.5));
            else if (f === 'otInBudget') pay.hourly.otInBudget = !!el.checked;
            // By the hour, the monthly figure follows the hours (other screens and old versions read it).
            if (pay.payType === 'hourly') pay.sueldo = round2(Engine.usGrossPay(Object.assign({}, pay, { bonuses: [] })).baseM);
            after(tg);
        },
        'payx.ded': (el) => {
            const tg = target(el.dataset.target);
            const d = tg && (tg.pay.payDeductions || []).find(x => x.id === Number(el.dataset.id));
            if (!d) return;
            const f = el.dataset.f, e = engineView(el.dataset.target), g = Engine.usGrossPay(e), ppy = g.ppy;
            const before = monthlyOf(el.dataset.target, d);
            if (f === 'name') d.name = el.value.trim().slice(0, 60) || d.name;
            else if (f === 'coverage') d.coverage = el.value === 'self' ? 'self' : 'family';
            else if (f === 'type') {
                const ty = setType(d, el.value);
                if (ty && d.per === 'percent' && !ty.percent) { d.per = 'check'; d.perPay = round2(before * 12 / ppy); }
            } else if (f === 'amount') {
                const v = Math.max(0, parseNum(el.value, 0));
                if (d.per === 'percent') d.percent = Math.min(100, v);
                else if (d.per === 'check') d.perPay = Math.min(1e6, v);
                else d.monthly = Math.min(1e7, v);
            } else if (f === 'per') {
                // The same money, said another way.
                const to = PER[el.value] ? el.value : 'month';
                if (to === 'percent') d.percent = g.budgetM > 0 ? round2(before / g.budgetM * 100) : 0;
                else if (to === 'check') d.perPay = round2(before * 12 / ppy);
                else d.monthly = round2(before);
                d.per = to;
            }
            // The month's amount stays on the deduction too (older screens and versions read it).
            d.monthly = round2(monthlyOf(el.dataset.target, d));
            if (d.debtId) { const debt = (Store.state.debts || []).find(x => Number(x.id) === Number(d.debtId)); if (debt) debt.monthly = d.monthly; }
            after(tg);
        },
        'payx.gtl': (el) => {
            const tg = target(el.dataset.target);
            if (!tg) return;
            const gl = tg.pay.groupLife = Object.assign({ coverage: 0, age: null, perCheck: 0 }, tg.pay.groupLife);
            const f = el.dataset.f, v = Math.max(0, parseNum(el.value, 0));
            if (f === 'coverage') {
                gl.coverage = Math.min(1e8, v);
                // Your age from the retirement plan, to start from.
                if (!(Number(gl.age) > 0) && String(el.dataset.target) === 'main') gl.age = Number(Store.state.retirement.edadActual) || null;
            } else if (f === 'age') gl.age = v > 0 ? Math.min(120, Math.round(v)) : null;
            else if (f === 'perCheck') gl.perCheck = Math.min(1e5, v);
            // Let go of the field before its panel is redrawn (its own change on leaving it can't
            // arrive in the middle of the redraw).
            if (el === document.activeElement) el.blur();
            after(tg);
        },
        'payx.dedAdd': async (el) => {
            const t = el.dataset.target, tg = target(t);
            if (!tg) return;
            const r = await UI.form({
                title: 'Add a paycheck deduction', confirmText: 'Add',
                fields: [
                    { name: 'type', label: 'Type', options: (() => { const sets = []; Engine.US_DEDUCTIONS.forEach(x => { let s = sets.find(z => z.group === x.set); if (!s) sets.push(s = { group: x.set, options: [] }); s.options.push({ value: x.type, label: x.label }); }); return sets; })(), value: '401k' },
                    { name: 'amount', label: 'Amount', type: 'number', step: '0.01', min: 0, inputmode: 'decimal' },
                    { name: 'per', label: 'How', options: [{ value: 'check', label: 'Per paycheck' }, { value: 'percent', label: '% of pay (retirement plans)' }, { value: 'month', label: 'A month' }], value: 'check' },
                    { name: 'name', label: 'Name on your pay stub (optional)', placeholder: 'E.g. 401K PRE-TAX', more: true }
                ],
                validate: v => !(v.amount > 0) ? 'Type an amount greater than 0.' : v.per === 'percent' && !(Engine.US_DEDUCTIONS.find(x => x.type === v.type) || {}).percent ? 'A % of pay is for retirement plans; type an amount per paycheck instead.' : v.per === 'percent' && v.amount > 100 ? 'A percentage goes up to 100.' : null
            });
            if (!r) return;
            App.undoable('Deduction added', () => {
                const list = tg.pay.payDeductions || (tg.pay.payDeductions = []);
                const d = { id: Store.nextId(list), name: (r.name || '').trim().slice(0, 60), per: r.per };
                const ty = setType(d, r.type);
                if (!d.name) d.name = I18n.t(ty.label);
                if (r.per === 'percent') d.percent = Math.min(100, r.amount); else if (r.per === 'check') d.perPay = Math.min(1e6, r.amount); else d.monthly = Math.min(1e7, r.amount);
                list.push(d);
                d.monthly = round2(monthlyOf(t, d));
                if (tg.line && window.Earners) Earners.syncAmounts();
            });
        },
        'payx.dedDel': (el) => {
            const tg = target(el.dataset.target);
            if (!tg) return;
            const id = Number(el.dataset.id);
            App.undoable('Deduction removed', () => {
                tg.pay.payDeductions = (tg.pay.payDeductions || []).filter(x => x.id !== id);
                if (tg.line && window.Earners) Earners.syncAmounts();
            });
        }
    });

    window.PayEdit = { fields, rows, table, limits, groupLife, breakdown, HEAD, FREQ, TAX, setType, engineView };
})();
