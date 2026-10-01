/* Presupuesto → Transacciones: log individual purchases/income and see trends. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    const taxonomyFor = (type) => type === 'Ingreso' ? Store.state.taxonomy.income : Store.state.taxonomy.expense;

    function fillCategorySelects(keepParent) {
        const tax = taxonomyFor(document.getElementById('txn-type').value);
        const parentSel = document.getElementById('txn-parent');
        const prev = keepParent || parentSel.value;
        const parents = Object.keys(tax);
        // Income you log is usually extra income (the salary comes from "Tu Sueldo"), so
        // don't start new income on the salary category.
        const first = document.getElementById('txn-type').value === 'Ingreso' && parents.includes('Ingresos Independientes') ? 'Ingresos Independientes' : parents[0];
        // A transaction being edited may use a category deleted since: keep it selectable.
        const opts = prev && keepParent && !parents.includes(prev) ? parents.concat([prev]) : parents;
        parentSel.innerHTML = Views.selectOptions(opts, opts.includes(prev) ? prev : first);
        fillIncomeSelect();
        fillLineSelect();
        fillMemberSelect();
        fillSubSelect();
    }

    // ------------------------------------------------------------------ editing
    // Editing reuses the form above: the pencil loads a transaction into it and the button
    // saves over it instead of adding a new one.
    const FORM_FIELDS = ['txn-description', 'txn-store', 'txn-amount'];
    function setEditing(t) {
        Store.ui.txnEditing = t ? t.id : null;
        const card = document.getElementById('txn-form-card');
        card.classList.toggle('editing', !!t);
        UI.text('txn-form-title', t ? 'Editar Transacción' : 'Registrar Transacción');
        UI.show('txn-cancel', !!t);
        UI.show('txn-repeat-field', !t);
        document.getElementById('txn-submit').innerHTML = t ? '<i class="fa-solid fa-check"></i> Guardar cambios' : '<i class="fa-solid fa-plus"></i> Agregar Transacción';
        UI.$$('#txn-body [data-row]').forEach(r => r.classList.toggle('row-editing', !!t && Number(r.dataset.row) === t.id));
    }

    function clearForm() {
        FORM_FIELDS.forEach(id => { document.getElementById(id).value = ''; });
        document.getElementById('txn-income').value = '';
        document.getElementById('txn-line').value = '';
    }

    // Income lines of the budget (active year) that a new income can be the receipt of.
    function fillIncomeSelect(keep) {
        const isInc = document.getElementById('txn-type').value === 'Ingreso';
        const lines = Store.active().otherIncomes || [];
        UI.show('txn-income-field', isInc && lines.length > 0);
        const sel = document.getElementById('txn-income');
        const prev = keep !== undefined ? String(keep || '') : sel.value;
        sel.innerHTML = Views.selectOptions([{ value: '', label: 'No: es un ingreso extra' }].concat(lines.map(x => ({ value: String(x.id), label: `Sí: ${x.name}` }))), lines.some(x => String(x.id) === prev) ? prev : '');
    }

    function fillMemberSelect(keep) {
        const list = Store.state.members || [];
        UI.show('txn-member-field', list.length > 0);
        const sel = document.getElementById('txn-member');
        const prev = keep !== undefined ? String(keep || '') : (sel.value || String(Store.ui.lastMember || ''));
        sel.innerHTML = `<option value="">—</option>` + list.map(p => `<option value="${p.id}" ${String(p.id) === prev ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    }

    function memberBadge(t) {
        const p = t.memberId && (Store.state.members || []).find(x => x.id === t.memberId);
        return p ? `<span class="member-dot sm" style="background:${esc(p.color)}" title="${esc(p.name)}">${esc(p.name.charAt(0).toUpperCase())}</span>` : '';
    }

    // Budget lines of the transaction's month (its date decides which month's budget).
    function fillLineSelect(keep) {
        const isExp = document.getElementById('txn-type').value !== 'Ingreso';
        UI.show('txn-line-field', isExp);
        const sel = document.getElementById('txn-line');
        const prev = keep !== undefined ? String(keep || '') : sel.value;
        const date = document.getElementById('txn-date').value || new Date().toISOString().slice(0, 10);
        const items = Engine.monthItems(Store.effective(Number(date.slice(0, 4))), String(Number(date.slice(5, 7))));
        sel.innerHTML = `<option value="">Automático (según la categoría)</option>${BudgetSimple.lineOptions(items, prev)}`;
        if (prev && ![...sel.options].some(o => o.value === prev)) sel.value = '';
    }

    function fillSubSelect(keepSub) {
        const tax = taxonomyFor(document.getElementById('txn-type').value);
        let subs = tax[document.getElementById('txn-parent').value] || [];
        if (keepSub && !subs.includes(keepSub)) subs = subs.concat([keepSub]);
        document.getElementById('txn-sub').innerHTML = Views.selectOptions(subs, keepSub || subs[0]);
        payrollHint();
    }

    function payrollHint() {
        const t = { type: document.getElementById('txn-type').value, category: document.getElementById('txn-sub').value };
        UI.show('txn-payroll-hint', t.type === 'Ingreso' && Engine.isPayrollTxn(t));
    }

    function fillFilters(ctx) {
        const f = Store.ui.txnFilters;
        const years = new Set(ctx.state.transactions.map(t => Number(t.date.slice(0, 4))));
        years.add(ctx.today.getFullYear());
        UI.html('txn-f-year', Views.selectOptions([{ value: 'all', label: 'Todos los años' }].concat([...years].sort().map(y => ({ value: y, label: y }))), f.year));
        UI.html('txn-f-month', Views.selectOptions([{ value: 'all', label: 'Todos los meses' }].concat(Fmt.MONTH_NAMES.map((n, i) => ({ value: i + 1, label: n }))), f.month));
        document.getElementById('txn-f-type').value = f.type;
        // Categories already used by past transactions stay filterable even if deleted.
        const cats = new Set([...Object.keys(ctx.state.taxonomy.expense), ...Object.keys(ctx.state.taxonomy.income), ...ctx.state.transactions.map(t => t.parentCategory)]);
        UI.html('txn-f-category', Views.selectOptions([{ value: 'all', label: 'Todas las categorías' }].concat([...cats].sort().map(c => ({ value: c, label: c }))), f.category));
    }

    function renderCategories() {
        const type = document.getElementById('cat-type').value;
        const tax = taxonomyFor(type);
        const parents = Object.keys(tax);
        UI.html('cat-list', parents.length ? parents.map(p => `
            <div class="panel tone-slate bg-white">
                <div class="flex items-center justify-between mb-1.5">
                    <span class="font-bold text-slate-800 text-xs">${esc(p)}</span>
                    <button class="row-del" data-action="cat.deleteParent" data-parent="${esc(p)}" title="Eliminar categoría"><i class="fa-solid fa-trash-can"></i></button>
                </div>
                <div class="flex flex-wrap gap-1.5">${tax[p].map(s => `
                    <span class="inline-flex items-center gap-1 bg-slate-50 border border-slate-300 rounded-full pl-2 pr-1 py-0.5 text-[10px]">${esc(s)}
                        <button class="text-red-400 hover:text-red-700 font-bold px-1" data-action="cat.deleteSub" data-parent="${esc(p)}" data-sub="${esc(s)}" title="Eliminar subcategoría">×</button></span>`).join('') || '<span class="text-slate-400 text-[10px]">(sin subcategorías)</span>'}
                </div>
            </div>`).join('') : '<p class="help">No hay categorías. Agrega una con "+ Nueva".</p>');
    }

    function render(ctx) {
        const dateInput = document.getElementById('txn-date');
        if (!dateInput.value) dateInput.value = ctx.today.toISOString().slice(0, 10);
        fillCategorySelects();
        renderCategories();
        fillFilters(ctx);
        update(ctx);
        // Still editing after switching tabs, or was the transaction removed (e.g. by undo)?
        const editing = ctx.state.transactions.find(t => t.id === Store.ui.txnEditing);
        if (!editing && Store.ui.txnEditing) clearForm();
        setEditing(editing || null);
    }

    function incomeLabel(t) {
        const yd = Store.state.years[Number(t.date.slice(0, 4))];
        const line = yd && (yd.otherIncomes || []).find(x => x.id === t.incomeId);
        return line ? `<span class="block text-[10px] text-emerald-700"><i class="fa-solid fa-link"></i> Recibido de «${esc(line.name)}»</span>` : '';
    }

    // Which budget line each expense counts in (explicit or automatic by category), per month.
    function assignments(ctx) {
        const cache = {};
        return (t) => {
            const y = Number(t.date.slice(0, 4)), m = String(Number(t.date.slice(5, 7)));
            const key = y + '-' + m;
            if (!cache[key]) {
                const items = Engine.monthItems(Store.effective(y), m);
                const spend = Engine.lineSpend(items, ctx.state.transactions, y, m);
                const byTxn = {};
                Object.keys(spend.byLine).forEach(id => spend.byLine[id].txns.forEach(x => { byTxn[x.id] = id; }));
                cache[key] = { items, byTxn };
            }
            const c = cache[key];
            const lineId = c.byTxn[t.id];
            return { items: c.items, lineId, line: c.items.find(i => String(i.id) === lineId), explicit: lineId !== undefined && String(t.budgetLine) === lineId };
        };
    }

    function matchesSearch(t, q) {
        if (!q) return true;
        const hay = [t.description, t.store, t.parentCategory, t.category, t.paymentType, String(t.amount), Number(t.amount).toFixed(2)].join(' ').toLowerCase();
        return q.toLowerCase().split(/\s+/).filter(Boolean).every(w => hay.includes(w));
    }

    function txnItemHTML(t, assignOf) {
        const inc = (t.type || 'Gasto') === 'Ingreso';
        const d = new Date(t.date + 'T00:00:00');
        let chip = '';
        let pending = false;
        if (inc) {
            const yd = Store.state.years[d.getFullYear()];
            const lines = (yd && yd.otherIncomes) || [];
            if (Engine.isPayrollTxn(t)) chip = '<span class="chip-note">Tu sueldo (ya contado)</span>';
            else if (lines.length) chip = `<select class="chip-select ${t.incomeId ? '' : 'auto'}" data-change="txn.assignIncome" data-id="${t.id}" aria-label="Ingreso del presupuesto">
                <option value="">Ingreso extra del mes</option>${lines.map(x => `<option value="${x.id}" ${x.id === t.incomeId ? 'selected' : ''}>${esc(x.name)}</option>`).join('')}</select>`;
            else chip = '<span class="chip-note">Ingreso extra del mes</span>';
        } else {
            const a = assignOf(t);
            pending = !a.lineId;
            const split = Array.isArray(t.splits) && t.splits.length;
            const first = split ? `✂ Dividida en ${t.splits.length} rubro${t.splits.length === 1 ? '' : 's'}` : a.explicit ? 'Automático (por categoría)' : a.lineId ? `${a.line.name} (auto)` : '+ Asignar a un rubro';
            chip = `<select class="chip-select ${split || a.explicit ? '' : a.lineId ? 'auto' : 'empty'}" data-change="txn.assignLine" data-id="${t.id}" aria-label="Rubro del presupuesto">
                <option value="">${esc(first)}</option>${BudgetSimple.lineOptions(a.items, a.explicit && !split ? a.lineId : null)}<option value="__split">✂ Dividir entre rubros…</option></select>`;
        }
        const notes = [];
        if (inc && Engine.isPayrollTxn(t)) notes.push(`<span class="text-amber-700">No se suma (es tu sueldo) · <button type="button" class="mini-btn" data-action="income.countExtra" data-id="${t.id}">Es un ingreso extra</button></span>`);
        if (inc && t.countAsExtra) notes.push('<span class="text-emerald-700">Contado como ingreso extra</span>');
        if (inc && t.incomeId) notes.push(incomeLabel(t));
        return `<div class="txn-item ${Store.ui.txnEditing === t.id ? 'row-editing' : ''}" data-row="${t.id}" ${inc ? '' : `draggable="true" data-txn="${t.id}"`}>
                <div class="txn-date ${inc ? 'inc' : 'exp'} ${pending ? 'pending' : ''}"><span>${Fmt.MONTH_SHORT[d.getMonth()]}</span><b>${d.getDate()}</b></div>
                <div class="txn-main">
                    <div class="txn-desc">${memberBadge(t)}${esc(t.description)}</div>
                    <div class="txn-meta">${[t.store, `${t.parentCategory}${t.category ? ' › ' + t.category : ''}`, t.paymentType].filter(Boolean).map(esc).join(' · ')}</div>
                    ${notes.length ? `<div class="txn-notes">${notes.join(' ')}</div>` : ''}
                </div>
                <div class="txn-amt ${inc ? 'inc' : ''}">${inc ? '+' : '−'}${money(t.amount)}</div>
                <div class="txn-chip">${chip}</div>
                <div class="txn-actions">${t.recurringId ? '<span class="text-purple-500 text-xs px-1" title="Se repite"><i class="fa-solid fa-repeat"></i></span>' : `<button class="row-edit" data-action="txn.repeat" data-id="${t.id}" title="Repetir cada mes/semana/año" aria-label="Repetir"><i class="fa-solid fa-repeat"></i></button>`}<button class="row-edit" data-action="txn.edit" data-id="${t.id}" title="Editar" aria-label="Editar"><i class="fa-solid fa-pen"></i></button><button class="row-del" data-action="txn.delete" data-id="${t.id}" title="Eliminar" aria-label="Eliminar"><i class="fa-solid fa-trash-can"></i></button></div>
            </div>`;
    }

    function update(ctx) {
        const f = Store.ui.txnFilters;
        const q = (Store.ui.txnSearch || '').trim();
        const search = document.getElementById('txn-search');
        if (search && search !== document.activeElement) search.value = q;
        const members = ctx.state.members || [];
        const mf = document.getElementById('txn-f-member');
        UI.show(mf, members.length > 0);
        if (members.length) mf.innerHTML = Views.selectOptions([{ value: 'all', label: 'Todas las personas' }].concat(members.map(p => ({ value: String(p.id), label: p.name })), [{ value: 'none', label: 'Sin persona' }]), f.member || 'all');
        const byMember = (t) => !f.member || f.member === 'all' || (f.member === 'none' ? !t.memberId : String(t.memberId) === f.member);
        const list = Engine.filterTransactions(ctx.state.transactions, f).filter(t => matchesSearch(t, q) && byMember(t))
            .sort((a, b) => b.date.localeCompare(a.date) || b.id - a.id);
        const assignOf = assignments(ctx);
        // Grouped by month, newest first.
        const groups = [];
        list.forEach(t => {
            const key = t.date.slice(0, 7);
            if (!groups.length || groups[groups.length - 1].key !== key) groups.push({ key, items: [] });
            groups[groups.length - 1].items.push(t);
        });
        UI.html('txn-body', groups.length ? groups.map(g => `<div class="txn-month">${Fmt.MONTH_NAMES[Number(g.key.slice(5)) - 1]} ${g.key.slice(0, 4)}</div>` + g.items.map(t => txnItemHTML(t, assignOf)).join('')).join('')
            : `<p class="empty-row text-center text-xs text-slate-400 py-6">${q ? `Nada coincide con "${esc(q)}".` : 'No hay transacciones para este filtro.'}</p>`);

        const inc = list.filter(t => t.type === 'Ingreso').reduce((s, t) => s + Number(t.amount || 0), 0);
        const exp = list.filter(t => (t.type || 'Gasto') === 'Gasto').reduce((s, t) => s + Number(t.amount || 0), 0);
        UI.text('txn-sum-inc', money(inc));
        UI.text('txn-sum-exp', money(exp));
        UI.text('txn-sum-net', money(inc - exp));
        const pending = list.filter(t => (t.type || 'Gasto') === 'Gasto' && !assignOf(t).lineId).length;
        UI.html('txn-unassigned-note', pending ? `<i class="fa-solid fa-circle-exclamation text-amber-600"></i> ${pending} gasto${pending === 1 ? '' : 's'} sin rubro: elige su rubro en el botón punteado para que cuenten en tu presupuesto.` : '');

        updateTrend(ctx);
        renderRecurring(ctx);
        renderTrash(ctx);
    }

    // ------------------------------------------------------------------ recurring
    const FREQ = { weekly: 'Cada semana', biweekly: 'Cada 2 semanas', monthly: 'Cada mes', quarterly: 'Cada 3 meses', semiannual: 'Cada 6 meses', yearly: 'Cada año' };
    const isSubscription = (r) => /suscrip/i.test(r.parentCategory || '') || /netflix|spotify|disney|hbo|prime|youtube|icloud|google one|apple/i.test(r.description || '');

    function renderRecurring(ctx) {
        const recs = (ctx.state.recurring || []).map(r => ({ r, next: Engine.nextOccurrence(r, ctx.today), due: Engine.dueOccurrences(r, ctx.today) }))
            .sort((a, b) => String(a.next).localeCompare(String(b.next)));
        const exp = recs.filter(x => (x.r.type || 'Gasto') === 'Gasto');
        const subs = exp.filter(x => isSubscription(x.r));
        const inc = recs.filter(x => x.r.type === 'Ingreso');
        const per = (list) => list.reduce((a, x) => a + Engine.monthlyCost(x.r), 0);
        UI.html('rec-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Gastos programados</span><span class="kpi-value">${money(per(exp))}<span class="text-xs font-semibold text-slate-500">/mes</span></span><span class="kpi-note">${exp.length} movimiento${exp.length === 1 ? '' : 's'}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Suscripciones</span><span class="kpi-value">${money(per(subs))}<span class="text-xs font-semibold text-slate-500">/mes</span></span><span class="kpi-note">${money0(per(subs) * 12)} al año</span></div>
            <div class="kpi tone-emerald"><span class="kpi-label">Ingresos programados</span><span class="kpi-value">${money(per(inc))}<span class="text-xs font-semibold text-slate-500">/mes</span></span><span class="kpi-note">${inc.length} movimiento${inc.length === 1 ? '' : 's'}</span></div>`);
        UI.html('rec-body', recs.length ? recs.map(({ r, next, due }) => `<tr>
                <td class="whitespace-nowrap text-xs">${next ? esc(next) : '<span class="text-slate-400">Terminó</span>'}${due.length && r.auto === false ? `<span class="block"><button type="button" class="mini-btn" data-action="rec.postNow" data-id="${r.id}">Registrar ${due.length} pendiente${due.length === 1 ? '' : 's'}</button></span>` : ''}</td>
                <td><div class="font-semibold text-xs">${esc(r.description)}${isSubscription(r) ? ' <span class="badge badge-purple">Suscripción</span>' : ''}</div><div class="text-[10px] text-slate-500">${esc(r.parentCategory)}</div></td>
                <td><select class="cell-input text-xs" data-change="rec.freq" data-id="${r.id}">${Object.keys(FREQ).map(k => `<option value="${k}" ${k === r.frequency ? 'selected' : ''}>${FREQ[k]}</option>`).join('')}</select></td>
                <td class="num font-bold ${r.type === 'Ingreso' ? 'text-emerald-700' : ''}">${r.type === 'Ingreso' ? '+' : '−'}${money(r.amount)}</td>
                <td class="num text-xs">${money(Engine.monthlyCost(r))}</td>
                <td class="text-center"><input type="checkbox" class="w-4 h-4 accent-emerald-600" data-change="rec.auto" data-id="${r.id}" ${r.auto === false ? '' : 'checked'} title="Registrar automáticamente"></td>
                <td class="text-center"><button class="row-del" data-action="rec.delete" data-id="${r.id}" title="Dejar de repetir" aria-label="Dejar de repetir"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`).join('') : '<tr class="empty-row"><td colspan="7">Nada programado. Ejemplos: arriendo el 5 de cada mes, Netflix, tu sueldo quincenal.</td></tr>');
    }

    // Post every repeating movement that's due (only those set to automatic unless `ids` given).
    function postDue(ids) {
        const s = Store.state;
        const today = new Date();
        const posted = [];
        (s.recurring || []).forEach(r => {
            if (ids ? !ids.includes(r.id) : r.auto === false) return;
            const dates = Engine.dueOccurrences(r, today);
            dates.forEach(date => {
                const t = Object.assign({}, r, { id: Store.nextId(s.transactions), date, recurringId: r.id });
                ['frequency', 'startDate', 'endDate', 'lastPosted', 'auto'].forEach(k => delete t[k]);
                s.transactions.push(t);
                posted.push(t);
            });
            if (dates.length) r.lastPosted = dates[dates.length - 1];
        });
        return posted;
    }

    // Opening the app: post what came due, and forget deleted items older than 60 days.
    function maintain() {
        const s = Store.state;
        const cutoff = Date.now() - 60 * 86400000;
        const before = (s.trash || []).length;
        s.trash = (s.trash || []).filter(t => !t.deletedAt || new Date(t.deletedAt).getTime() >= cutoff);
        const posted = postDue();
        if (posted.length || s.trash.length !== before) App.changed({ structural: true, step: true });
        if (posted.length) {
            const names = [...new Set(posted.map(t => t.description))].slice(0, 3).join(', ');
            UI.toast(`Se registraron ${posted.length} movimiento${posted.length === 1 ? '' : 's'} programado${posted.length === 1 ? '' : 's'}: ${names}${posted.length > 3 ? '…' : ''}.`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        }
    }
    window.Recurring = { maintain, postDue };

    // ------------------------------------------------------------------ deleted bin
    function renderTrash(ctx) {
        const trash = (ctx.state.trash || []).slice().sort((a, b) => String(b.deletedAt).localeCompare(String(a.deletedAt)));
        UI.text('trash-count', trash.length);
        UI.html('trash-body', trash.length ? `<div class="space-y-1">${trash.map(t => `<div class="flex items-center justify-between gap-2 text-xs bg-white rounded-lg px-2 py-1.5">
                <span class="min-w-0 truncate"><strong>${esc(t.description)}</strong> · ${esc(t.date)} · ${(t.type || 'Gasto') === 'Ingreso' ? '+' : '−'}${money(t.amount)}</span>
                <span class="flex gap-2 shrink-0"><button type="button" class="mini-btn" data-action="trash.restore" data-id="${t.id}" data-deleted="${esc(t.deletedAt)}">Recuperar</button><button type="button" class="mini-btn text-red-600" data-action="trash.purge" data-id="${t.id}" data-deleted="${esc(t.deletedAt)}">Borrar</button></span>
            </div>`).join('')}</div><button type="button" class="mini-btn text-red-600 mt-2" data-action="trash.empty">Vaciar</button>` : '<p class="help">Nada por aquí.</p>');
    }

    // ------------------------------------------------------------------ trend
    const COUNTS = { week: [8, 12, 26, 52], month: [6, 12, 24, 36], year: [3, 5, 10] };
    const DEFAULT_COUNT = { week: 12, month: 12, year: 5 };
    // How far ahead the projection goes, per period.
    const AHEAD = { week: [0, 4, 8, 13, 26], month: [0, 3, 6, 12, 24], year: [0, 1, 2, 3, 5] };
    const DEFAULT_AHEAD = { week: 8, month: 12, year: 2 };
    const SERIES = { income: { label: 'Ingresos', color: '#1baf7a' }, expense: { label: 'Gastos', color: '#2a78d6' } };

    function periodLabel(start, period) {
        const d = new Date(start + 'T00:00:00');
        if (period === 'year') return String(d.getFullYear());
        if (period === 'month') return `${Fmt.MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`;
        return `${d.getDate()} ${Fmt.MONTH_SHORT[d.getMonth()]}`;
    }

    // Expected per month from history: the average of the last 3 complete months.
    function historyMonthlyExpense(transactions, today) {
        const t = new Date(today);
        let total = 0;
        for (let i = 1; i <= 3; i++) {
            const d = new Date(t.getFullYear(), t.getMonth() - i, 1);
            const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
            total += (transactions || []).filter(x => (x.type || 'Gasto') === 'Gasto' && String(x.date).startsWith(k)).reduce((a, x) => a + (Number(x.amount) || 0), 0);
        }
        return total / 3;
    }

    // The future part of the trend: next period up to `ahead` periods.
    function trendForecast(tr, today) {
        const cur = Engine.periodStart(new Date(today), tr.period);
        const from = Engine.shiftPeriod(cur, tr.period, 1);
        const endStart = Engine.shiftPeriod(cur, tr.period, tr.ahead + 1);
        const to = new Date(endStart.getFullYear(), endStart.getMonth(), endStart.getDate() - 1);
        const inp = Cash.forecastInputs(Engine.isoDate(from), Engine.isoDate(to));
        if (tr.basis === 'history') {
            const avg = historyMonthlyExpense(Store.state.transactions, today);
            Object.keys(inp.monthly).forEach(k => { inp.monthly[k] = Object.assign({}, inp.monthly[k], { expense: avg, savings: 0, debt: 0 }); });
        }
        const rows = Engine.projectFlows({ from: Engine.isoDate(from), to: Engine.isoDate(to), period: tr.period, events: inp.events, monthly: inp.monthly });
        // In the trend, "gastos" are all money going out (spending + savings deposits + debt payments), as logged.
        return rows.map(r => ({ start: r.start, income: r.income, expense: r.expense + r.savings + r.debt, spending: r.expense, savings: r.savings, debt: r.debt }));
    }

    function updateTrend(ctx) {
        const tr = Store.ui.trend = Object.assign({ period: 'month', count: 12, show: 'both', category: 'all', basis: 'plan' }, Store.ui.trend);
        if (!COUNTS[tr.period].includes(tr.count)) tr.count = DEFAULT_COUNT[tr.period];
        if (!AHEAD[tr.period].includes(tr.ahead)) tr.ahead = DEFAULT_AHEAD[tr.period];
        UI.$$('[data-action="trend.period"]').forEach(b => b.classList.toggle('active', b.dataset.period === tr.period));
        const unit = { week: ['semana', 'semanas'], month: ['mes', 'meses'], year: ['año', 'años'] }[tr.period];
        UI.html('trend-count', COUNTS[tr.period].map(n => `<option value="${n}" ${n === tr.count ? 'selected' : ''}>Últimos ${n} ${unit[1]}</option>`).join(''));
        UI.html('trend-ahead', AHEAD[tr.period].map(n => `<option value="${n}" ${n === tr.ahead ? 'selected' : ''}>${n ? `Próximos ${n} ${n === 1 ? unit[0] : unit[1]}` : 'Sin proyección'}</option>`).join(''));
        document.getElementById('trend-show').value = tr.show;
        document.getElementById('trend-basis').value = tr.basis;
        const cats = [...new Set(ctx.state.transactions.map(t => t.parentCategory))].sort();
        UI.html('trend-category', Views.selectOptions([{ value: 'all', label: 'Todas las categorías' }].concat(cats.map(c => ({ value: c, label: c }))), tr.category));

        const rows = Engine.periodSeries(ctx.state.transactions, { period: tr.period, count: tr.count, end: ctx.today, category: tr.category });
        // The projection is for everything (it comes from your plan, not from categories).
        const projecting = tr.ahead > 0 && tr.category === 'all';
        const future = projecting ? trendForecast(tr, ctx.today) : [];
        UI.show('trend-basis', projecting);
        UI.html('trend-note', tr.ahead > 0 && tr.category !== 'all' ? 'La proyección se muestra con "Todas las categorías".'
            : projecting ? `Líneas punteadas: lo que esperas según ${tr.basis === 'history' ? 'tu historial (promedio de los últimos 3 meses)' : 'tu presupuesto'}, tu sueldo en tus días de pago${Cash.paySchedule() ? '' : ' (dinos cómo te pagan en Ingresos)'} y tus ingresos que se repiten.` : '');
        const any = rows.some(r => r.count > 0) || future.length > 0;
        UI.show('txn-trend-empty', !any);
        UI.show(document.getElementById('txn-trend-chart').parentElement, any);
        const keys = tr.show === 'both' ? ['income', 'expense'] : [tr.show];
        const labels = rows.map(r => periodLabel(r.start, tr.period)).concat(future.map(r => periodLabel(r.start, tr.period)));
        const nowIdx = rows.length - 1;
        if (any) {
            const datasets = [];
            keys.forEach(k => {
                datasets.push({ label: SERIES[k].label, data: rows.map(r => r[k]).concat(future.map(() => null)), borderColor: SERIES[k].color, backgroundColor: SERIES[k].color + '1a', borderWidth: 2, pointRadius: labels.length > 30 ? 0 : 4, pointHoverRadius: 6, tension: .3, cubicInterpolationMode: 'monotone', fill: keys.length === 1 && !future.length });
                if (future.length) datasets.push({ label: `${SERIES[k].label} (proyección)`, data: rows.map((r, i) => (i === nowIdx ? r[k] : null)).concat(future.map(r => r[k])), borderColor: SERIES[k].color, borderDash: [6, 4], borderWidth: 2, pointRadius: labels.length > 30 ? 0 : 3, pointStyle: 'circle', backgroundColor: '#ffffff00', pointHoverRadius: 6, tension: .3, cubicInterpolationMode: 'monotone', fill: false, spanGaps: false });
            });
            UI.chart('txn-trend-chart', {
                type: 'line',
                data: { labels, datasets },
                options: { interaction: { mode: 'index', intersect: false }, plugins: { legend: { display: datasets.length > 1 }, todayLine: { index: future.length ? nowIdx : -1, label: 'Hoy' }, tooltip: { filter: (c) => c.raw !== null } } }
            });
        }
        // Headline numbers for the selected window.
        const exp = rows.map(r => r.expense);
        const avg = exp.reduce((a, b) => a + b, 0) / (rows.length || 1);
        const maxI = exp.indexOf(Math.max(...exp));
        const last = exp[exp.length - 1] || 0, prev = exp[exp.length - 2] || 0;
        const change = prev > 0 ? (last - prev) / prev : null;
        const fIn = future.reduce((a, r) => a + r.income, 0), fOut = future.reduce((a, r) => a + r.expense, 0);
        UI.html('trend-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">Gasto promedio por ${unit[0]}</span><span class="kpi-value">${money(avg)}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">${unit[0] === 'mes' ? 'Mes' : unit[0] === 'año' ? 'Año' : 'Semana'} de mayor gasto</span><span class="kpi-value">${exp[maxI] > 0 ? money(exp[maxI]) : '—'}</span><span class="kpi-note">${exp[maxI] > 0 ? labels[maxI] : 'Sin gastos'}</span></div>
            <div class="kpi ${change === null ? 'tone-slate' : change > 0.1 ? 'tone-red' : change < -0.1 ? 'tone-emerald' : 'tone-slate'}"><span class="kpi-label">Este ${unit[0]} vs. el anterior</span><span class="kpi-value">${change === null ? '—' : (change > 0 ? '+' : '') + Math.round(change * 100) + '%'}</span><span class="kpi-note">${money(last)} vs. ${money(prev)}${tr.period !== 'year' ? ' <span>(el actual aún no termina)</span>' : ''}</span></div>
            ${future.length ? `<div class="kpi ${fIn - fOut < -0.005 ? 'tone-red' : 'tone-blue'}" id="trend-future-kpi"><span class="kpi-label">Próximos ${tr.ahead} ${tr.ahead === 1 ? unit[0] : unit[1]} (proyección)</span><span class="kpi-value">${Math.abs(fIn - fOut) < 0.005 ? '' : fIn - fOut < 0 ? '−' : '+'}${money(Math.abs(fIn - fOut))}</span><span class="kpi-note">Entran ${money(fIn)} · salen ${money(fOut)}</span></div>` : ''}`);
        UI.html('trend-table', future.slice().reverse().map(r => `<tr class="trend-future"><td>${periodLabel(r.start, tr.period)} <span class="badge badge-info">proyección</span></td><td class="num">${money(r.income)}</td><td class="num">${money(r.expense)}</td><td class="num ${r.income - r.expense < 0 ? 'text-red-600' : ''}">${money(r.income - r.expense)}</td></tr>`).join('')
            + rows.slice().reverse().map((r, i) => `<tr><td>${labels[rows.length - 1 - i]}</td><td class="num">${money(r.income)}</td><td class="num">${money(r.expense)}</td><td class="num ${r.income - r.expense < 0 ? 'text-red-600' : ''}">${money(r.income - r.expense)}</td></tr>`).join(''));
        renderBalances(ctx, tr);
    }

    // Month-end balances ahead: cash, savings & investments, debts.
    const BAL = { cash: { label: 'Efectivo (cuentas corrientes)', color: '#2a78d6' }, savings: { label: 'Ahorros e inversiones', color: '#1baf7a' }, debts: { label: 'Deudas', color: '#eb6834' } };
    function renderBalances(ctx, tr) {
        const months = tr.ahead <= 0 ? 0 : tr.period === 'month' ? tr.ahead : tr.period === 'year' ? tr.ahead * 12 : Math.max(1, Math.ceil(tr.ahead * 7 / 30.4));
        const card = document.getElementById('bal-forecast');
        if (!card) return;
        UI.show('bal-forecast-empty', months === 0);
        UI.show('bal-forecast-body', months > 0);
        if (!months) return;
        const s = ctx.state, t = ctx.today;
        const from = new Date(t.getFullYear(), t.getMonth() + 1, 1), to = new Date(t.getFullYear(), t.getMonth() + 1 + months, 0);
        const inp = Cash.forecastInputs(Engine.isoDate(from), Engine.isoDate(to));
        const flows = Engine.projectFlows({ from: Engine.isoDate(from), to: Engine.isoDate(to), period: 'month', events: inp.events, monthly: inp.monthly });
        const cash = Engine.cashNow(s.accounts, s.transactions, t);
        const accts = s.accounts || [];
        const savings0 = accts.filter(a => a.kind === 'ahorros').reduce((a, x) => a + (Number(x.balance) || 0), 0) + ctx.polizasCapital + Engine.holdingsValue(s.holdings);
        const debts0 = (s.debts || []).reduce((a, d) => a + Math.max(0, Number(d.balance) || 0), 0);
        const pts = Engine.projectBalances({ start: { cash: cash ? cash.total : 0, savings: savings0, debts: debts0 }, months: flows.map(f => Object.assign({ key: f.start.slice(0, 7) }, f)), rate: Number(ctx.year.tasa) || 0, debtHistory: ctx.debts.history || [] });
        const labels = ['Hoy'].concat(pts.map(p => { const d = new Date(p.key + '-01T00:00'); return `${Fmt.MONTH_SHORT[d.getMonth()]} ${String(d.getFullYear()).slice(2)}`; }));
        const start = { cash: cash ? cash.total : 0, savings: savings0, debts: debts0 };
        UI.chart('bal-forecast-chart', {
            type: 'line',
            data: { labels, datasets: Object.keys(BAL).map(k => ({ label: BAL[k].label, data: [start[k]].concat(pts.map(p => p[k])), borderColor: BAL[k].color, backgroundColor: BAL[k].color, borderWidth: 2, borderDash: [6, 4], pointRadius: labels.length > 30 ? 0 : 3, pointHoverRadius: 6, tension: .25, cubicInterpolationMode: 'monotone', fill: false })) },
            options: { interaction: { mode: 'index', intersect: false }, plugins: { todayLine: { index: 0, label: 'Hoy' } } }
        });
        const end = pts[pts.length - 1];
        const net0 = start.cash + start.savings - start.debts;
        UI.html('bal-forecast-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label"><i class="safe-dot" style="background:${BAL.cash.color}"></i>Efectivo en ${labels[labels.length - 1]}</span><span class="kpi-value">${money(end.cash)}</span><span class="kpi-note">Hoy ${money(start.cash)}${cash ? '' : ' (agrega tus saldos en Patrimonio → Cuentas)'}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label"><i class="safe-dot" style="background:${BAL.savings.color}"></i>Ahorros e inversiones</span><span class="kpi-value">${money(end.savings)}</span><span class="kpi-note">Hoy ${money(start.savings)}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label"><i class="safe-dot" style="background:${BAL.debts.color}"></i>Deudas</span><span class="kpi-value">${money(end.debts)}</span><span class="kpi-note">Hoy ${money(start.debts)}</span></div>
            <div class="kpi ${end.net >= net0 ? 'tone-emerald' : 'tone-red'}"><span class="kpi-label">Lo que tendrías (neto)</span><span class="kpi-value">${money(end.net)}</span><span class="kpi-note">${end.net >= net0 ? '+' : '−'}${money(Math.abs(end.net - net0))} vs. hoy</span></div>`);
        UI.html('bal-forecast-table', [['Hoy', start]].concat(pts.map((p, i) => [labels[i + 1], p])).map(([l, p]) => `<tr><td>${l}</td><td class="num">${money(p.cash)}</td><td class="num">${money(p.savings)}</td><td class="num">${money(p.debts)}</td></tr>`).join(''));
    }

    // Fill the form from elsewhere (e.g. a receipt photo) and let the person review it.
    function prefill(v) {
        App.go('presupuesto/transacciones');
        const get = (id) => document.getElementById(id);
        setEditing(null);
        get('txn-type').value = v.type || 'Gasto';
        fillCategorySelects(v.parent);
        fillSubSelect(v.sub);
        if (v.description !== undefined) get('txn-description').value = v.description;
        if (v.store !== undefined) get('txn-store').value = v.store;
        if (v.amount !== undefined) get('txn-amount').value = v.amount;
        if (v.date) { get('txn-date').value = v.date; fillLineSelect(); }
        if (v.budgetLine) fillLineSelect(v.budgetLine);
        get('txn-form-card').scrollIntoView({ block: 'start' });
        (v.amount ? get('txn-description') : get('txn-amount')).focus();
        UI.toast('Revisa los datos y toca "Agregar Transacción" para guardarla.');
    }
    // Typed by hand but the bank file already brought it in? Say so right away, with undo.
    function warnIfImported(t) {
        const imported = Store.state.transactions.filter(x => x.id !== t.id && (x.importRef || x.source === 'csv' || x.source === 'sri'));
        const m = Importers.findMatch(t, imported, { days: 4 });
        if (!m) return false;
        UI.toast(`Ojo: ya importaste ${money(m.txn.amount)} el ${m.txn.date} («${m.txn.description}»). Si es el mismo gasto, deshazlo para no contarlo dos veces.`, 'warn', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
        return true;
    }

    window.TxnForm = { prefill, warnIfImported };

    UI.register({
        // A matching automatic rule picks the category (and line) while typing a new one.
        'txn.descChanged': () => {
            if (Store.ui.txnEditing) return;
            const get = (id) => document.getElementById(id);
            const rule = Importers.applyRules(Store.state.rules, `${get('txn-description').value} ${get('txn-store').value}`);
            if (!rule) return;
            const tax = taxonomyFor(get('txn-type').value);
            if (!tax[rule.category]) return;
            fillCategorySelects(rule.category);
            if (rule.budgetLine && get('txn-type').value !== 'Ingreso') fillLineSelect(rule.budgetLine);
            if (rule.rename) get('txn-description').value = rule.rename;
            UI.toast(`Regla «${rule.contains}»: ${rule.rename ? `«${rule.rename}», ` : ''}categoría ${rule.category}.`);
        },
        'txn.typeChanged': () => fillCategorySelects(),
        'txn.parentChanged': () => { fillSubSelect(); fillLineSelect(); },
        'txn.repeat': async (el) => {
            const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id));
            if (!t) return;
            const r = await UI.form({ title: `Repetir "${t.description}"`, message: `Desde el ${t.date}. Se registrará sola cada vez que toque.`, fields: [{ name: 'freq', label: 'Frecuencia', options: Object.keys(FREQ).map(k => ({ value: k, label: FREQ[k] })) }], confirmText: 'Repetir' });
            if (!r) return;
            const recs = Store.state.recurring || (Store.state.recurring = []);
            const rec = Object.assign({}, t, { id: Store.nextId(recs), frequency: r.freq, startDate: t.date, lastPosted: t.date, auto: true });
            ['date', 'recurringId', 'invoice', 'source'].forEach(k => delete rec[k]);
            recs.push(rec);
            t.recurringId = rec.id;
            const posted = postDue([rec.id]);
            App.changed({ structural: true, step: true });
            UI.toast(`"${t.description}" se repetirá ${FREQ[r.freq].toLowerCase()}.${posted.length ? ` Se registraron ${posted.length} pendiente${posted.length === 1 ? '' : 's'}.` : ''}`);
        },
        'rec.auto': (el) => {
            const r = (Store.state.recurring || []).find(x => x.id === Number(el.dataset.id));
            if (!r) return;
            r.auto = el.checked;
            if (r.auto) postDue([r.id]);
            App.changed({ structural: true, step: true });
        },
        'rec.freq': (el) => {
            const r = (Store.state.recurring || []).find(x => x.id === Number(el.dataset.id));
            if (!r) return;
            r.frequency = el.value;
            App.changed({ structural: true, step: true });
        },
        'rec.postNow': (el) => {
            const posted = postDue([Number(el.dataset.id)]);
            App.changed({ structural: true, step: true });
            UI.toast(`${posted.length} movimiento${posted.length === 1 ? '' : 's'} registrado${posted.length === 1 ? '' : 's'}.`);
        },
        'rec.delete': (el) => {
            const id = Number(el.dataset.id);
            const r = (Store.state.recurring || []).find(x => x.id === id);
            if (!r) return;
            // Past transactions stay; it just stops repeating.
            App.undoable(`"${r.description}" ya no se repite`, () => { Store.state.recurring = Store.state.recurring.filter(x => x.id !== id); });
        },
        'trash.restore': (el) => {
            const s = Store.state;
            const i = (s.trash || []).findIndex(t => t.id === Number(el.dataset.id) && t.deletedAt === el.dataset.deleted);
            if (i < 0) return;
            const t = Object.assign({}, s.trash[i]);
            delete t.deletedAt;
            if (s.transactions.some(x => x.id === t.id)) t.id = Store.nextId(s.transactions);
            s.transactions.push(t);
            s.trash.splice(i, 1);
            App.changed({ structural: true, step: true });
            UI.toast(`"${t.description}" recuperada.`);
        },
        'trash.purge': (el) => {
            const s = Store.state;
            s.trash = (s.trash || []).filter(t => !(t.id === Number(el.dataset.id) && t.deletedAt === el.dataset.deleted));
            App.changed({ structural: true, step: true });
        },
        'trash.empty': () => {
            App.undoable('Papelera vaciada', () => { Store.state.trash = []; });
        },
        'txn.search': (el) => { Store.ui.txnSearch = el.value; App.update(); },
        'trend.period': (el) => { Store.ui.trend.period = el.dataset.period; Store.ui.trend.count = DEFAULT_COUNT[el.dataset.period]; Store.ui.trend.ahead = DEFAULT_AHEAD[el.dataset.period]; App.update(); },
        'trend.ahead': (el) => { Store.ui.trend.ahead = Number(el.value); App.update(); },
        'trend.basis': (el) => { Store.ui.trend.basis = el.value; App.update(); },
        'trend.count': (el) => { Store.ui.trend.count = Number(el.value); App.update(); },
        'trend.show': (el) => { Store.ui.trend.show = el.value; App.update(); },
        'trend.category': (el) => { Store.ui.trend.category = el.value; App.update(); },
        'txn.assignIncome': (el) => {
            const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id));
            if (!t) return;
            if (el.value) t.incomeId = Number(el.value); else delete t.incomeId;
            App.changed({ structural: true, step: true });
        },
        'txn.subChanged': () => payrollHint(),
        'txn.dateChanged': () => fillLineSelect(),
        'txn.filter': () => {
            Store.ui.txnFilters = {
                year: document.getElementById('txn-f-year').value,
                month: document.getElementById('txn-f-month').value,
                type: document.getElementById('txn-f-type').value,
                category: document.getElementById('txn-f-category').value,
                member: document.getElementById('txn-f-member').value || 'all'
            };
            App.update();
        },
        'txn.add': () => {
            const get = (id) => document.getElementById(id);
            const description = get('txn-description').value.trim();
            const amount = Fmt.parseNum(get('txn-amount').value, 0);
            if (!description || amount <= 0) {
                UI.toast('Escribe una descripción y un monto mayor a $0.', 'error');
                (description ? get('txn-amount') : get('txn-description')).focus();
                return;
            }
            const s = Store.state;
            const values = {
                type: get('txn-type').value,
                description,
                store: get('txn-store').value.trim(),
                parentCategory: get('txn-parent').value,
                category: get('txn-sub').value,
                amount,
                date: get('txn-date').value || new Date().toISOString().slice(0, 10),
                paymentType: get('txn-payment').value,
                incomeId: get('txn-type').value === 'Ingreso' && get('txn-income').value ? Number(get('txn-income').value) : undefined,
                budgetLine: get('txn-type').value !== 'Ingreso' && get('txn-line').value ? get('txn-line').value : undefined,
                memberId: get('txn-member').value ? Number(get('txn-member').value) : undefined
            };
            Store.ui.lastMember = values.memberId || null;
            const editing = s.transactions.find(t => t.id === Store.ui.txnEditing);
            if (editing) {
                Object.assign(editing, values);
                if (!values.incomeId) delete editing.incomeId;
                if (!values.budgetLine) delete editing.budgetLine;
                if (!values.memberId) delete editing.memberId;
                setEditing(null);
                clearForm();
                App.changed({ structural: true, step: true });
                UI.toast(`Transacción "${description}" actualizada`, 'ok', { label: 'Deshacer', className: 'toast-undo', onClick: () => App.undo() });
                const row = document.querySelector(`#txn-body tr[data-row="${editing.id}"]`);
                if (row) { row.scrollIntoView({ block: 'center' }); row.classList.add('flash'); setTimeout(() => row.classList.remove('flash'), 1600); }
                return;
            }
            const repeat = get('txn-repeat').value;
            const todayISO = Engine.isoDate(new Date());
            if (repeat) {
                // A repeating movement: posted now if it's for today or earlier, otherwise scheduled.
                const recs = s.recurring || (s.recurring = []);
                const rec = Object.assign({ id: Store.nextId(recs), frequency: repeat, startDate: values.date, auto: true }, values);
                delete rec.date;
                recs.push(rec);
                get('txn-repeat').value = '';
                if (values.date > todayISO) {
                    clearForm();
                    App.changed({ structural: true, step: true });
                    UI.toast(`Programado: "${description}" el ${values.date} y luego ${FREQ[repeat].toLowerCase()}.`);
                    return;
                }
                rec.lastPosted = values.date;
                values.recurringId = rec.id;
            } else if (values.date > todayISO) {
                UI.toast('Registrada con fecha futura. Para que se repita, elige una opción en "Repetir".', 'warn');
            }
            const added = Object.assign({ id: Store.nextId(s.transactions), createdAt: new Date().toISOString() }, values);
            s.transactions.push(added);
            clearForm();
            App.changed({ structural: true, step: true });
            if (!warnIfImported(added)) UI.toast(repeat ? `"${description}" registrada y programada ${FREQ[repeat].toLowerCase()}.` : `Transacción de ${money(amount)} registrada`);
            get('txn-description').focus();
        },
        'txn.edit': (el) => {
            const t = Store.state.transactions.find(x => x.id === Number(el.dataset.id));
            if (!t) return;
            const get = (id) => document.getElementById(id);
            get('txn-type').value = t.type || 'Gasto';
            fillCategorySelects(t.parentCategory);
            fillSubSelect(t.category);
            fillIncomeSelect(t.incomeId);
            get('txn-date').value = t.date || '';
            fillLineSelect(t.budgetLine);
            fillMemberSelect(t.memberId);
            get('txn-description').value = t.description || '';
            get('txn-store').value = t.store || '';
            get('txn-amount').value = Number(t.amount) || '';
            get('txn-date').value = t.date || '';
            const pay = get('txn-payment');
            if (t.paymentType && ![...pay.options].some(o => o.value === t.paymentType)) pay.add(new Option(t.paymentType, t.paymentType));
            pay.value = t.paymentType || pay.options[0].value;
            setEditing(t);
            document.getElementById('txn-form-card').scrollIntoView({ block: 'start', behavior: 'smooth' });
            get('txn-description').focus();
        },
        'txn.cancelEdit': () => {
            setEditing(null);
            clearForm();
        },
        'txn.delete': (el) => {
            const id = Number(el.dataset.id);
            if (Store.ui.txnEditing === id) { setEditing(null); clearForm(); }
            App.undoable('Transacción eliminada (está en "Eliminadas recientemente")', () => {
                const s = Store.state;
                const t = s.transactions.find(x => x.id === id);
                if (t) (s.trash || (s.trash = [])).push(Object.assign({}, t, { deletedAt: new Date().toISOString() }));
                s.transactions = s.transactions.filter(x => x.id !== id);
            });
        },
        'txn.renderCategories': () => renderCategories(),
        'txn.addParent': async () => {
            const type = document.getElementById('txn-type').value;
            const tax = taxonomyFor(type);
            const r = await UI.form({
                title: `Nueva categoría de ${type === 'Ingreso' ? 'ingreso' : 'gasto'}`,
                fields: [{ name: 'name', label: 'Nombre', placeholder: 'Ej: Deportes' }],
                confirmText: 'Crear',
                validate: v => !v.name.trim() ? 'Escribe un nombre.' : tax[v.name.trim()] ? 'Esa categoría ya existe.' : null
            });
            if (!r) return;
            tax[r.name.trim()] = [];
            App.changed({ step: true });
            fillCategorySelects(r.name.trim());
            renderCategories();
            fillFilters(App.buildContext());
        },
        'txn.addSub': async () => {
            const tax = taxonomyFor(document.getElementById('txn-type').value);
            const parent = document.getElementById('txn-parent').value;
            if (!parent) { UI.toast('Primero elige o crea una categoría.', 'warn'); return; }
            const r = await UI.form({
                title: `Nueva subcategoría de "${parent}"`,
                fields: [{ name: 'name', label: 'Nombre', placeholder: 'Ej: Gimnasio' }],
                confirmText: 'Crear',
                validate: v => !v.name.trim() ? 'Escribe un nombre.' : tax[parent].includes(v.name.trim()) ? 'Esa subcategoría ya existe.' : null
            });
            if (!r) return;
            tax[parent].push(r.name.trim());
            App.changed({ step: true });
            fillSubSelect(r.name.trim());
            renderCategories();
        },
        'cat.deleteParent': (el) => {
            const tax = taxonomyFor(document.getElementById('cat-type').value);
            const p = el.dataset.parent;
            const n = Store.state.transactions.filter(t => t.parentCategory === p).length;
            App.undoable(n ? `"${p}" eliminada. Sus ${n} transacciones la conservan.` : `"${p}" eliminada`, () => { delete tax[p]; });
        },
        'cat.deleteSub': (el) => {
            const tax = taxonomyFor(document.getElementById('cat-type').value);
            const { parent, sub } = el.dataset;
            App.undoable(`"${sub}" eliminada`, () => { tax[parent] = tax[parent].filter(s => s !== sub); });
        }
    });

    App.defineView('presupuesto/transacciones', { render, update });
})();
