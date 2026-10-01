/* Presupuesto → Ingresos e Impuestos: payroll (IESS + SRI), décimos and deductions. */
(function () {
    'use strict';
    const { money, pct, esc } = Fmt;

    // ------------------------------------------------------------------ how you get paid
    const WD = ['domingo', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado'];
    const WD_PL = ['domingos', 'lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábados'];
    const ORD = { 1: '1.º', 2: '2.º', 3: '3.º', 4: '4.º', 5: '5.º', '-1': 'último' };
    const EVERY = { 1: 'cada mes', 2: 'cada 2 meses', 3: 'cada 3 meses (trimestral)', 6: 'cada 6 meses (semestral)', 12: 'una vez al año' };
    const list = (xs) => xs.length > 1 ? `${xs.slice(0, -1).join(', ')} y ${xs[xs.length - 1]}` : xs.join('');
    const dayLabel = (iso) => { const d = new Date(iso + 'T12:00'); return `${WD[d.getDay()].slice(0, 3)} ${d.getDate()} ${Fmt.MONTH_SHORT[d.getMonth()].toLowerCase()}`; };

    function describe(sch) {
        if (!sch) return 'Sin configurar';
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

    function renderSummary() {
        const sch = Cash.paySchedule();
        const next = sch ? Engine.nextPayday(sch, new Date()) : null;
        UI.html('pay-summary', sch ? `${esc(describe(sch))}${next ? `<div class="text-xs font-normal text-slate-600">Próximo: ${esc(dayLabel(Engine.isoDate(next.date)))}${next.days === 0 ? ' (hoy)' : ` (en ${next.days} día${next.days === 1 ? '' : 's'})`}</div>` : ''}` : '<span class="text-slate-500 font-normal">Sin configurar</span>');
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
        if (!sch) return '<p class="text-sm text-red-600">Completa los datos: faltan los días o el día de la semana.</p>';
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
                <div class="kpi tone-emerald"><span class="kpi-label">Pagos al año</span><span class="kpi-value" id="pay-per-year">${perYear}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">Cada pago</span><span class="kpi-value">${money(each)}</span><span class="kpi-note">${sch.amount ? 'El monto que escribiste' : 'Tu sueldo neto repartido'}</span></div>
                <div class="kpi tone-slate"><span class="kpi-label">En 12 meses</span><span class="kpi-value">${money(total)}</span><span class="kpi-note">≈ ${money(total / 12)} al mes${ev.some(e => e.name !== 'Día de pago') ? ', décimos incluidos' : ''}</span></div>
            </div>
            <div class="section-label">Próximos pagos</div>
            <ul class="pay-next" id="pay-next">${ev.slice(0, 8).map(e => `<li><span>${esc(dayLabel(e.date))}${e.name !== 'Día de pago' ? ` <span class="badge badge-info">${esc(e.name)}</span>` : ''}</span><strong class="num">+${money(e.amount)}</strong></li>`).join('') || '<li class="help">Sin pagos en los próximos 12 meses.</li>'}</ul>
            ${sch.amount ? '<p class="help mt-2">El presupuesto sigue usando tu sueldo de esta pestaña; este monto solo cambia el calendario y "Seguro para gastar".</p>' : ''}`;
    }

    function editorHTML() {
        const d = draft;
        const wdSel = `<label class="field"><span class="field-label">Día de la semana</span><select class="input" id="ps-weekday" data-change="pay.field">${[1, 2, 3, 4, 5, 6, 0].map(i => `<option value="${i}" ${Number(d.weekday) === i ? 'selected' : ''}>${WD[i].charAt(0).toUpperCase() + WD[i].slice(1)}</option>`).join('')}</select></label>`;
        let extra = '';
        if (d.freq === 'monthly') extra = `
            <label class="field"><span class="field-label">Días del mes</span><input class="input" id="ps-days" data-change="pay.field" value="${esc(d.days)}" placeholder="Ej: 15, 30  (31 = último día)" inputmode="numeric"></label>
            <label class="field"><span class="field-label">Cada cuánto</span><select class="input" id="ps-interval" data-change="pay.field">${[1, 2, 3, 6, 12].map(n => `<option value="${n}" ${Number(d.interval) === n ? 'selected' : ''}>${EVERY[n].charAt(0).toUpperCase() + EVERY[n].slice(1)}</option>`).join('')}</select></label>
            ${Number(d.interval) > 1 ? `<label class="field"><span class="field-label">Un mes en que cobras</span><input type="month" class="input" id="ps-anchor-month" data-change="pay.field" value="${esc(String(d.anchor).slice(0, 7))}"></label>` : ''}
            <label class="field"><span class="field-label">Si cae en sábado o domingo</span><select class="input" id="ps-weekend" data-change="pay.field"><option value="same" ${d.weekend === 'same' ? 'selected' : ''}>Se paga ese mismo día</option><option value="before" ${d.weekend === 'before' ? 'selected' : ''}>Se adelanta al viernes</option><option value="after" ${d.weekend === 'after' ? 'selected' : ''}>Pasa al lunes</option></select></label>`;
        else if (d.freq === 'weekly') extra = wdSel;
        else if (d.freq === 'biweekly') extra = wdSel + `<label class="field"><span class="field-label">Una fecha en que cobraste o cobrarás</span><input type="date" class="input" id="ps-anchor" data-change="pay.field" value="${esc(d.anchor)}"><span class="help">Para saber cuál semana sí y cuál no.</span></label>`;
        else if (d.freq === 'nth') extra = wdSel + `<div class="field"><span class="field-label">¿Cuáles del mes?</span><div class="flex flex-wrap gap-3 pt-1">${[1, 2, 3, 4, -1].map(n => `<label class="check"><input type="checkbox" class="ps-nth" data-n="${n}" data-change="pay.field" ${d.nths.map(Number).includes(n) ? 'checked' : ''}> ${ORD[n]}</label>`).join('')}</div></div>`;
        else extra = `<label class="check pt-6"><input type="checkbox" id="ps-business" data-change="pay.field" ${d.businessDays ? 'checked' : ''}> Solo de lunes a viernes</label>`;
        const sch = scheduleFrom(d);
        return `<div class="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                <label class="field"><span class="field-label">Frecuencia</span><select class="input" id="ps-freq" data-change="pay.field">
                    <option value="monthly" ${d.freq === 'monthly' ? 'selected' : ''}>Días fijos del mes</option>
                    <option value="weekly" ${d.freq === 'weekly' ? 'selected' : ''}>Cada semana</option>
                    <option value="biweekly" ${d.freq === 'biweekly' ? 'selected' : ''}>Cada 2 semanas</option>
                    <option value="nth" ${d.freq === 'nth' ? 'selected' : ''}>Semanas del mes</option>
                    <option value="daily" ${d.freq === 'daily' ? 'selected' : ''}>Todos los días</option>
                </select><span class="help">${{ monthly: 'Ej: 15 y 30, fin de mes, trimestral.', weekly: 'Ej: todos los viernes.', biweekly: 'Ej: un jueves sí y otro no.', nth: 'Ej: el 2.º y 4.º viernes.', daily: 'Ej: jornal diario.' }[d.freq] || ''}</span></label>
                ${extra}
                <label class="field"><span class="field-label"><span>Monto de cada pago (<span class="cur">${esc(Fmt.currency().symbol)}</span>)</span></span><input class="input" id="ps-amount" data-change="pay.field" inputmode="decimal" value="${esc(String(d.amount || ''))}" placeholder="Automático: tu sueldo neto repartido"><span class="help">Déjalo vacío si cobras tu sueldo de esta pestaña.</span></label>
            </div>
            <div class="bs-banner ok mt-3" id="pay-describe"><i class="fa-regular fa-calendar-check"></i> ${esc(describe(sch))}</div>
            <div class="mt-3">${previewHTML(sch)}</div>
            <div class="flex flex-wrap justify-between gap-2 mt-4">
                <button type="button" class="btn btn-ghost btn-sm" data-action="pay.clear">Quitar</button>
                <button type="button" class="btn btn-primary" data-action="pay.save" id="pay-save" ${sch ? '' : 'disabled'}><i class="fa-solid fa-check"></i> Guardar</button>
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

    function update(ctx) {
        const yd = ctx.year, p = ctx.pay;
        renderSummary();
        UI.text('inc-sbu', money(yd.sbu));
        const rows = [
            ['Sueldo bruto mensual', money(p.sueldo), 'text-slate-900'],
            [`Aporte personal IESS (${pct(yd.iessRate, 2)})`, '−' + money(p.iessM), 'text-red-600'],
            ['Deducción de gastos personales (anual, aplicada)', money(p.dedApplied), 'text-blue-700'],
            ['Base imponible anual', money(p.baseImponible), 'text-slate-900'],
            ['Impuesto a la renta anual', money(p.isrAnual), 'text-amber-700'],
            ['Retención mensual en el rol', '−' + money(p.isrM), 'text-red-600']
        ].concat(p.otrosDescuentosM > 0 ? [['Otros descuentos del rol (seguros, préstamos…)', '−' + money(p.otrosDescuentosM), 'text-red-600']] : []);
        UI.html('inc-payroll', rows.map(([k, v, c]) => `<div class="flex justify-between py-2"><dt class="text-slate-600">${k}</dt><dd class="font-bold ${c}">${v}</dd></div>`).join(''));
        UI.text('inc-neto', money(p.netoM));
        if (window.PayScan) PayScan.render(ctx);

        UI.text('inc-cap', money(p.sriCap));
        UI.text('inc-ded-prep', money(p.deductibles.prep));
        UI.text('inc-ded-real', money(p.deductibles.real));
        const ratio = p.sriCap > 0 ? p.deductibles.real / p.sriCap : 1;
        const box = document.getElementById('inc-ded-status');
        let tone, icon, title, text;
        if (p.deductibles.real >= p.sriCap) {
            tone = 'tone-emerald'; icon = 'fa-circle-check text-emerald-600'; title = 'Deducción optimizada';
            text = `Tus gastos deducibles alcanzan el tope legal de ${money(p.sriCap)}.`;
        } else if (ratio >= 0.8) {
            tone = 'tone-amber'; icon = 'fa-triangle-exclamation text-amber-600'; title = 'Cerca del tope';
            text = `Te faltan ${money(p.sriCap - p.deductibles.real)} en gastos deducibles reales para llegar al tope.`;
        } else {
            tone = 'tone-red'; icon = 'fa-circle-info text-red-600'; title = 'Muy por debajo del tope';
            text = `Usas el ${Math.round(ratio * 100)}% del tope. Podrías declarar ${money(p.sriCap - p.deductibles.real)} más en gastos deducibles y pagar menos impuesto. Marca los rubros deducibles en el Presupuesto del Mes.`;
        }
        box.className = `panel ${tone}`;
        box.innerHTML = `<div class="text-xs font-bold text-slate-900"><i class="fa-solid ${icon}"></i> ${title}</div><p class="text-[11px] text-slate-700 mt-1">${text}</p>`;
    }

    UI.register({
        'pay.edit': () => {
            draft = draftFrom(Cash.paySchedule());
            // A sensible "one payday" for every-2-weeks: the next such weekday.
            if (!(Cash.paySchedule() || {}).anchor) { const t = new Date(); t.setDate(t.getDate() + ((Number(draft.weekday) - t.getDay() + 7) % 7)); draft.anchor = Engine.isoDate(t); }
            sheet = UI.sheet({ title: '¿Cómo te pagan?', icon: 'fa-money-check-dollar', wide: true, html: editorHTML(), onClose: () => { sheet = null; draft = null; } });
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
            sheet.close();
            App.changed({ structural: true, step: true });
            UI.toast(`Guardado: ${describe(sch).toLowerCase()}.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
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
