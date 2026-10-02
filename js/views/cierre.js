/* Cierre del mes: once a month ends, a short review — what came in, what went out, the lines
 * where you went over or had money left, the expenses that never got a line — and a decision
 * about what was left over (the debt snowball or a goal). Closing saves the month's numbers and a
 * note ({ closedAt, income, spent, leftover, note } in state.monthCloses['YYYY-MM']). */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    let sheet = null;

    const closes = () => Store.state.monthCloses || (Store.state.monthCloses = {});
    const keyOf = (y, m) => `${y}-${String(m).padStart(2, '0')}`;
    const label = (y, m) => `${Fmt.MONTH_NAMES[m - 1]} ${y}`;

    // Last month, when it had movements and isn't closed yet (for the Overview reminder).
    function pending(today) {
        const d = new Date(today.getFullYear(), today.getMonth() - 1, 1);
        const y = d.getFullYear(), m = d.getMonth() + 1;
        if (closes()[keyOf(y, m)]) return null;
        const has = (Store.state.transactions || []).some(t => String(t.date || '').startsWith(keyOf(y, m)));
        return has ? { y, m, key: keyOf(y, m), label: label(y, m) } : null;
    }

    function review(y, m) {
        const items = Engine.monthItems(Store.effective(y), String(m));
        return Engine.monthReview({ items, transactions: Store.state.transactions, year: y, month: m });
    }

    function html(y, m) {
        const r = review(y, m);
        const done = closes()[r.key];
        const s = Store.state;
        const kpi = (tone, lbl, value, note) => `<div class="kpi ${tone}"><span class="kpi-label">${lbl}</span><span class="kpi-value">${value}</span><span class="kpi-note">${note}</span></div>`;
        const lineList = (list, cls) => list.slice(0, 6).map(l => `<li class="flex justify-between gap-2"><span class="truncate" data-i18n-skip>${esc(l.name)}</span><span class="${cls} font-bold whitespace-nowrap">${money(Math.abs(l.left))}</span></li>`).join('');
        const past = history().filter(h => h.key !== r.key).slice(0, 6);
        const parts = [past.length ? `<div class="flex flex-wrap items-center gap-1.5 mb-3 text-xs"><span class="text-slate-500">Meses cerrados:</span>${past.map(h => { const [hy, hm] = h.key.split('-').map(Number); return `<button type="button" class="quick-chip" data-action="close.open" data-y="${hy}" data-m="${hm}"><i class="fa-solid fa-circle-check text-emerald-600"></i> ${esc(Fmt.MONTH_SHORT[hm - 1])} ${hy} · ${h.leftover >= 0 ? '+' : '−'}${money0(Math.abs(h.leftover))}</button>`; }).join('')}</div>` : ''];
        parts.push(`<div class="grid grid-cols-1 sm:grid-cols-3 gap-3">
            ${kpi('tone-emerald', 'Entró', money0(r.income), 'ingresos registrados')}
            ${kpi('tone-slate', 'Salió', money0(r.spent), `planeaste ${money0(r.planned)}`)}
            ${kpi(r.leftover >= 0 ? 'tone-blue' : 'tone-red', r.leftover >= 0 ? 'Sobró' : 'Faltó', money0(Math.abs(r.leftover)), r.leftover >= 0 ? 'lo que no se gastó' : 'gastaste más de lo que entró')}
        </div>`);
        if (!r.count) parts.push('<p class="help mt-3">No registraste movimientos este mes.</p>');
        parts.push(`<div class="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-4">
            <div class="panel tone-red text-xs"><div class="font-bold mb-1.5"><i class="fa-solid fa-arrow-trend-up"></i> Te pasaste en</div>${r.over.length ? `<ul class="space-y-1">${lineList(r.over, 'text-red-700')}</ul>` : '<p>¡En ningún rubro! 🎉</p>'}</div>
            <div class="panel tone-emerald text-xs"><div class="font-bold mb-1.5"><i class="fa-solid fa-piggy-bank"></i> Te sobró en</div>${r.under.length ? `<ul class="space-y-1">${lineList(r.under, 'text-emerald-700')}</ul>` : '<p>Gastaste todo lo planeado.</p>'}</div>
        </div>`);
        if (r.unassigned.count) parts.push(`<p class="text-xs mt-3"><i class="fa-solid fa-circle-exclamation text-amber-600"></i> ${r.unassigned.count} gasto${r.unassigned.count === 1 ? '' : 's'} sin rubro (${money(r.unassigned.total)}). <a href="#" class="link" data-action="close.unassigned" data-y="${y}" data-m="${m}">Asígnalos</a> para que el mes cuadre.</p>`);
        if (r.over.length) parts.push('<p class="help mt-2">Si te pasas en el mismo rubro varios meses, súbelo en tu presupuesto y baja otro: un plan realista se cumple.</p>');

        // What to do with what was left.
        if (r.leftover > 0.5 && !done) {
            const plan = Engine.debtPayoff(s.debts || [], (s.debtPlan || {}).strategy || 'snowball', 0);
            const target = plan.items.find(i => i.balance > 0);
            const debt = target && (s.debts || []).find(d => d.id === target.id);
            const goals = (s.goals || []).filter(g => (Number(g.target) || 0) > (Number(g.current) || 0));
            parts.push(`<div class="panel tone-blue text-xs mt-4 space-y-2"><div class="font-bold"><i class="fa-solid fa-hand-holding-dollar"></i> ¿Qué hacemos con los ${money(r.leftover)} que sobraron?</div>
                <p>Dale un trabajo a ese dinero antes de que se pierda en el mes siguiente.</p>
                <div class="flex flex-wrap gap-2">
                    ${debt ? `<button type="button" class="btn btn-primary btn-sm" data-action="close.toDebt" data-id="${debt.id}" data-amount="${r.leftover}"><i class="fa-solid fa-snowflake"></i> Abonar a «${esc(debt.name)}»</button>` : ''}
                    ${goals.slice(0, 3).map(g => `<button type="button" class="btn btn-secondary btn-sm" data-action="close.toGoal" data-id="${g.id}" data-amount="${r.leftover}"><i class="fa-solid fa-bullseye"></i> Depositar en «${esc(g.name)}»</button>`).join('')}
                </div></div>`);
        }
        parts.push(`<label class="field mt-4"><span class="field-label">Una nota para tu yo del futuro (opcional)</span>
            <input id="close-note" class="input" maxlength="500" placeholder="Ej: Septiembre trae útiles escolares: subir ese rubro el próximo año." value="${esc(done ? done.note || '' : '')}"></label>`);
        parts.push(`<div class="flex flex-wrap items-center justify-end gap-2 mt-3">
            ${done ? `<span class="text-xs text-emerald-700 font-bold mr-auto"><i class="fa-solid fa-circle-check"></i> Cerrado el ${esc(String(done.closedAt).slice(0, 10))}</span><button type="button" class="btn btn-secondary btn-sm" data-action="close.reopen" data-key="${r.key}">Reabrir</button>` : ''}
            <button type="button" class="btn btn-primary" data-action="close.save" data-y="${y}" data-m="${m}"><i class="fa-solid fa-lock"></i> ${done ? 'Guardar nota' : `Cerrar ${esc(label(y, m))}`}</button>
        </div>`);
        return parts.join('');
    }

    function open(y, m) {
        sheet = UI.sheet({ title: `Cierre de ${label(y, m)}`, icon: 'fa-calendar-check', wide: true, html: html(y, m), onClose: () => { sheet = null; } });
        sheet.y = y; sheet.m = m;
    }
    const refresh = () => { if (sheet) sheet.body.innerHTML = html(sheet.y, sheet.m); };

    // The months already closed, newest first (for the budget card).
    const history = () => Object.keys(closes()).sort().reverse().map(k => Object.assign({ key: k }, closes()[k]));

    UI.register({
        'close.open': (el) => {
            let y = Number(el.dataset.y), m = Number(el.dataset.m);
            if (!y || !m) {
                // From the budget: the month on screen, or last month when the whole year is shown.
                const sel = Store.ui.month, t = new Date();
                if (sel && sel !== 'base') { y = Store.state.activeYear; m = Number(sel); }
                else { const d = new Date(t.getFullYear(), t.getMonth() - 1, 1); y = d.getFullYear(); m = d.getMonth() + 1; }
            }
            open(y, m);
        },
        'close.save': (el) => {
            const y = Number(el.dataset.y), m = Number(el.dataset.m);
            const r = review(y, m);
            const note = (document.getElementById('close-note') || {}).value || '';
            const was = closes()[r.key];
            App.undoable(was ? 'Nota guardada' : `${label(y, m)} cerrado. ¡Un mes más con tu plan!`, () => {
                closes()[r.key] = { closedAt: was ? was.closedAt : new Date().toISOString(), income: r.income, spent: r.spent, leftover: r.leftover, planned: r.planned, note: note.trim().slice(0, 500) };
            });
            if (sheet) sheet.close();
        },
        'close.reopen': (el) => {
            const k = el.dataset.key;
            App.undoable('Mes reabierto', () => { delete closes()[k]; });
            refresh();
        },
        'close.unassigned': (el) => {
            if (sheet) sheet.close();
            Store.ui.txnFilters = { year: el.dataset.y, month: el.dataset.m, type: 'Gasto', category: 'all', member: 'all' };
            App.go('transacciones/lista');
        },
        'close.toDebt': (el) => { UI.run('debt.pay', { id: el.dataset.id, amount: el.dataset.amount }); },
        'close.toGoal': (el) => { UI.run('goal.deposit', { id: el.dataset.id, amount: el.dataset.amount }); }
    });

    window.MonthClose = { pending, open, review, history };
})();
