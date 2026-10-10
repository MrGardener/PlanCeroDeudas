/* Presupuesto → Ingresos e Impuestos: payroll (IESS + SRI), décimos and deductions. */
(function () {
    'use strict';
    const { money, money0, pct, esc } = Fmt;

    // ------------------------------------------------------------------ how you get paid
    const WD = Fmt.WEEKDAYS;
    const WD_PL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    const ORD = { 1: '1.º', 2: '2.º', 3: '3.º', 4: '4.º', 5: '5.º', '-1': 'último' };
    const EVERY = { 1: 'cada mes', 2: 'cada 2 meses', 3: 'cada 3 meses (trimestral)', 6: 'cada 6 meses (semestral)', 12: 'una vez al año' };
    const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs.join('');
    const dayLabel = (iso) => { const d = new Date(iso + 'T12:00'); return Fmt.lang === 'en' ? `${WD[d.getDay()].slice(0, 3)} ${Fmt.MONTH_SHORT[d.getMonth()]} ${d.getDate()}` : `${WD[d.getDay()].slice(0, 3)} ${d.getDate()} ${Fmt.MONTH_SHORT[d.getMonth()].toLowerCase()}`; };

    // English sentence for the pay schedule (put together directly: the Spanish one is built from
    // pieces the translator can't recombine).
    function describeEn(sch) {
        const W = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
        const listEn = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs[xs.length - 1]}` : xs.join('');
        const nth = (d) => d === 31 ? 'last day' : `${d}${[11, 12, 13].includes(d % 100) ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' }[d % 10] || 'th')}`;
        if (sch.freq === 'monthly') {
            const every = { 1: 'every month', 2: 'every 2 months', 3: 'every 3 months (quarterly)', 6: 'every 6 months', 12: 'once a year' }[sch.interval] || `every ${sch.interval} months`;
            const wk = sch.weekend === 'before' ? ' (on a weekend, the Friday before)' : sch.weekend === 'after' ? ' (on a weekend, the Monday after)' : '';
            return `On the ${listEn(sch.days.map(nth))}, ${every}${wk}`;
        }
        if (sch.freq === 'weekly') return sch.interval === 2 ? `Every 2 weeks, on ${W[sch.weekday]}s` : `Every ${W[sch.weekday]}`;
        if (sch.freq === 'nth') return `The ${listEn(sch.nths.map(n => (n === -1 ? 'last' : nth(n))))} ${W[sch.weekday]} of each month`;
        if (sch.freq === 'daily') return sch.businessDays ? 'Every business day (Monday to Friday)' : 'Every day';
        return '';
    }

    function describe(sch) {
        if (!sch) return 'Sin configurar';
        if (!window.I18n || I18n.lang !== 'es') return describeEn(sch);
        if (sch.freq === 'monthly') {
            const wk = sch.weekend === 'before' ? ' (si cae en fin de semana, el viernes antes)' : sch.weekend === 'after' ? ' (si cae en fin de semana, el lunes después)' : '';
            const days = sch.days.length === 1
                ? (sch.days[0] === 31 ? 'El último día' : `El día ${sch.days[0]}`)
                : `Los días ${list(sch.days.map(d => d === 31 ? 'el último' : String(d)))}`;
            return `${days}, ${EVERY[sch.interval] || `cada ${sch.interval} meses`}${wk}`;
        }
        if (sch.freq === 'weekly') return sch.interval === 2 ? `Cada 2 semanas, los ${WD_PL[sch.weekday]}` : `Cada ${WD[sch.weekday]}`;
        if (sch.freq === 'nth') return `El ${list(sch.nths.map(n => ORD[n]))} ${WD[sch.weekday]} de cada mes`;
        if (sch.freq === 'daily') return sch.businessDays ? 'Cada día laborable (lunes a viernes)' : 'Todos los días';
        return '';
    }

    // Weekly / every-2-weeks pay: the months with an extra paycheck, and the choice to budget on
    // the usual paychecks so that one is real extra money (Engine.paycheckSalary).
    function renderExtraPay(ctx) {
        const plan = Engine.extraPaycheckMonths(Cash.paySchedule(), ctx.state.activeYear);
        if (!plan || !plan.months.length) { UI.html('pay-extra', ''); return; }
        const names = plan.months.map(m => Fmt.MONTH_NAMES[m.month - 1]);
        const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0];
        const on = !!ctx.year.budgetOnPaychecks, nth = plan.usual === 2 ? '3rd' : '5th';
        UI.html('pay-extra', `<p><i class="fa-solid fa-gift text-emerald-600"></i> <span>In ${ctx.state.activeYear}, a ${nth} paycheck in</span> <strong data-i18n-skip>${esc(Fmt.lang === 'en' ? list : list.replace(' and ', ' y ').toLowerCase())}</strong>.</p>
            <label class="check"><input type="checkbox" data-change="pay.onChecks" ${on ? 'checked' : ''}><span>Budget on ${plan.usual} paychecks a month <span class="block text-[11px] font-normal text-slate-500">${on ? 'The extra paycheck shows up as extra money in its month: give it a job.' : 'Dave Ramsey\'s way: then the extra paycheck is real extra money in its month.'}</span></span></label>`);
    }

    function renderSummary() {
        const sch = Cash.paySchedule();
        const next = sch ? Engine.nextPayday(sch, new Date()) : null;
        UI.html('pay-summary', sch ? `<span data-i18n-skip>${esc(describe(sch))}</span>${next ? `<div class="text-xs font-normal text-slate-600"><span>Next:</span> <span>${esc(dayLabel(Engine.isoDate(next.date)))}</span> <span>${next.days === 0 ? '(today)' : `(in ${next.days} day${next.days === 1 ? '' : 's'})`}</span></div>` : ''}` : '<span class="text-slate-500 font-normal">Not set up</span>');
    }

    // The editor works on a draft; nothing changes until "Guardar".
    let draft = null, sheet = null;

    function draftFrom(sch) {
        const today = new Date();
        const d = { freq: 'monthly', days: '15, 30', interval: 1, anchor: Engine.isoDate(today), weekend: 'same', weekday: 5, nths: [2, 4], businessDays: true, amount: '' };
        if (!sch) return d;
        Object.assign(d, { freq: sch.freq === 'weekly' && sch.interval === 2 ? 'biweekly' : sch.freq, interval: sch.interval || 1, amount: sch.amount || '' });
        if (sch.days) d.days = sch.days.join(', ');
        if (sch.anchor) d.anchor = sch.anchor;
        if (sch.weekend) d.weekend = sch.weekend;
        if (sch.weekday !== undefined) d.weekday = sch.weekday;
        if (sch.nths) d.nths = sch.nths;
        if (sch.businessDays !== undefined) d.businessDays = sch.businessDays;
        return d;
    }

    function scheduleFrom(d) {
        const amount = Fmt.parseNum(d.amount, 0);
        if (d.freq === 'monthly') return Engine.normalizeSchedule({ freq: 'monthly', days: String(d.days).split(/[^\d]+/).map(Number), interval: Number(d.interval), anchor: Number(d.interval) > 1 ? d.anchor : undefined, weekend: d.weekend, amount });
        if (d.freq === 'weekly' || d.freq === 'biweekly') return Engine.normalizeSchedule({ freq: 'weekly', weekday: Number(d.weekday), interval: d.freq === 'biweekly' ? 2 : 1, anchor: d.freq === 'biweekly' ? d.anchor : undefined, amount });
        if (d.freq === 'nth') return Engine.normalizeSchedule({ freq: 'nth', weekday: Number(d.weekday), nths: d.nths, amount });
        return Engine.normalizeSchedule({ freq: 'daily', businessDays: d.businessDays, amount });
    }

    // First paydays a year ahead with their amounts, from this draft.
    function previewHTML(sch) {
        if (!sch) return '<p class="text-sm text-red-600">Fill in the details: the days or the weekday are missing.</p>';
        const t = new Date();
        const from = Engine.isoDate(t), to = Engine.isoDate(new Date(t.getFullYear() + 1, t.getMonth(), t.getDate() - 1));
        const months = Cash.monthsBetween(from, to);
        const pay = {}, base = {};
        months.forEach(m => { const k = `${m.year}-${String(m.month).padStart(2, '0')}`; pay[k] = m.pay; base[k] = m.payBase; });
        const ev = Engine.cashEvents({ from, to, months: [], recurring: [], schedule: sch, payPerMonth: pay, payBase: base });
        const pays = ev.filter(e => e.name === 'Día de pago');
        const total = ev.reduce((a, e) => a + e.amount, 0);
        const perYear = Engine.paymentsPerYear(sch, t.getFullYear());
        const each = pays.length ? pays[0].amount : 0;
        return `<div class="grid grid-cols-1 sm:grid-cols-3 gap-2 mb-3">
                <div class="kpi tone-emerald"><span class="kpi-label">Payments a year</span><span class="kpi-value" id="pay-per-year">${perYear}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Each payment</span><span class="kpi-value">${money(each)}</span><span class="kpi-note">${sch.amount ? 'The amount you typed' : 'Your net salary spread out'}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">In 12 months</span><span class="kpi-value">${money(total)}</span><span class="kpi-note">≈ ${money(total / 12)} a month${ev.some(e => e.name !== 'Día de pago') ? ', bonuses included' : ''}</span></div>
            </div>
            <div class="section-label">Upcoming bills</div>
            <ul class="pay-next" id="pay-next">${ev.slice(0, 8).map(e => `<li><span>${esc(dayLabel(e.date))}${e.name !== 'Día de pago' ? ` <span class="badge badge-info">${esc(e.name)}</span>` : ''}</span><strong class="num">+${money(e.amount)}</strong></li>`).join('') || '<li class="help">No payments in the next 12 months.</li>'}</ul>
            ${sch.amount ? '<p class="help mt-2">The budget still uses the salary on this tab; this amount only changes the calendar and "Safe to spend".</p>' : ''}`;
    }

    function editorHTML() {
        const d = draft;
        const wdSel = `<label class="field"><span class="field-label">Weekday</span><select class="input" id="ps-weekday" data-change="pay.field">${[1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}" ${Number(d.weekday) === i ? 'selected' : ''}>${WD[i].charAt(0).toUpperCase() + WD[i].slice(1)}</option>`).join('')}</select></label>`;
        let extra = '';
        if (d.freq === 'monthly') extra = `
            <label class="field"><span class="field-label">Days of the month</span><input class="input" id="ps-days" data-change="pay.field" value="${esc(d.days)}" placeholder="E.g. 15, 30 (31 = last day)" inputmode="numeric"></label>
            <label class="field"><span class="field-label">How often</span><select class="input" id="ps-interval" data-change="pay.field">${[1, 2, 3, 6, 12].map(n => `<option value="${n}" ${Number(d.interval) === n ? 'selected' : ''}>${EVERY[n].charAt(0).toUpperCase() + EVERY[n].slice(1)}</option>`).join('')}</select></label>
            ${Number(d.interval) > 1 ? `<label class="field"><span class="field-label">A month you get paid</span><input type="month" class="input" id="ps-anchor-month" data-change="pay.field" value="${esc(String(d.anchor).slice(0, 7))}"></label>` : ''}
            <label class="field"><span class="field-label">If it falls on a Saturday or Sunday</span><select class="input" id="ps-weekend" data-change="pay.field"><option value="same" ${d.weekend === 'same' ? 'selected' : ''}>Paid that same day</option><option value="before" ${d.weekend === 'before' ? 'selected' : ''}>Moves up to Friday</option><option value="after" ${d.weekend === 'after' ? 'selected' : ''}>Moves to Monday</option></select></label>`;
        else if (d.freq === 'weekly') extra = wdSel;
        else if (d.freq === 'biweekly') extra = wdSel + `<label class="field"><span class="field-label">A date you were or will be paid</span><input type="date" class="input" id="ps-anchor" data-change="pay.field" value="${esc(d.anchor)}"><span class="help">So we know which weeks count.</span></label>`;
        else if (d.freq === 'nth') extra = wdSel + `<div class="field"><span class="field-label">Which ones in the month?</span><div class="flex flex-wrap gap-3 pt-1">${[1, 2, 3, 4, -1].map(n => `<label class="check"><input type="checkbox" class="ps-nth" data-n="${n}" data-change="pay.field" ${d.nths.map(Number).includes(n) ? 'checked' : ''}> ${ORD[n]}</label>`).join('')}</div></div>`;
        else extra = `<label class="check pt-6"><input type="checkbox" id="ps-business" data-change="pay.field" ${d.businessDays ? 'checked' : ''}> Monday to Friday only</label>`;
        const sch = scheduleFrom(d);
        return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label class="field"><span class="field-label">Frequency</span><select class="input" id="ps-freq" data-change="pay.field">
                    <option value="monthly" ${d.freq === 'monthly' ? 'selected' : ''}>Fixed days of the month</option>
                    <option value="weekly" ${d.freq === 'weekly' ? 'selected' : ''}>Every week</option>
                    <option value="biweekly" ${d.freq === 'biweekly' ? 'selected' : ''}>Every 2 weeks</option>
                    <option value="nth" ${d.freq === 'nth' ? 'selected' : ''}>Weeks of the month</option>
                    <option value="daily" ${d.freq === 'daily' ? 'selected' : ''}>Every day</option>
                </select><span class="help">${{ monthly: 'E.g. the 15th and 30th, end of month, quarterly.', weekly: 'E.g. every Friday.', biweekly: 'E.g. every other Thursday.', nth: 'E.g. the 2nd and 4th Friday.', daily: 'E.g. daily wage.' }[d.freq] || ''}</span></label>
                ${extra}
                <label class="field"><span class="field-label"><span>Amount of each payment (<span class="cur">${esc(Fmt.currency().symbol)}</span>)</span></span><input class="input" id="ps-amount" data-change="pay.field" inputmode="decimal" value="${esc(String(d.amount || ''))}" placeholder="Automatic: your net salary spread out"><span class="help">Leave it empty if you're paid the salary on this tab.</span></label>
            </div>
            <div class="bs-banner ok mt-3" id="pay-describe"><i class="fa-regular fa-calendar-check"></i> <span data-i18n-skip>${esc(describe(sch))}</span></div>
            <div class="mt-3">${previewHTML(sch)}</div>
            <div class="flex flex-wrap justify-between gap-2 mt-4">
                <button type="button" class="btn btn-ghost btn-sm" data-action="pay.clear">Remove</button>
                <button type="button" class="btn btn-primary" data-action="pay.save" id="pay-save" ${sch ? '' : 'disabled'}><i class="fa-solid fa-check"></i> Save</button>
            </div>`;
    }

    function readDraft() {
        const v = (id) => { const el = document.getElementById(id); return el ? el.value : undefined; };
        const freq = v('ps-freq');
        if (freq !== draft.freq) { draft.freq = freq; return; }
        if (v('ps-days') !== undefined) draft.days = v('ps-days');
        if (v('ps-interval') !== undefined) draft.interval = Number(v('ps-interval'));
        if (v('ps-anchor-month')) draft.anchor = v('ps-anchor-month') + '-01';
        if (v('ps-anchor')) draft.anchor = v('ps-anchor');
        if (v('ps-weekend') !== undefined) draft.weekend = v('ps-weekend');
        if (v('ps-weekday') !== undefined) draft.weekday = Number(v('ps-weekday'));
        const nth = UI.$$('.ps-nth');
        if (nth.length) draft.nths = nth.filter(x => x.checked).map(x => Number(x.dataset.n));
        const b = document.getElementById('ps-business');
        if (b) draft.businessDays = b.checked;
        draft.amount = v('ps-amount') || '';
    }

    // ------------------------------------------------------------------ United States
    const US = () => window.DefaultsUS || { STATES: [], MI_CITIES: [] };
    // ------------------------------------------------------------------ how you're paid (US)
    // Salary, or hourly with usual overtime; and the bonuses expected this year. Taxes count the
    // whole year; the budget counts base pay (overtime only if the person says so) and a bonus only
    // in its month when it's planned (Engine.usGrossPay / bonusForMonth).
    const HOURLY = { rate: 0, hours: 40, otHours: 0, otRate: 1.5, otInBudget: false };
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function payFields(y) {
        if (!y.hourly) y.hourly = Object.assign({}, HOURLY);
        if (!Array.isArray(y.bonuses)) y.bonuses = [];
        return y;
    }
    // With hourly pay the monthly gross the rest of the app reads is the base pay.
    function syncSalary(y) {
        if (y.payType === 'hourly') y.sueldo = Math.round(Engine.usGrossPay(y).baseM * 100) / 100;
    }

    function renderPayType(ctx) {
        const el = document.getElementById('inc-paytype');
        if (!el) return;
        const yd = ctx.year;
        const bonuses = yd.bonuses || [];
        // How you're paid, how often and overtime: the same editor as every other earner's (payedit.js).
        el.innerHTML = `${window.PayEdit ? PayEdit.fields('main') : ''}
            <div>
                <div class="flex items-center justify-between gap-2"><span class="field-label mb-0">Bonuses this year</span><button type="button" class="btn btn-secondary btn-sm" data-action="bonus.add"><i class="fa-solid fa-plus"></i> Add a bonus</button></div>
                ${bonuses.length ? `<div class="space-y-2 mt-2">${bonuses.map(b => `<div class="grid grid-cols-2 sm:grid-cols-[1fr_8rem_9rem_auto_auto] gap-2 items-center">
                    <input class="input col-span-2 sm:col-span-1" value="${esc(b.name || '')}" placeholder="E.g. Year-end bonus" data-change="bonus.set" data-id="${b.id}" data-field="name" aria-label="Bonus name" data-i18n-skip>
                    <input type="number" class="input" min="0" step="50" value="${Number(b.amount) || ''}" placeholder="Before taxes" data-change="bonus.set" data-id="${b.id}" data-field="amount" aria-label="Amount before taxes">
                    <select class="input" data-change="bonus.set" data-id="${b.id}" data-field="month" aria-label="Month">${MONTHS.map((m, i) => `<option value="${i + 1}" ${String(b.month) === String(i + 1) ? 'selected' : ''}>${m}</option>`).join('')}</select>
                    <label class="check text-xs"><input type="checkbox" data-change="bonus.set" data-id="${b.id}" data-field="inBudget" ${b.inBudget ? 'checked' : ''}><span>Plan it in that month</span></label>
                    <button type="button" class="row-del" data-action="bonus.del" data-id="${b.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button>
                </div>`).join('')}</div>
                <p class="help mt-1">Bonuses always count in your taxes. Check "Plan it" only for a bonus you're sure of; otherwise give it a job when it arrives.</p>` : '<p class="help mt-1">Expect a bonus or commission this year? Add it so your taxes are right.</p>'}
            </div>`;
        // By the hour, the monthly gross follows the hours (kept in sync here too, for plans set up
        // elsewhere: a backup, the example family).
        syncSalary(yd);
    }

    // How the state's tax is figured, in a sentence or two (and what isn't counted).
    function stateNote(st, yd) {
        const name = esc(st.name);
        if (st.type === 'none') return `${name} doesn't tax wages.`;
        if (st.type === 'custom') return `We don't have ${name}'s table yet: type the state tax percentage from your pay stub (state tax ÷ gross pay).`;
        const status = Engine.usStatus(yd.filingStatus);
        const amt = (v) => money(v && typeof v === 'object' ? Engine.forStatus(v, status) : v);
        const after = [st.std === 'federal' ? 'the federal standard deduction' : st.std ? `a ${amt(st.std)} standard deduction` : '',
            st.exemption ? `a ${money(st.exemption)} exemption per person` : '', st.personal ? `a ${amt(st.personal)} personal exemption` : '',
            st.perDependent ? `${money(st.perDependent)} per dependent` : '', st.zero ? `the first ${amt(st.zero)} at 0%` : ''].filter(Boolean);
        const rates = st.type === 'brackets' ? (() => { const br = Engine.forStatus(st.brackets, status, 'brackets'); return `${+(br[0][1] * 100).toFixed(2)}% to ${+(br[br.length - 1][1] * 100).toFixed(2)}% by income`; })() : `${st.rate}% flat`;
        const parts = [`<span data-i18n-skip>${name}:</span> <span>${rates}</span>`].concat(after.map(x => `<span>${esc(x)}</span>`));
        if (st.surtax) parts.push(`<span>${st.surtax.rate}% more above ${money(st.surtax.over)}</span>`);
        return `${parts.join(' · ')}. <span>2026 table: verify each January.</span>${st.approx ? ` <span>Not counted: ${esc(st.approx)}.</span>` : ''}`;
    }

    function renderUS(ctx) {
        const yd = ctx.year, p = ctx.pay;
        const st = US().STATES.find(x => x.code === yd.state) || { type: 'custom', name: yd.state };
        const sel = document.getElementById('inc-state');
        if (sel && !sel.options.length) sel.innerHTML = US().STATES.map(x => `<option value="${x.code}">${esc(x.name)}</option>`).join('');
        if (sel) sel.value = yd.state || 'MI';
        const rate = document.getElementById('inc-state-rate');
        if (rate && rate !== document.activeElement) rate.value = yd.stateRate === null || yd.stateRate === undefined ? '' : yd.stateRate;
        if (rate) rate.placeholder = st.type === 'none' ? '0' : st.type === 'flat' ? String(st.rate) : st.type === 'brackets' ? 'Automatic' : 'Type your %';
        UI.text('inc-status-note', yd.filingStatus === 'mfs' ? 'Each spouse on their own return: the tips, overtime and 65-or-older deductions need a joint return.'
            : yd.filingStatus === 'qss' ? 'For 2 years after the year your spouse died, with a child at home: the joint brackets and standard deduction.' : '');
        // What 65 or older, blind, tips and a car loan take off this year's federal tax.
        const f = p.fedReturn || {};
        const off = [f.addlStd ? `${money(f.addlStd)} more standard deduction` : '', f.seniorDeduction ? `${money(f.seniorDeduction)} for 65 or older` : '', f.tipsDeduction ? `${money(f.tipsDeduction)} of tips` : '', f.carDeduction ? `${money(f.carDeduction)} of car loan interest` : ''].filter(Boolean);
        UI.html('inc-return-note', off.length ? `<i class="fa-solid fa-circle-check text-emerald-600"></i> Off your taxable income this year: ${off.map(x => `<span>${esc(x)}</span>`).join(' · ')}.` : '');
        UI.html('inc-state-note', stateNote(st, yd));
        // Cities with an income tax (Michigan list) or a rate you type.
        const city = document.getElementById('inc-city');
        if (city) {
            const cities = (US().CITIES || {})[yd.state] || [];
            const known = cities.find(c => c.name === yd.localName);
            city.innerHTML = `<option value="">None (0%)</option>` + cities.map(c => `<option value="${esc(c.name)}">${esc(c.name)} (${c.brackets ? `${c.brackets.single[0][1] * 100}–${c.rate}%` : `${c.rate}% · ${c.nonresident}%`})</option>`).join('') + `<option value="__custom">Another rate…</option>`;
            UI.show('inc-city-resident', !!known);
            UI.show('inc-school', yd.state === 'OH');
            const school = document.getElementById('inc-school-rate');
            if (school && school !== document.activeElement) school.value = Number(yd.schoolRate) > 0 ? yd.schoolRate : '';
            city.value = known ? known.name : (Number(yd.localRate) > 0 ? '__custom' : '');
            if (!known && Number(yd.localRate) > 0) city.options[city.options.length - 1].textContent = `Other: ${yd.localRate}%`;
        }
        renderPayType(ctx);
        const extra = p.gross && p.gross.annual - p.gross.budgetM * 12 > 0.5;
        UI.text('inc-annual', extra ? `Before taxes. The year with overtime and bonuses: ${money(p.sueldoAnual)}.` : `Before taxes. Per year: ${money(p.sueldoAnual)}.`);
        // Per paycheck and a month, side by side (a month = the year ÷ 12).
        const after = p.otrosDescuentosM - p.pretaxM;
        const rows = [
            [p.gross && p.gross.payType === 'hourly' ? 'Base pay' : 'Gross salary', p.sueldo, 'text-slate-900'],
            p.pretaxM > 0 ? ['Pre-tax deductions (traditional 401(k), health insurance, FSA, HSA…)', -p.pretaxM, 'text-blue-700'] : null,
            ['Federal income tax', -p.fedM, 'text-red-600'],
            ['Seguro Social', -p.ssM, 'text-red-600'],
            ['Medicare', -p.medM, 'text-red-600'],
            [`State income tax (${esc(st.name) + (p.stateRate ? ` ${p.stateRate}%` : '')})`, -p.stateM, 'text-red-600'],
            p.localM - (p.schoolM || 0) > 0.004 ? [`City tax${yd.localName ? ` (${esc(yd.localName)}, ${p.localResident ? 'resident' : 'non-resident'} ${p.localRate}%)` : ''}`, -(p.localM - (p.schoolM || 0)), 'text-red-600'] : null,
            p.schoolM > 0.004 ? [`School district tax (${Number(yd.schoolRate)}%)`, -p.schoolM, 'text-red-600'] : null,
            after > 0.004 ? ['After-tax deductions (Roth 401(k), life and disability insurance…)', -after, 'text-red-600'] : null,
            ['Take-home pay', p.netoM, 'text-emerald-700']
        ].filter(Boolean);
        UI.html('inc-payroll', PayEdit.breakdown(rows, p.ppy || 12)
            + (extra ? `<p class="help pt-2">Taxes are figured on the whole year (${money(p.sueldoAnual)}). This paycheck carries its share; overtime and bonuses keep the rest.</p>` : ''));
        UI.text('inc-neto', money(p.netoM));
        UI.html('inc-us-ded-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Deduction applied</span><span class="kpi-value">${money(p.dedApplied)}</span><span class="kpi-note">${Number(yd.itemized) > p.stdDeduction ? 'Itemized' : `Standard (${money(p.stdDeduction)})`}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Federal taxable income</span><span class="kpi-value">${money(p.baseImponible)}</span><span class="kpi-note">${p.otDeduction > 0 ? `a year, after ${money(p.otDeduction)} of overtime deduction` : 'a year'}</span></div>
            <div class="kpi tone-blue"><span class="kpi-label">Dependent credits</span><span class="kpi-value">${money(p.credits)}</span><span class="kpi-note">a year</span></div>
            <div class="kpi tone-amber"><span class="kpi-label">Income taxes</span><span class="kpi-value">${money(p.isrAnual)}</span><span class="kpi-note">a year (federal + state + city)</span></div>`);
        if (window.PayScan) PayScan.render(ctx);
    }

    // Tax tables are for one year: say which, and warn when the year being edited is later.
    function taxYearNote(ctx) {
        const yd = ctx.year, ty = Number(yd.taxTableYear || (yd.usTax && yd.usTax.year)) || null, y = ctx.state.activeYear;
        const el = document.getElementById('inc-tax-year');
        if (!el) return;
        el.className = ty && y > ty ? 'panel tone-amber text-[11px] mt-2' : 'help mt-2';
        el.innerHTML = !ty ? '' : y > ty
            ? `<i class="fa-solid fa-triangle-exclamation text-amber-600"></i> The ${ty} tax tables are being used. The ${y} ones aren't in the app yet: check them and update them in <a href="#" class="link" data-goto="config" data-focus="cfg-legal">Settings → Legal parameters</a>.`
            : `${ty} tax tables. Check them every year in Settings → Legal parameters.`;
    }

    // What you've actually spent this year in the SRI's personal-expense categories, how much of
    // it has an invoice in your name, and the rebate it's worth so far.
    function sriTracker(ctx) {
        const p = ctx.pay, y = ctx.state.activeYear;
        const r = Engine.sriPersonalExpenses(ctx.state.transactions, y, { cap: p.sriCap, ratePct: Number(ctx.year.sriRebajaRate) || 18 });
        const pct = r.cap > 0 ? Math.min(100, Math.round(r.invoiced / r.cap * 100)) : 0;
        UI.html('inc-sri-tracker', r.total <= 0 ? `<p class="help">When you log ${y} spending on housing, health, education, food, clothing or tourism, you'll see your progress here.</p>` : `
            <div class="table-wrap"><table class="table"><thead><tr><th>SRI category</th><th class="num">Spent</th><th class="num">With invoice</th></tr></thead>
            <tbody>${r.groups.map(g => `<tr><td>${esc(g.label)}</td><td class="num">${money0(g.total)}</td><td class="num ${g.invoiced < g.total ? 'text-amber-700' : ''}">${money0(g.invoiced)}</td></tr>`).join('')}</tbody>
            <tfoot><tr><td>Total</td><td class="num">${money0(r.total)}</td><td class="num">${money0(r.invoiced)}</td></tr></tfoot></table></div>
            <div class="flex justify-between text-xs mt-3"><span>Invoices vs. the cap (${money0(r.cap)})</span><strong>${pct}%</strong></div>
            <div class="progress-track mt-1"><div class="progress-fill" style="width:${pct}%"></div></div>
            <p class="text-xs mt-2">Rebate earned so far: <strong>${money0(r.rebate)}</strong>${r.missingInvoices > 0 ? `. <span class="text-amber-700">You have ${money0(r.missingInvoices)} of spending without an invoice in your name that still fits under the cap: ask for one with your ID number and you'd add ${money0(r.potential - r.rebate)}.</span>` : '.'}</p>
            <p class="help mt-1">Imported SRI invoices and purchases marked «with invoice» count. Of a mortgage payment only the interest counts (your bank's certificate); restaurants don't count as food.</p>`);
    }

    function update(ctx) {
        const yd = ctx.year, p = ctx.pay;
        renderSummary();
        renderExtraPay(ctx);
        taxYearNote(ctx);
        if (window.SideIncome) SideIncome.render(ctx);
        if (p.country === 'US') { renderUS(ctx); if (window.Earners) Earners.render(ctx); if (window.Refund) Refund.render(ctx); if (window.Itemize) Itemize.render(ctx); return; }
        UI.text('inc-sbu', money(yd.sbu));
        const rows = [
            ['Monthly gross salary', money(p.sueldo), 'text-slate-900'],
            [`IESS personal contribution (${pct(yd.iessRate, 2)})`, '−' + money(p.iessM), 'text-red-600'],
            ['Annual taxable base (salary − IESS)', money(p.baseImponible), 'text-slate-900'],
            ['Tax from the SRI table', money(p.isrBruto), 'text-slate-900'],
            [`Personal-expense rebate (${pct(p.rebajaRate * 100, 0)} of ${money(p.dedApplied)})`, (p.rebaja >= 0.005 ? '−' : '') + money(p.rebaja), 'text-blue-700'],
            ['Annual income tax', money(p.isrAnual), 'text-amber-700'],
            ['Monthly withholding on your pay', (p.isrM >= 0.005 ? '−' : '') + money(p.isrM), 'text-red-600']
        ].concat(p.otrosDescuentosM > 0 ? [['Other paycheck deductions (insurance, loans…)', '−' + money(p.otrosDescuentosM), 'text-red-600']] : []);
        UI.html('inc-payroll', rows.map(([k, v, c]) => `<div class="flex justify-between py-2"><dt class="text-slate-600">${k}</dt><dd class="font-bold whitespace-nowrap ${c}">${v}</dd></div>`).join(''));
        UI.text('inc-neto', money(p.netoM));
        if (window.PayScan) PayScan.render(ctx);

        UI.text('inc-cap', money(p.sriCap));
        UI.text('inc-ded-prep', money(p.deductibles.prep));
        UI.text('inc-ded-real', money(p.deductibles.real));
        const ratio = p.sriCap > 0 ? p.deductibles.real / p.sriCap : 1;
        const box = document.getElementById('inc-ded-status');
        let tone, icon, title, text;
        if (p.deductibles.real >= p.sriCap) {
            tone = 'tone-emerald'; icon = 'fa-circle-check text-emerald-600'; title = 'Deduction maxed out';
            text = `Your deductible expenses reach the legal cap of ${money(p.sriCap)}.`;
        } else if (p.rebajaRoom < 0.01) {
            // No tax left to lower: more receipts wouldn't change anything.
            tone = 'tone-emerald'; icon = 'fa-circle-check text-emerald-600'; title = 'No tax to lower';
            text = `With your salary, the rebate already covers all the tax (or you don't pay income tax).`;
        } else if (ratio >= 0.8) {
            tone = 'tone-amber'; icon = 'fa-triangle-exclamation text-amber-600'; title = 'Near the limit';
            text = `You need ${money(p.sriCap - p.deductibles.real)} more in actual deductible expenses to reach the cap: your tax would drop up to ${money(p.rebajaRoom)} more.`;
        } else {
            tone = 'tone-red'; icon = 'fa-circle-info text-red-600'; title = 'Well below the cap';
            text = `You use ${Math.round(ratio * 100)}% of the cap. With ${money(p.sriCap - p.deductibles.real)} more in deductible expenses, your tax would drop up to ${money(p.rebajaRoom)}. Mark the deductible lines in the Monthly Budget.`;
        }
        box.className = `panel ${tone}`;
        box.innerHTML = `<div class="text-xs font-bold text-slate-900"><i class="fa-solid ${icon}"></i> ${title}</div><p class="text-[11px] text-slate-700 mt-1">${text}</p>`;
        sriTracker(ctx);
    }

    UI.register({
        'pay.onChecks': (el) => {
            const y = Store.active();
            App.undoable(el.checked ? 'Budgeting on your paychecks' : 'Budgeting on your monthly pay', () => { y.budgetOnPaychecks = el.checked; });
        },
        'paytype.set': (el) => {
            const y = payFields(Store.active());
            App.undoable(el.value === 'hourly' ? 'Paid by the hour' : 'Paid a salary', () => {
                // Switching to hourly starts from the salary: an hourly rate that gives the same base pay.
                if (el.value === 'hourly' && !(Number(y.hourly.rate) > 0) && Number(y.sueldo) > 0) y.hourly.rate = Math.round(Number(y.sueldo) / ((Number(y.hourly.hours) || 40) * 52 / 12) * 100) / 100;
                y.payType = el.value === 'hourly' ? 'hourly' : 'salary';
                syncSalary(y);
            });
        },
        'paytype.hourly': (el) => {
            const y = payFields(Store.active()), f = el.dataset.field;
            y.hourly[f] = f === 'otInBudget' ? el.checked : Math.max(0, Fmt.parseNum(el.value, 0));
            syncSalary(y);
            App.changed({ step: true });
        },
        'bonus.add': () => {
            const y = payFields(Store.active());
            App.undoable('Bonus added', () => { y.bonuses.push({ id: Store.nextId(y.bonuses), name: '', amount: 0, month: '12', inBudget: false }); });
        },
        'bonus.set': (el) => {
            const b = (payFields(Store.active()).bonuses || []).find(x => String(x.id) === el.dataset.id);
            if (!b) return;
            const f = el.dataset.field;
            b[f] = f === 'inBudget' ? el.checked : f === 'amount' ? Math.max(0, Fmt.parseNum(el.value, 0)) : f === 'month' ? el.value : el.value.trim().slice(0, 40);
            App.changed({ step: true });
        },
        'bonus.del': (el) => {
            const y = payFields(Store.active());
            const b = y.bonuses.find(x => String(x.id) === el.dataset.id);
            App.undoable(`Bonus "${(b && b.name) || ''}" removed`, () => { y.bonuses = y.bonuses.filter(x => x !== b); });
        },
        'us.state': (el) => { const y = Store.active(); y.state = el.value; y.stateRate = null; y.localName = ''; y.localRate = 0; App.changed({ structural: true, step: true }); },
        'us.schoolRate': (el) => { Store.active().schoolRate = Math.min(5, Math.max(0, Fmt.parseNum(el.value, 0))); App.changed({ structural: true }); },
        'us.stateRate': (el) => { Store.active().stateRate = el.value === '' ? null : Math.min(20, Math.max(0, Fmt.parseNum(el.value, 0))); App.changed({ step: true }); },
        'us.city': async (el) => {
            const y = Store.active();
            if (el.value === '__custom') {
                const r = await UI.form({ title: 'Your city\'s tax', fields: [{ name: 'name', label: 'City', value: y.localName || '' }, { name: 'rate', label: 'Rate (%)', type: 'number', step: '0.01', min: 0, value: y.localRate || '' }], confirmText: 'Save' });
                if (!r) { App.render(); return; }
                y.localName = r.name.trim().slice(0, 40); y.localRate = Math.max(0, Number(r.rate) || 0);
            } else {
                const c = ((US().CITIES || {})[y.state] || []).find(x => x.name === el.value);
                y.localName = c ? c.name : ''; y.localRate = c ? c.rate : 0;
            }
            App.changed({ structural: true, step: true });
        },
        'pay.edit': () => {
            draft = draftFrom(Cash.paySchedule());
            // A sensible "one payday" for every-2-weeks: the next such weekday.
            if (!(Cash.paySchedule() || {}).anchor) { const t = new Date(); t.setDate(t.getDate() + ((Number(draft.weekday) - t.getDay() + 7) % 7)); draft.anchor = Engine.isoDate(t); }
            sheet = UI.sheet({ title: 'How do you get paid?', icon: 'fa-money-check-dollar', wide: true, html: editorHTML(), onClose: () => { sheet = null; draft = null; } });
        },
        'pay.field': () => {
            if (!draft || !sheet) return;
            readDraft();
            sheet.body.innerHTML = editorHTML();
        },
        'pay.save': () => {
            if (!draft) return;
            readDraft();
            const sch = scheduleFrom(draft);
            if (!sch) return;
            const st = Store.state.settings;
            st.paySchedule = sch;
            st.paydays = sch.freq === 'monthly' && sch.interval === 1 ? sch.days : [];
            // How often you're paid follows the calendar (weekly, every 2 weeks, twice a month, monthly).
            const n = Engine.nominalPaymentsPerYear(sch);
            if (Engine.PAY_FREQUENCIES.includes(n)) Store.active().paysPerYear = n;
            sheet.close();
            App.changed({ structural: true, step: true });
            UI.toast(`${window.I18n ? I18n.t('Saved') : 'Saved'}: ${describe(sch)}`, 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
        },
        'pay.clear': () => {
            const st = Store.state.settings;
            st.paySchedule = null;
            st.paydays = [];
            if (sheet) sheet.close();
            App.changed({ structural: true, step: true });
        }
    });

    App.defineView('presupuesto/ingresos', { update });
})();
