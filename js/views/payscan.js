/*
 * Ingresos → "Descuentos de tu rol de pagos": everything the employer takes from each paycheck
 * besides IESS and income tax (or, in other countries, every line of the pay stub): insurance,
 * pensión alimenticia / child support, IESS or 401(k) loans, voluntary retirement savings,
 * union dues… They come off the net salary the budget uses; retirement ones count as savings;
 * a loan can be linked to its debt (then it isn't a budget line: payroll pays it).
 *
 * A pay stub (PDF or photo) can be read to fill the list. The file is read on this device,
 * never stored; only labels and amounts are kept, and ID numbers are dropped.
 */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    const GROUPS = {
        mandatory: 'Taxes and contributions', retirement: 'Retirement savings', insurance: 'Insurance', garnishment: 'Court-ordered (child support…)',
        loan: 'Loan', other: 'Otro', employer: 'Paid by your employer (not deducted)'
    };
    const PPY = [[52, 'Every week'], [26, 'Every 2 weeks'], [24, 'Twice a month'], [12, 'Once a month']];
    // In Ecuador the app already computes these from the salary.
    const COMPUTED_EC = { iess: (p) => p.iessM, ir: (p) => p.isrM };
    const COMPUTED_US = { federal: (p) => p.fedM, state: (p) => p.stateM, local: (p) => p.localM, ss: (p) => p.ssM, medicare: (p) => p.medM };
    const COMPUTED = new Proxy({}, { get: (_, k) => ((Store.COUNTRY === 'US' ? COMPUTED_US : COMPUTED_EC)[k]) });

    function yd() { return Store.active(); }
    const list = () => yd().payDeductions || (yd().payDeductions = []);

    function usesFor(d) {
        if (d.group === 'retirement') return '<span class="badge badge-ok">Savings (Step 4)</span>';
        if (d.group === 'employer') return d.kind === 'retirement' ? '<span class="badge badge-ok">Adds to your retirement</span>' : '<span class="badge badge-muted">For information</span>';
        if (d.group === 'loan') {
            const debts = Store.state.debts || [];
            return `<select class="cell-input text-xs" data-change="ded.debt" data-id="${d.id}" aria-label="Debt it pays"><option value="">Not linked to a debt</option>${debts.map(x => `<option value="${x.id}" ${Number(d.debtId) === Number(x.id) ? 'selected' : ''}>Paga: ${esc(x.name)}</option>`).join('')}</select>`;
        }
        return '<span class="badge badge-muted">Expense paid through payroll</span>';
    }

    function render(ctx) {
        const host = document.getElementById('ded-body');
        if (!host) return;
        const p = ctx.pay, items = list();
        const sum = Engine.payDeductionsSummary(yd());
        UI.html('ded-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Net before these deductions</span><span class="kpi-value">${money(p.netoAntesM)}</span><span class="kpi-note">a month</span></div>
            <div class="kpi ${sum.taken > 0 ? 'tone-amber' : 'tone-slate'}"><span class="kpi-label">Deductions on the stub</span><span class="kpi-value">−${money(sum.taken)}</span><span class="kpi-note">${items.filter(d => d.group !== 'employer').length} a month</span></div>
            <div class="kpi tone-emerald"><span class="kpi-label">Net you receive</span><span class="kpi-value" id="ded-net">${money(p.netoM)}</span><span class="kpi-note">It's your budget's income</span></div>
            <div class="kpi tone-blue"><span class="kpi-label">Savings through payroll</span><span class="kpi-value">${money(sum.retirement)}</span><span class="kpi-note">Counts toward retirement</span></div>`);
        host.innerHTML = items.length ? items.map(d => `<tr data-row="${d.id}">
                <td><input class="cell-input font-semibold" value="${esc(d.name)}" data-change="ded.set" data-id="${d.id}" data-field="name" aria-label="Name"></td>
                <td><select class="cell-input text-xs" data-change="ded.set" data-id="${d.id}" data-field="group" aria-label="Type">${Object.keys(GROUPS).map(g => `<option value="${g}" ${d.group === g ? 'selected' : ''}>${GROUPS[g]}</option>`).join('')}</select></td>
                <td><input type="number" class="cell-input num money" step="0.01" min="0" value="${Number(d.monthly) || 0}" data-change="ded.set" data-id="${d.id}" data-field="monthly" aria-label="Per month"></td>
                <td>${usesFor(d)}</td>
                <td class="text-center"><button class="row-del" data-action="ded.delete" data-id="${d.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="5">No deductions besides taxes. Scan your pay stub or add them by hand.</td></tr>';
        // US: yearly contribution limits.
        const tax = yd().usTax;
        if (tax) {
            const age = Number(Store.state.retirement.edadActual) || 0;
            const k401 = items.filter(d => d.group === 'retirement' && d.kind !== 'hsa').reduce((a, d) => a + (Number(d.monthly) || 0), 0) * 12;
            const hsa = items.filter(d => d.kind === 'hsa').reduce((a, d) => a + (Number(d.monthly) || 0), 0) * 12;
            const lim = tax.limit401k + (age >= 50 ? tax.catchUp401k : 0);
            const warn = [];
            if (k401 > lim) warn.push(`Your payroll retirement contributions (${money(k401)} a year) are over the ${money(lim)} 401(k) limit.`);
            if (hsa > tax.limitHSA.family) warn.push(`Your HSA (${money(hsa)} a year) is over the family limit of ${money(tax.limitHSA.family)}.`);
            UI.html('ded-limits', warn.map(w => `<div class="bs-banner warn mt-2"><i class="fa-solid fa-triangle-exclamation"></i> ${w}</div>`).join(''));
        }
        const last = yd().lastPaystub;
        UI.html('ded-last', last ? (() => {
            const stubMonthly = last.net * last.ppy / 12;
            const diff = stubMonthly - p.netoM;
            return `Last stub read${last.payDate ? ` (${esc(last.payDate)})` : ''}: net ${money(last.net)} per paycheck ≈ ${money(stubMonthly)} a month. ${Math.abs(diff) < 1 ? '<span class="text-emerald-700 font-bold">Matches what the app calculates.</span>' : `<span class="text-amber-700 font-bold">The app calculates ${money(p.netoM)}: ${diff > 0 ? 'your stub says ' + money(diff) + ' más' : 'your stub says ' + money(-diff) + ' menos'} a month.</span> Check your gross salary and your deductions.`}`;
        })() : '');
    }

    // ------------------------------------------------------------------ reading a stub
    function loadScript(src, test) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = src; sc.onload = () => (test() ? resolve() : reject(new Error('no lib'))); sc.onerror = () => reject(new Error('offline'));
            document.head.appendChild(sc);
        });
    }
    const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
    async function pdfText(file) {
        await loadScript(PDFJS + 'pdf.min.js', () => !!window.pdfjsLib);
        if (!pdfjsLib.GlobalWorkerOptions.workerSrc) {
            // A worker from another site can't start from a local file: load it as a blob.
            const code = await (await fetch(PDFJS + 'pdf.worker.min.js')).text();
            pdfjsLib.GlobalWorkerOptions.workerSrc = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
        }
        const doc = await pdfjsLib.getDocument({ data: await file.arrayBuffer() }).promise;
        const lines = [];
        for (let n = 1; n <= Math.min(doc.numPages, 4); n++) {
            const content = await (await doc.getPage(n)).getTextContent();
            // Rebuild lines: items on the same baseline, left to right.
            const rows = {};
            content.items.forEach(it => { const y = Math.round(it.transform[5] / 3); (rows[y] = rows[y] || []).push(it); });
            Object.keys(rows).map(Number).sort((a, b) => b - a).forEach(y => lines.push(rows[y].sort((a, b) => a.transform[4] - b.transform[4]).map(i => i.str).join('  ')));
        }
        return lines.join('\n');
    }
    async function photoText(file, status) {
        await loadScript('https://cdn.jsdelivr.net/npm/tesseract.js@5/dist/tesseract.min.js', () => !!window.Tesseract);
        const worker = await Tesseract.createWorker(['spa', 'eng'], 1, { logger: m => { if (m.status === 'recognizing text') status(`<i class="fa-solid fa-spinner fa-spin"></i> Reading the photo… ${Math.round((m.progress || 0) * 100)}%`); } });
        const { data } = await worker.recognize(file);
        await worker.terminate();
        return data.text;
    }

    let draft = null, sheet = null;

    function fromText(text) {
        const p = Importers.parsePaystub(text);
        if (!p.deductions.length && p.net === null) { UI.toast('We found no pay stub amounts in that file. You can add the deductions by hand.', 'error'); return; }
        const schedule = Cash.paySchedule();
        const ppy = Importers.paysPerYearFromPeriod(p.periodDays) || (schedule ? Math.round(Engine.nominalPaymentsPerYear(schedule)) : 12);
        draft = { stub: p, ppy: [52, 26, 24, 12].includes(ppy) ? ppy : 12, useGross: false, rows: p.deductions.map(d => ({ label: d.label, group: d.group, kind: d.kind, pretax: d.pretax, amount: d.amount, ytd: d.ytd, include: !COMPUTED[d.kind] })) };
        draft.useGross = p.gross > 0 && Math.abs(p.gross * draft.ppy / 12 - (Number(yd().sueldo) || 0)) > 1;
        // US stubs: hourly pay (rate × hours), overtime and a bonus line (docs/plans/hourly-pay.md, phase 4).
        const e = (Store.COUNTRY === 'US' && p.earnings) || {}, cur = yd(), h = cur.hourly || {};
        draft.reg = e.regular && e.regular.rate > 0 && e.regular.hours > 0 ? e.regular : null;
        draft.ot = draft.reg && e.overtime && e.overtime.hours > 0 ? e.overtime : null;
        draft.bonus = e.bonus && e.bonus.amount > 0 ? Object.assign({ month: String(Number((p.payDate || Engine.isoDate(new Date())).slice(5, 7))) }, e.bonus) : null;
        draft.useHourly = !!draft.reg && !(cur.payType === 'hourly' && Math.abs(Number(h.rate) - draft.reg.rate) < 0.005 && Math.abs(Number(h.hours) - weekly(draft.reg.hours)) < 0.05);
        draft.useOt = false;
        draft.addBonus = !!draft.bonus && !(cur.bonuses || []).some(b => Math.abs(Number(b.amount) - draft.bonus.amount) < 0.005 && String(b.month) === draft.bonus.month);
        if (draft.reg) draft.useGross = false;
        sheet = UI.sheet({ title: 'Review your pay stub', icon: 'fa-file-invoice-dollar', wide: true, html: reviewHTML(), onClose: () => { draft = null; sheet = null; } });
    }

    // Hours on the stub (for its pay period) → hours a week.
    const weekly = (hours) => Math.round(hours * (draft ? draft.ppy : 26) / 52 * 100) / 100;
    const otMultiple = () => (draft.ot.rate > 0 ? Math.round(draft.ot.rate / draft.reg.rate * 20) / 20 : 1.5);
    // The hourly setup the stub gives (what "Use" saves).
    function stubHourly(y) {
        const out = Object.assign({ rate: 0, hours: 40, otHours: 0, otRate: 1.5, otInBudget: false }, y.hourly || {}, { rate: draft.reg.rate, hours: weekly(draft.reg.hours) });
        if (draft.useOt && draft.ot) Object.assign(out, { otHours: weekly(draft.ot.hours), otRate: otMultiple() });
        return out;
    }

    function reviewHTML() {
        const d = draft, p = App.buildContext().pay, f = d.ppy / 12;
        const stub = d.stub;
        const extra = d.rows.filter(r => r.include && r.group !== 'employer').reduce((a, r) => a + r.amount * f, 0);
        const gross = d.useGross && stub.gross ? stub.gross * f : p.sueldo;
        // Net with this gross (IESS and income tax recomputed) minus the checked deductions.
        const eff = Store.effective(Store.state.activeYear);
        const est = Math.max(0, Engine.payroll(Object.assign({}, eff, { sueldo: gross, payDeductions: [] }, d.useHourly && d.reg ? { payType: 'hourly', hourly: stubHourly(eff) } : {})).netoAntesM - extra);
        const stubMonthly = stub.net ? stub.net * f : null;
        return `<div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                <div class="kpi tone-slate"><span class="kpi-label">Gross on the stub</span><span class="kpi-value">${stub.gross ? money(stub.gross) : '—'}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Deductions</span><span class="kpi-value">${stub.totalDeductions ? money(stub.totalDeductions) : money(d.rows.filter(r => r.group !== 'employer').reduce((a, r) => a + r.amount, 0))}</span></div>
                <div class="kpi tone-emerald"><span class="kpi-label">Net on the stub</span><span class="kpi-value">${stub.net ? money(stub.net) : '—'}</span><span class="kpi-note">${stub.payDate ? 'Paid on ' + esc(stub.payDate) : ''}</span></div>
                <label class="field"><span class="field-label">How often do you get this stub?</span><select class="input" id="scan-ppy" data-change="scan.field">${PPY.map(([n, l]) => `<option value="${n}" ${d.ppy === n ? 'selected' : ''}>${l}</option>`).join('')}</select>${stub.periodDays ? `<span class="help">Period of ${stub.periodDays} days.</span>` : ''}</label>
            </div>
            <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Deduction</th><th>Type</th><th class="num">Per paycheck</th><th class="num">Per month</th><th></th></tr></thead><tbody>
                ${d.rows.map((r, i) => `<tr class="${r.include ? '' : 'opacity-60'}">
                    <td class="text-center"><input type="checkbox" class="w-4 h-4 accent-emerald-600 scan-inc" data-i="${i}" data-change="scan.field" ${r.include ? 'checked' : ''} aria-label="Include"></td>
                    <td><input class="cell-input text-xs font-semibold scan-label" style="min-width:12rem" data-i="${i}" data-change="scan.field" value="${esc(r.label)}"></td>
                    <td><select class="cell-input text-xs scan-group" data-i="${i}" data-change="scan.field">${Object.keys(GROUPS).map(g => `<option value="${g}" ${r.group === g ? 'selected' : ''}>${GROUPS[g]}</option>`).join('')}</select></td>
                    <td><input type="number" step="0.01" min="0" class="cell-input num scan-amount" data-i="${i}" data-change="scan.field" value="${r.amount}"></td>
                    <td class="num">${money(r.amount * f)}</td>
                    <td class="text-[11px] text-slate-500">${COMPUTED[r.kind] ? `The app already calculates it: ${money(COMPUTED[r.kind](p) / f)} per paycheck` : r.ytd ? `Year to date: ${money(r.ytd)}` : ''}</td>
                </tr>`).join('')}
            </tbody></table></div>
            ${stub.gross && !d.reg ? `<label class="check mt-3"><input type="checkbox" id="scan-gross" data-change="scan.field" ${d.useGross ? 'checked' : ''}> Use the stub's gross as my monthly gross pay (${money(stub.gross * f)}; today you have ${money(p.sueldo)})</label>` : ''}
            ${d.reg ? `<label class="check mt-3"><input type="checkbox" id="scan-hourly" data-change="scan.field" ${d.useHourly ? 'checked' : ''}><span>Paid by the hour: ${money(d.reg.rate)} an hour, ${weekly(d.reg.hours)} hours a week</span></label>` : ''}
            ${d.reg && d.ot ? `<label class="check mt-1"><input type="checkbox" id="scan-ot" data-change="scan.field" ${d.useOt ? 'checked' : ''}><span>This overtime is usual: ${weekly(d.ot.hours)} hours a week at ${otMultiple()}× <span class="block text-[11px] font-normal text-slate-500">Leave it unchecked if overtime comes and goes.</span></span></label>` : ''}
            ${d.bonus ? `<label class="check mt-1"><input type="checkbox" id="scan-bonus" data-change="scan.field" ${d.addBonus ? 'checked' : ''}><span>Add this ${money(d.bonus.amount)} bonus to this year's bonuses (already paid)</span></label>` : ''}
            <div class="bs-banner ${stubMonthly === null || Math.abs(stubMonthly - est) < 1 ? 'ok' : 'warn'} mt-3" id="scan-check">${stubMonthly === null ? `With these deductions you'd receive ≈ ${money(est)} a month.` : `Your stub: ≈ ${money(stubMonthly)} a month. With these deductions the app calculates ≈ ${money(est)}.${Math.abs(stubMonthly - est) < 1 ? ' They match!' : ' Check the checked amounts.'}`}</div>
            <p class="help mt-2">The file was read on this device and isn't saved. Only the deduction names and amounts are kept.</p>
            <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn btn-secondary" data-action="scan.cancel">Cancel</button><button type="button" class="btn btn-primary" data-action="scan.save" id="scan-save"><i class="fa-solid fa-check"></i> Save deductions</button></div>`;
    }

    function readReview() {
        const ppy = document.getElementById('scan-ppy');
        if (ppy) draft.ppy = Number(ppy.value);
        UI.$$('.scan-inc').forEach(el => { draft.rows[el.dataset.i].include = el.checked; });
        UI.$$('.scan-label').forEach(el => { draft.rows[el.dataset.i].label = el.value.trim().slice(0, 60) || draft.rows[el.dataset.i].label; });
        UI.$$('.scan-group').forEach(el => { draft.rows[el.dataset.i].group = el.value; });
        UI.$$('.scan-amount').forEach(el => { draft.rows[el.dataset.i].amount = Math.max(0, Fmt.parseNum(el.value, 0)); });
        const g = document.getElementById('scan-gross');
        if (g) draft.useGross = g.checked;
        [['scan-hourly', 'useHourly'], ['scan-ot', 'useOt'], ['scan-bonus', 'addBonus']].forEach(([id, k]) => { const el = document.getElementById(id); if (el) draft[k] = el.checked; });
    }

    UI.register({
        'ded.add': async () => {
            const r = await UI.form({
                title: 'Add a paycheck deduction', confirmText: 'Add',
                fields: [
                    { name: 'name', label: 'Name', placeholder: 'E.g. Life insurance, Child support, 401(k) loan' },
                    { name: 'group', label: 'Type', options: Object.keys(GROUPS).map(g => ({ value: g, label: GROUPS[g] })) },
                    { name: 'monthly', label: 'Monthly amount', type: 'number', step: '0.01', min: 0 }
                ],
                validate: v => !v.name.trim() ? 'Type a name.' : !(v.monthly > 0) ? 'Type an amount greater than 0.' : null
            });
            if (!r) return;
            const c = Importers.classifyDeduction(r.name) || {};
            list().push({ id: Store.nextId(list()), name: r.name.trim().slice(0, 60), group: r.group, kind: c.group === r.group ? c.kind : r.group, pretax: !!c.pretax, monthly: Math.round(r.monthly * 100) / 100 });
            App.changed({ structural: true, step: true });
        },
        'ded.set': (el) => {
            const d = list().find(x => x.id === Number(el.dataset.id));
            if (!d) return;
            const f = el.dataset.field;
            if (f === 'monthly') d.monthly = Math.max(0, Fmt.parseNum(el.value, 0));
            else if (f === 'name') d.name = el.value.trim().slice(0, 60) || d.name;
            else { d.group = el.value; if (d.group !== 'loan') delete d.debtId; }
            if (d.debtId) { const debt = Store.state.debts.find(x => Number(x.id) === Number(d.debtId)); if (debt) debt.monthly = d.monthly; }
            App.changed({ structural: true, step: true });
        },
        'ded.debt': (el) => {
            const d = list().find(x => x.id === Number(el.dataset.id));
            if (!d) return;
            if (el.value) {
                d.debtId = Number(el.value);
                // The payroll pays it: its plan payment is the deduction.
                const debt = Store.state.debts.find(x => Number(x.id) === d.debtId);
                if (debt) debt.monthly = d.monthly;
                UI.toast(`"${debt ? debt.name : ''}" is paid through payroll: it's no longer a budget line.`);
            } else delete d.debtId;
            App.changed({ structural: true, step: true });
        },
        'ded.delete': (el) => {
            const id = Number(el.dataset.id);
            const d = list().find(x => x.id === id);
            App.undoable(`Descuento "${d ? d.name : ''}" quitado`, () => { yd().payDeductions = list().filter(x => x.id !== id); });
        },
        'ded.file': async (el) => {
            const file = el.files && el.files[0];
            if (!file) return;
            const status = (h) => UI.html('ded-status', h);
            status('<i class="fa-solid fa-spinner fa-spin"></i> Reading your pay stub…');
            try {
                const text = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfText(file) : await photoText(file, status);
                status('');
                fromText(text);
            } catch (e) {
                status('<i class="fa-solid fa-triangle-exclamation text-red-600"></i> Couldn\'t read the file (internet is needed the first time). You can add the deductions by hand.');
            } finally { el.value = ''; }
        },
        'scan.field': () => { if (!draft || !sheet) return; readReview(); sheet.body.innerHTML = reviewHTML(); },
        'scan.cancel': () => { if (sheet) sheet.close(); },
        'scan.save': () => {
            if (!draft) return;
            readReview();
            const y = yd(), f = draft.ppy / 12;
            let added = 0, updated = 0;
            draft.rows.filter(r => r.include && r.amount > 0).forEach(r => {
                const monthly = Math.round(r.amount * f * 100) / 100;
                const same = list().find(x => Importers.norm(x.name) === Importers.norm(r.label));
                if (same) { Object.assign(same, { group: r.group, monthly, perPay: r.amount, paysPerYear: draft.ppy }); updated++; }
                else { list().push({ id: Store.nextId(list()), name: r.label, group: r.group, kind: r.kind, pretax: !!r.pretax, monthly, perPay: r.amount, paysPerYear: draft.ppy }); added++; }
            });
            if (draft.useHourly && draft.reg) {
                y.payType = 'hourly';
                y.hourly = stubHourly(y);
                y.sueldo = Math.round(Engine.usGrossPay(y).baseM * 100) / 100;
            } else if (draft.useGross && draft.stub.gross) y.sueldo = Math.round(draft.stub.gross * f * 100) / 100;
            if (draft.addBonus && draft.bonus) {
                y.bonuses = y.bonuses || [];
                y.bonuses.push({ id: Store.nextId(y.bonuses), name: window.I18n ? I18n.t('Bonus') : 'Bonus', amount: draft.bonus.amount, month: draft.bonus.month, inBudget: false });
            }
            if (draft.stub.net) y.lastPaystub = { payDate: draft.stub.payDate, net: draft.stub.net, gross: draft.stub.gross, ppy: draft.ppy };
            sheet.close();
            App.changed({ structural: true, step: true });
            UI.toast([`${added} deduction${added === 1 ? '' : 's'} added.`, updated ? `${updated} deduction${updated === 1 ? '' : 's'} updated.` : ''].filter(Boolean).map(x => (window.I18n ? I18n.t(x) : x)).join(' '), 'ok', { label: 'Undo', className: 'toast-undo', onClick: () => App.undo() });
        }
    });

    window.PayScan = { render, fromText, GROUPS };
})();
