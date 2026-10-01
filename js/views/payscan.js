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
        mandatory: 'Impuestos y aportes', retirement: 'Ahorro para jubilación', insurance: 'Seguro', garnishment: 'Retención judicial (pensión alimenticia…)',
        loan: 'Préstamo', other: 'Otro', employer: 'Lo pone tu empleador (no se descuenta)'
    };
    const PPY = [[52, 'Cada semana'], [26, 'Cada 2 semanas'], [24, 'Dos veces al mes'], [12, 'Una vez al mes']];
    // In Ecuador the app already computes these from the salary.
    const COMPUTED_EC = { iess: (p) => p.iessM, ir: (p) => p.isrM };
    const COMPUTED_US = { federal: (p) => p.fedM, state: (p) => p.stateM, local: (p) => p.localM, ss: (p) => p.ssM, medicare: (p) => p.medM };
    const COMPUTED = new Proxy({}, { get: (_, k) => ((Store.COUNTRY === 'US' ? COMPUTED_US : COMPUTED_EC)[k]) });

    function yd() { return Store.active(); }
    const list = () => yd().payDeductions || (yd().payDeductions = []);

    function usesFor(d) {
        if (d.group === 'retirement') return '<span class="badge badge-ok">Ahorro (Paso 4)</span>';
        if (d.group === 'employer') return d.kind === 'retirement' ? '<span class="badge badge-ok">Suma a tu jubilación</span>' : '<span class="badge badge-muted">Informativo</span>';
        if (d.group === 'loan') {
            const debts = Store.state.debts || [];
            return `<select class="cell-input text-xs" data-change="ded.debt" data-id="${d.id}" aria-label="Deuda que paga"><option value="">Sin vincular a una deuda</option>${debts.map(x => `<option value="${x.id}" ${Number(d.debtId) === Number(x.id) ? 'selected' : ''}>Paga: ${esc(x.name)}</option>`).join('')}</select>`;
        }
        return '<span class="badge badge-muted">Gasto pagado por nómina</span>';
    }

    function render(ctx) {
        const host = document.getElementById('ded-body');
        if (!host) return;
        const p = ctx.pay, items = list();
        const sum = Engine.payDeductionsSummary(yd());
        UI.html('ded-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Neto antes de estos descuentos</span><span class="kpi-value">${money(p.netoAntesM)}</span><span class="kpi-note">al mes</span></div>
            <div class="kpi ${sum.taken > 0 ? 'tone-amber' : 'tone-slate'}"><span class="kpi-label">Descuentos del rol</span><span class="kpi-value">−${money(sum.taken)}</span><span class="kpi-note">${items.filter(d => d.group !== 'employer').length} al mes</span></div>
            <div class="kpi tone-emerald"><span class="kpi-label">Neto que recibes</span><span class="kpi-value" id="ded-net">${money(p.netoM)}</span><span class="kpi-note">Es el ingreso de tu presupuesto</span></div>
            <div class="kpi tone-blue"><span class="kpi-label">Ahorro por nómina</span><span class="kpi-value">${money(sum.retirement)}</span><span class="kpi-note">Cuenta para tu jubilación</span></div>`);
        host.innerHTML = items.length ? items.map(d => `<tr data-row="${d.id}">
                <td><input class="cell-input font-semibold" value="${esc(d.name)}" data-change="ded.set" data-id="${d.id}" data-field="name" aria-label="Nombre"></td>
                <td><select class="cell-input text-xs" data-change="ded.set" data-id="${d.id}" data-field="group" aria-label="Tipo">${Object.keys(GROUPS).map(g => `<option value="${g}" ${d.group === g ? 'selected' : ''}>${GROUPS[g]}</option>`).join('')}</select></td>
                <td><input type="number" class="cell-input num money" step="0.01" min="0" value="${Number(d.monthly) || 0}" data-change="ded.set" data-id="${d.id}" data-field="monthly" aria-label="Al mes"></td>
                <td>${usesFor(d)}</td>
                <td class="text-center"><button class="row-del" data-action="ded.delete" data-id="${d.id}" title="Quitar" aria-label="Quitar"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="5">Sin descuentos además del IESS y el impuesto a la renta. Escanea tu rol de pagos o agrégalos a mano.</td></tr>';
        // US: yearly contribution limits.
        const tax = yd().usTax;
        if (tax) {
            const age = Number(Store.state.retirement.edadActual) || 0;
            const k401 = items.filter(d => d.group === 'retirement' && d.kind !== 'hsa').reduce((a, d) => a + (Number(d.monthly) || 0), 0) * 12;
            const hsa = items.filter(d => d.kind === 'hsa').reduce((a, d) => a + (Number(d.monthly) || 0), 0) * 12;
            const lim = tax.limit401k + (age >= 50 ? tax.catchUp401k : 0);
            const warn = [];
            if (k401 > lim) warn.push(`Tus aportes de jubilación por nómina (${money(k401)} al año) pasan el límite de ${money(lim)} para el 401(k).`);
            if (hsa > tax.limitHSA.family) warn.push(`Tu HSA (${money(hsa)} al año) pasa el límite familiar de ${money(tax.limitHSA.family)}.`);
            UI.html('ded-limits', warn.map(w => `<div class="bs-banner warn mt-2"><i class="fa-solid fa-triangle-exclamation"></i> ${w}</div>`).join(''));
        }
        const last = yd().lastPaystub;
        UI.html('ded-last', last ? (() => {
            const stubMonthly = last.net * last.ppy / 12;
            const diff = stubMonthly - p.netoM;
            return `Último rol leído${last.payDate ? ` (${esc(last.payDate)})` : ''}: neto ${money(last.net)} por pago ≈ ${money(stubMonthly)} al mes. ${Math.abs(diff) < 1 ? '<span class="text-emerald-700 font-bold">Coincide con lo que calcula la app.</span>' : `<span class="text-amber-700 font-bold">La app calcula ${money(p.netoM)}: ${diff > 0 ? 'tu rol dice ' + money(diff) + ' más' : 'tu rol dice ' + money(-diff) + ' menos'} al mes.</span> Revisa tu sueldo bruto y tus descuentos.`}`;
        })() : '');
    }

    // ------------------------------------------------------------------ reading a stub
    function loadScript(src, test) {
        if (test()) return Promise.resolve();
        return new Promise((resolve, reject) => {
            const sc = document.createElement('script');
            sc.src = src; sc.onload = () => (test() ? resolve() : reject(new Error('no lib'))); sc.onerror = () => reject(new Error('sin conexión'));
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
        const worker = await Tesseract.createWorker(['spa', 'eng'], 1, { logger: m => { if (m.status === 'recognizing text') status(`<i class="fa-solid fa-spinner fa-spin"></i> Leyendo la foto… ${Math.round((m.progress || 0) * 100)}%`); } });
        const { data } = await worker.recognize(file);
        await worker.terminate();
        return data.text;
    }

    let draft = null, sheet = null;

    function fromText(text) {
        const p = Importers.parsePaystub(text);
        if (!p.deductions.length && p.net === null) { UI.toast('No encontramos montos de un rol de pagos en ese archivo. Puedes agregar los descuentos a mano.', 'error'); return; }
        const schedule = Cash.paySchedule();
        const ppy = Importers.paysPerYearFromPeriod(p.periodDays) || (schedule ? Math.round(Engine.nominalPaymentsPerYear(schedule)) : 12);
        draft = { stub: p, ppy: [52, 26, 24, 12].includes(ppy) ? ppy : 12, useGross: false, rows: p.deductions.map(d => ({ label: d.label, group: d.group, kind: d.kind, pretax: d.pretax, amount: d.amount, ytd: d.ytd, include: !COMPUTED[d.kind] })) };
        draft.useGross = p.gross > 0 && Math.abs(p.gross * draft.ppy / 12 - (Number(yd().sueldo) || 0)) > 1;
        sheet = UI.sheet({ title: 'Revisa tu rol de pagos', icon: 'fa-file-invoice-dollar', wide: true, html: reviewHTML(), onClose: () => { draft = null; sheet = null; } });
    }

    function reviewHTML() {
        const d = draft, p = App.buildContext().pay, f = d.ppy / 12;
        const stub = d.stub;
        const extra = d.rows.filter(r => r.include && r.group !== 'employer').reduce((a, r) => a + r.amount * f, 0);
        const gross = d.useGross && stub.gross ? stub.gross * f : p.sueldo;
        // Net with this gross (IESS and income tax recomputed) minus the checked deductions.
        const est = Math.max(0, Engine.payroll(Object.assign({}, Store.effective(Store.state.activeYear), { sueldo: gross, payDeductions: [] })).netoAntesM - extra);
        const stubMonthly = stub.net ? stub.net * f : null;
        return `<div class="grid grid-cols-1 sm:grid-cols-4 gap-2 mb-3">
                <div class="kpi tone-slate"><span class="kpi-label">Bruto del rol</span><span class="kpi-value">${stub.gross ? money(stub.gross) : '—'}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Descuentos</span><span class="kpi-value">${stub.totalDeductions ? money(stub.totalDeductions) : money(d.rows.filter(r => r.group !== 'employer').reduce((a, r) => a + r.amount, 0))}</span></div>
                <div class="kpi tone-emerald"><span class="kpi-label">Neto del rol</span><span class="kpi-value">${stub.net ? money(stub.net) : '—'}</span><span class="kpi-note">${stub.payDate ? 'Pago del ' + esc(stub.payDate) : ''}</span></div>
                <label class="field"><span class="field-label">¿Cada cuánto recibes este rol?</span><select class="input" id="scan-ppy" data-change="scan.field">${PPY.map(([n, l]) => `<option value="${n}" ${d.ppy === n ? 'selected' : ''}>${l}</option>`).join('')}</select>${stub.periodDays ? `<span class="help">Período de ${stub.periodDays} días.</span>` : ''}</label>
            </div>
            <div class="table-wrap"><table class="table"><thead><tr><th></th><th>Descuento</th><th>Tipo</th><th class="num">Por pago</th><th class="num">Al mes</th><th></th></tr></thead><tbody>
                ${d.rows.map((r, i) => `<tr class="${r.include ? '' : 'opacity-60'}">
                    <td class="text-center"><input type="checkbox" class="w-4 h-4 accent-emerald-600 scan-inc" data-i="${i}" data-change="scan.field" ${r.include ? 'checked' : ''} aria-label="Incluir"></td>
                    <td><input class="cell-input text-xs font-semibold scan-label" style="min-width:12rem" data-i="${i}" data-change="scan.field" value="${esc(r.label)}"></td>
                    <td><select class="cell-input text-xs scan-group" data-i="${i}" data-change="scan.field">${Object.keys(GROUPS).map(g => `<option value="${g}" ${r.group === g ? 'selected' : ''}>${GROUPS[g]}</option>`).join('')}</select></td>
                    <td><input type="number" step="0.01" min="0" class="cell-input num scan-amount" data-i="${i}" data-change="scan.field" value="${r.amount}"></td>
                    <td class="num">${money(r.amount * f)}</td>
                    <td class="text-[10px] text-slate-500">${COMPUTED[r.kind] ? `Ya lo calcula la app: ${money(COMPUTED[r.kind](p) / f)} por pago` : r.ytd ? `En el año: ${money(r.ytd)}` : ''}</td>
                </tr>`).join('')}
            </tbody></table></div>
            ${stub.gross ? `<label class="check mt-3"><input type="checkbox" id="scan-gross" data-change="scan.field" ${d.useGross ? 'checked' : ''}> Usar el bruto del rol como mi sueldo bruto mensual (${money(stub.gross * f)}; hoy tienes ${money(p.sueldo)})</label>` : ''}
            <div class="bs-banner ${stubMonthly === null || Math.abs(stubMonthly - est) < 1 ? 'ok' : 'warn'} mt-3" id="scan-check">${stubMonthly === null ? `Con estos descuentos recibirías ≈ ${money(est)} al mes.` : `Tu rol: ≈ ${money(stubMonthly)} al mes. Con estos descuentos la app calcula ≈ ${money(est)}.${Math.abs(stubMonthly - est) < 1 ? ' ¡Coinciden!' : ' Revisa los montos marcados.'}`}</div>
            <p class="help mt-2">El archivo se leyó en este dispositivo y no se guarda. Solo se guardan los nombres y montos de los descuentos.</p>
            <div class="flex justify-end gap-2 mt-3"><button type="button" class="btn btn-secondary" data-action="scan.cancel">Cancelar</button><button type="button" class="btn btn-primary" data-action="scan.save" id="scan-save"><i class="fa-solid fa-check"></i> Guardar descuentos</button></div>`;
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
    }

    UI.register({
        'ded.add': async () => {
            const r = await UI.form({
                title: 'Agregar un descuento del rol', confirmText: 'Agregar',
                fields: [
                    { name: 'name', label: 'Nombre', placeholder: 'Ej: Seguro de vida, Pensión alimenticia, Préstamo IESS' },
                    { name: 'group', label: 'Tipo', options: Object.keys(GROUPS).map(g => ({ value: g, label: GROUPS[g] })) },
                    { name: 'monthly', label: 'Monto al mes', type: 'number', step: '0.01', min: 0 }
                ],
                validate: v => !v.name.trim() ? 'Escribe un nombre.' : !(v.monthly > 0) ? 'Escribe un monto mayor a 0.' : null
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
                UI.toast(`"${debt ? debt.name : ''}" se paga por nómina: ya no es un rubro del presupuesto.`);
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
            status('<i class="fa-solid fa-spinner fa-spin"></i> Leyendo tu rol de pagos…');
            try {
                const text = /pdf$/i.test(file.type) || /\.pdf$/i.test(file.name) ? await pdfText(file) : await photoText(file, status);
                status('');
                fromText(text);
            } catch (e) {
                status('<i class="fa-solid fa-triangle-exclamation text-red-600"></i> No se pudo leer el archivo (la primera vez se necesita internet). Puedes agregar los descuentos a mano.');
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
            if (draft.useGross && draft.stub.gross) y.sueldo = Math.round(draft.stub.gross * f * 100) / 100;
            if (draft.stub.net) y.lastPaystub = { payDate: draft.stub.payDate, net: draft.stub.net, gross: draft.stub.gross, ppy: draft.ppy };
            sheet.close();
            App.changed({ structural: true, step: true });
            UI.toast(`${added} descuento${added === 1 ? '' : 's'} agregado${added === 1 ? '' : 's'}${updated ? `, ${updated} actualizado${updated === 1 ? '' : 's'}` : ''}.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    });

    window.PayScan = { render, fromText, GROUPS };
})();
