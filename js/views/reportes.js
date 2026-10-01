/* Presupuesto → Reportes: group transactions any way over any period; export CSV or print. */
(function () {
    'use strict';
    const { money, esc } = Fmt;

    const BY_LABEL = { category: 'Categoría', sub: 'Subcategoría', line: 'Rubro del presupuesto', member: 'Persona', month: 'Mes', week: 'Semana', store: 'Lugar / comercio', payment: 'Forma de pago' };
    const opts = () => (Store.ui.report = Object.assign({ range: 'this-month', type: 'Gasto', by: 'category', from: '', to: '' }, Store.ui.report));

    // Period presets → [from, to] as ISO dates.
    function period(o, today) {
        const t = new Date(today), y = t.getFullYear(), m = t.getMonth();
        const iso = Engine.isoDate;
        switch (o.range) {
            case 'last-month': return [iso(new Date(y, m - 1, 1)), iso(new Date(y, m, 0))];
            case '3m': return [iso(new Date(y, m - 2, 1)), iso(t)];
            case '6m': return [iso(new Date(y, m - 5, 1)), iso(t)];
            case 'this-year': return [`${y}-01-01`, iso(t)];
            case 'last-year': return [`${y - 1}-01-01`, `${y - 1}-12-31`];
            case 'all': return ['0000-01-01', '9999-12-31'];
            case 'custom': return [o.from || '0000-01-01', o.to || '9999-12-31'];
            default: return [iso(new Date(y, m, 1)), iso(new Date(y, m + 1, 0))];
        }
    }

    // Budget line of each expense (same rule as the budget), cached per month.
    function lineNamer() {
        const cache = {};
        return (t) => {
            if ((t.type || 'Gasto') === 'Ingreso') {
                const yd = Store.state.years[Number(t.date.slice(0, 4))];
                const line = t.incomeId && yd && (yd.otherIncomes || []).find(x => x.id === t.incomeId);
                return line ? line.name : Engine.isPayrollTxn(t) ? 'Sueldo' : 'Ingreso extra';
            }
            const y = Number(t.date.slice(0, 4)), m = String(Number(t.date.slice(5, 7)));
            const key = y + '-' + m;
            if (!cache[key]) {
                const items = Engine.monthItems(Store.effective(y), m);
                const spend = Engine.lineSpend(items, Store.state.transactions, y, m);
                const byTxn = {};
                Object.keys(spend.byLine).forEach(id => { const it = items.find(i => String(i.id) === id); spend.byLine[id].txns.forEach(x => { byTxn[x.id] = it ? it.name : id; }); });
                cache[key] = byTxn;
            }
            return cache[key][t.id] || 'Sin rubro';
        };
    }

    function build(ctx) {
        const o = opts();
        const [from, to] = period(o, ctx.today);
        const members = ctx.state.members || [];
        const lineOf = o.by === 'line' ? lineNamer() : null;
        const keyOf = (t) => {
            switch (o.by) {
                case 'sub': return `${t.parentCategory}${t.category ? ' › ' + t.category : ''}`;
                case 'line': return lineOf(t);
                case 'member': { const p = members.find(x => x.id === t.memberId); return p ? p.name : 'Sin persona'; }
                case 'month': return t.date.slice(0, 7);
                case 'week': return Engine.isoDate(Engine.periodStart(new Date(t.date + 'T00:00:00'), 'week'));
                case 'store': return (t.store || t.description || '—').trim();
                case 'payment': return t.paymentType || '—';
                default: return t.parentCategory || 'Otros';
            }
        };
        const list = ctx.state.transactions.filter(t => t.date >= from && t.date <= to && (o.type === 'both' || (t.type || 'Gasto') === o.type));
        const groups = {};
        list.forEach(t => {
            const k = keyOf(t);
            const g = groups[k] || (groups[k] = { key: k, count: 0, income: 0, expense: 0 });
            g.count++;
            if ((t.type || 'Gasto') === 'Ingreso') g.income += Number(t.amount) || 0; else g.expense += Number(t.amount) || 0;
        });
        const signed = (g) => o.type === 'Ingreso' ? g.income : o.type === 'Gasto' ? g.expense : g.income - g.expense;
        const rows = Object.values(groups).map(g => Object.assign(g, { total: signed(g) }));
        const timeBased = o.by === 'month' || o.by === 'week';
        rows.sort((a, b) => timeBased ? a.key.localeCompare(b.key) : Math.abs(b.total) - Math.abs(a.total));
        const total = rows.reduce((a, r) => a + r.total, 0);
        const absTotal = rows.reduce((a, r) => a + Math.abs(r.total), 0);
        return { o, from, to, list, rows, total, absTotal };
    }

    const label = (o, key) => {
        if (o.by === 'month') { const [y, m] = key.split('-'); return `${Fmt.MONTH_NAMES[Number(m) - 1]} ${y}`; }
        if (o.by === 'week') { const d = new Date(key + 'T00:00:00'); return `Semana del ${d.getDate()} ${Fmt.MONTH_SHORT[d.getMonth()]} ${d.getFullYear()}`; }
        return key;
    };

    function render(ctx) {
        const o = opts();
        ['range', 'type', 'by'].forEach(k => { document.getElementById('rep-' + k).value = o[k]; });
        UI.show('rep-from-field', o.range === 'custom');
        UI.show('rep-to-field', o.range === 'custom');
        document.getElementById('rep-from').value = o.from;
        document.getElementById('rep-to').value = o.to;
        const r = build(ctx);
        UI.text('rep-group-head', BY_LABEL[o.by]);
        const what = o.type === 'Ingreso' ? 'Ingresos' : o.type === 'Gasto' ? 'Gastos' : 'Neto (ingresos − gastos)';
        const range = o.range === 'all' ? 'todo el historial' : `${r.from} a ${r.to}`;
        UI.html('rep-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">${what}</span><span class="kpi-value">${money(r.total)}</span><span class="kpi-note">${esc(range)}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Movimientos</span><span class="kpi-value">${r.list.length}</span><span class="kpi-note">en ${r.rows.length} grupo${r.rows.length === 1 ? '' : 's'}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Promedio por movimiento</span><span class="kpi-value">${money(r.list.length ? r.total / r.list.length : 0)}</span></div>`);
        const max = Math.max(...r.rows.map(x => Math.abs(x.total)), 1);
        UI.html('rep-body', r.rows.length ? r.rows.map(g => `<tr>
                <td class="font-semibold">${esc(label(o, g.key))}</td>
                <td class="num">${g.count}</td>
                <td class="num font-bold ${g.total < 0 ? 'text-red-600' : ''}">${money(g.total)}</td>
                <td><div class="flex items-center gap-2"><div class="mini-bar flex-1"><span style="width:${(Math.abs(g.total) / max * 100).toFixed(1)}%;background:#2a78d6"></span></div><span class="text-[11px] text-slate-500 w-9 text-right">${r.absTotal ? Math.round(Math.abs(g.total) / r.absTotal * 100) : 0}%</span></div></td>
                <td class="num text-xs">${money(g.total / g.count)}</td>
            </tr>`).join('') + `<tr class="font-bold"><td>Total</td><td class="num">${r.list.length}</td><td class="num">${money(r.total)}</td><td></td><td></td></tr>`
            : '<tr class="empty-row"><td colspan="5">No hay movimientos en este período.</td></tr>');
    }

    // A download in the browser; the share sheet in the phone app (js/native.js).
    function download(name, text) {
        Native.saveFile(name, text, 'text/csv;charset=utf-8').catch(e => UI.toast('No se pudo guardar el archivo: ' + (e.message || e), 'error'));
    }

    UI.register({
        'rep.set': (el) => {
            const o = opts();
            o[el.dataset.key] = el.value;
            if (el.dataset.key === 'range' && el.value === 'custom' && !o.from) {
                const [f, t] = period({ range: 'this-month' }, new Date());
                o.from = f; o.to = t;
            }
            App.render();
        },
        'rep.csv': () => {
            const r = build(App.buildContext());
            const rows = [[BY_LABEL[r.o.by], 'Movimientos', 'Total', '% del total', 'Promedio']]
                .concat(r.rows.map(g => [label(r.o, g.key), g.count, g.total, r.absTotal ? Math.round(Math.abs(g.total) / r.absTotal * 1000) / 10 : 0, g.total / g.count]))
                .concat([['Total', r.list.length, r.total, 100, '']]);
            download(`reporte_${r.o.by}_${r.from.replace('0000-01-01', 'inicio')}_${r.to.replace('9999-12-31', 'hoy')}.csv`, Importers.toCSV(rows));
        },
        'rep.txns': () => {
            const r = build(App.buildContext());
            const members = Store.state.members || [];
            const rows = [['Fecha', 'Tipo', 'Descripción', 'Lugar', 'Categoría', 'Subcategoría', 'Monto', 'Forma de pago', 'Persona']]
                .concat(r.list.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type || 'Gasto', t.description, t.store || '', t.parentCategory, t.category || '', ((t.type || 'Gasto') === 'Ingreso' ? 1 : -1) * (Number(t.amount) || 0), t.paymentType || '', ((members.find(p => p.id === t.memberId) || {}).name) || '']));
            download(`transacciones_${r.from.replace('0000-01-01', 'inicio')}_${r.to.replace('9999-12-31', 'hoy')}.csv`, Importers.toCSV(rows));
        }
    });

    App.defineView('presupuesto/reportes', { render, update: render });
    window.Reports = { build };
})();
