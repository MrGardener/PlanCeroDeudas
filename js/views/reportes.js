/* Presupuesto → Reportes: group transactions any way over any period; export CSV or print. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    // File headers in the app's language (the page is translated as it shows; files aren't).
    const tr = (s) => (window.I18n ? I18n.t(s) : s);
    const BY_LABEL = { category: 'Category', sub: 'Subcategory', line: 'Budget line', member: 'Person', month: 'Month', week: 'Week', store: 'Place / store', payment: 'Payment method' };
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
                return line ? line.name : Engine.isPayrollTxn(t) ? 'Salary' : 'Extra income';
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
            return cache[key][t.id] || 'No line';
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
                case 'tag': return (t.tags || []).length ? t.tags.map(g => '#' + g) : 'No tag';
                default: return t.parentCategory || 'Otros';
            }
        };
        // Transfers between your own accounts aren't income or spending: they stay out of reports.
        const list = ctx.state.transactions.filter(t => t.date >= from && t.date <= to && !Engine.isTransfer(t) && (o.type === 'both' || (t.type || 'Gasto') === o.type));
        const groups = {};
        list.forEach(t => [].concat(keyOf(t)).forEach(k => {
            const g = groups[k] || (groups[k] = { key: k, count: 0, income: 0, expense: 0 });
            g.count++;
            if ((t.type || 'Gasto') === 'Ingreso') g.income += Number(t.amount) || 0; else g.expense += Engine.spendAmount(t);
        }));
        const signed = (g) => o.type === 'Ingreso' ? g.income : o.type === 'Gasto' ? g.expense : g.income - g.expense;
        const rows = Object.values(groups).map(g => Object.assign(g, { total: signed(g) }));
        const timeBased = o.by === 'month' || o.by === 'week';
        rows.sort((a, b) => timeBased ? a.key.localeCompare(b.key) : Math.abs(b.total) - Math.abs(a.total));
        const total = rows.reduce((a, r) => a + r.total, 0);
        const absTotal = rows.reduce((a, r) => a + Math.abs(r.total), 0);
        // Each group's last 12 months (whatever the period), for the sparkline in its row.
        const typed = ctx.state.transactions.filter(t => !Engine.isTransfer(t) && (o.type === 'both' || (t.type || 'Gasto') === o.type));
        const sign = (t) => (t.type || 'Gasto') === 'Ingreso' ? Number(t.amount) || 0 : (o.type === 'both' ? -1 : 1) * Engine.spendAmount(t);
        const trend = timeBased ? null : Engine.monthlyByKey(typed, keyOf, { end: ctx.today, count: 12, value: sign });
        return { o, from, to, list, rows, total, absTotal, trend, timeBased };
    }

    const label = (o, key) => {
        if (o.by === 'month') { const [y, m] = key.split('-'); return `${Fmt.MONTH_NAMES[Number(m) - 1]} ${y}`; }
        if (o.by === 'week') { const d = new Date(key + 'T00:00:00'); return `Week of ${Fmt.MONTH_SHORT[d.getMonth()]} ${d.getDate()} ${d.getFullYear()}`; }
        return key;
    };

    // Spending calendar: one cell per day of the last 12 weeks (Engine.dailySpend), in one blue
    // sequential scale binned by quintiles of the days with spending; a gray cell = no spending.
    function heatmap(ctx) {
        const pal = UI.palette();
        const r = Engine.dailySpend(ctx.state.transactions, { end: ctx.today, weeks: 12 });
        const vals = r.weeks.flatMap(w => w.days.filter(d => !d.future && d.total > 0).map(d => d.total)).sort((a, b) => a - b);
        const q = (p) => vals[Math.min(vals.length - 1, Math.floor(p * vals.length))];
        const cuts = vals.length ? [0.2, 0.4, 0.6, 0.8].map(q).map(v => Math.round(v)) : [];
        const bin = (v) => cuts.filter(c => v > c).length;
        const todayIso = Engine.isoDate(ctx.today);
        const date = (iso) => new Date(iso + 'T00:00:00');
        const dayName = (iso) => { const d = date(iso); return `${Fmt.WEEKDAYS[d.getDay()]} ${Fmt.dayMonth(d)}`; };
        // Month names over the column whose week holds the 1st (or the first column).
        const heads = r.weeks.map((w, i) => {
            const first = w.days.find(d => d.date.slice(8) === '01');
            if (first) return Fmt.MONTH_SHORT[Number(first.date.slice(5, 7)) - 1];
            const nextHas = r.weeks[i + 1] && r.weeks[i + 1].days.some(d => d.date.slice(8) === '01');
            return i === 0 && !nextHas ? Fmt.MONTH_SHORT[Number(w.start.slice(5, 7)) - 1] : '';
        });
        let html = `<div class="heat" style="--weeks:${r.weeks.length}" role="img" aria-label="${esc(`Spending per day, last 12 weeks: total ${money(r.total)}`)}"><span></span>${heads.map((h, i) => `<span class="heat-m" style="grid-column:${i + 2}">${h}</span>`).join('')}`;
        for (let d = 0; d < 7; d++) {
            html += `<span class="heat-d" style="grid-row:${d + 2}">${Fmt.DOW_SHORT[d]}</span>`;
            r.weeks.forEach((w, i) => {
                const day = w.days[d];
                const style = `grid-row:${d + 2};grid-column:${i + 2};` + (day.future ? '' : `background:${day.total > 0 ? pal.seq[bin(day.total)] : pal.seq0}`);
                const cls = `heat-c${day.future ? ' is-future' : ''}${day.date === todayIso ? ' is-today' : ''}`;
                html += day.future ? `<span class="${cls}" style="${style}"></span>` : `<span class="${cls}" style="${style}" title="${esc(dayName(day.date))}: ${money(day.total)}"></span>`;
            });
        }
        UI.html('rep-heat', html + '</div>');
        const lo = vals.length ? Math.round(vals[0]) : 0;
        const ranges = cuts.length ? [`${money0(lo)}–${money0(cuts[0])}`].concat(cuts.map((c, i) => (i < cuts.length - 1 ? `${money0(c)}–${money0(cuts[i + 1])}` : `${money0(c)}+`))) : [];
        UI.html('rep-heat-legend', `<span class="mr-1">No spending</span><i style="background:${pal.seq0}"></i><span class="mx-1">Less</span>${pal.seq.map((c, i) => `<i style="background:${c}" title="${esc(ranges[i] || '')}"></i>`).join('')}<span class="ml-1">More</span>`
            + (cuts.length ? `<span class="w-full mt-1">Each shade is one fifth of your days with spending: ${ranges.join(' · ')}.</span>` : ''));
        // Average by weekday (past days only), Monday first.
        const avg = Array.from({ length: 7 }, (_, d) => { const days = r.weeks.map(w => w.days[d]).filter(x => !x.future); return days.length ? days.reduce((t, x) => t + x.total, 0) / days.length : 0; });
        const top = Math.max(...avg, 1), peak = avg.indexOf(Math.max(...avg));
        UI.html('rep-heat-dow', avg.map((v, d) => `<div class="grid grid-cols-[5.5rem_1fr_4rem] items-center gap-2"><span class="${d === peak && v > 0 ? 'font-bold text-slate-800' : 'text-slate-600'}">${Fmt.WEEKDAYS[(d + 1) % 7]}</span><div class="mini-bar" style="margin-top:0"><span style="width:${(v / top * 100).toFixed(1)}%;background:${pal.blue}"></span></div><span class="text-right font-semibold">${money0(v)}</span></div>`).join('')
            + `<p class="help mt-2">Total in 12 weeks: ${money0(r.total)}.${avg[peak] > 0 ? ` Your biggest spending day: ${Fmt.WEEKDAYS[(peak + 1) % 7]}.` : ''}</p>`);
        UI.html('rep-heat-head', `<th>Week of</th>${Fmt.DOW_SHORT.map(x => `<th class="num">${x}</th>`).join('')}<th class="num">Total</th>`);
        UI.html('rep-heat-table', r.weeks.slice().reverse().map(w => `<tr><td class="whitespace-nowrap">${Fmt.dayMonth(date(w.start))}</td>${w.days.map(d => `<td class="num">${d.future ? '—' : money0(d.total)}</td>`).join('')}<td class="num font-bold">${money0(w.total)}</td></tr>`).join(''));
    }

    function render(ctx) {
        if (window.TxnCharts) TxnCharts.update(ctx);
        heatmap(ctx);
        const o = opts();
        ['range', 'type', 'by'].forEach(k => { document.getElementById('rep-' + k).value = o[k]; });
        UI.show('rep-from-field', o.range === 'custom');
        UI.show('rep-to-field', o.range === 'custom');
        document.getElementById('rep-from').value = o.from;
        document.getElementById('rep-to').value = o.to;
        const r = build(ctx);
        UI.text('rep-group-head', BY_LABEL[o.by]);
        const what = o.type === 'Ingreso' ? 'Income' : o.type === 'Gasto' ? 'Expenses' : 'Net (income − expenses)';
        const range = o.range === 'all' ? 'the whole history' : `${r.from} a ${r.to}`;
        UI.html('rep-kpis', `
            <div class="kpi tone-slate"><span class="kpi-label">${what}</span><span class="kpi-value">${money(r.total)}</span><span class="kpi-note">${esc(range)}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Transactions</span><span class="kpi-value">${r.list.length}</span><span class="kpi-note">in ${r.rows.length} group${r.rows.length === 1 ? '' : 's'}</span></div>
            <div class="kpi tone-slate"><span class="kpi-label">Average per transaction</span><span class="kpi-value">${money(r.list.length ? r.total / r.list.length : 0)}</span></div>`);
        const max = Math.max(...r.rows.map(x => Math.abs(x.total)), 1);
        UI.show('rep-spark-note', !r.timeBased);
        const pal = UI.palette();
        const spark = (g) => {
            if (r.timeBased) return '';
            const v = r.trend.series[g.key] || new Array(12).fill(0);
            const names = r.trend.months.map((k, i) => `${Fmt.MONTH_SHORT[Number(k.slice(5)) - 1]} ${money(v[i])}`);
            return `<div class="mt-1">${UI.sparkline(v, { width: 96, height: 20, color: pal.blue, partialLast: true, label: `${label(o, g.key)}, last 12 months: ${names.join(', ')}` })}</div>`;
        };
        UI.html('rep-body', r.rows.length ? r.rows.map(g => `<tr>
                <td><span class="font-semibold">${esc(label(o, g.key))}</span>${spark(g)}</td>
                <td class="num">${g.count}</td>
                <td class="num font-bold ${g.total < 0 ? 'text-red-600' : ''}">${money(g.total)}</td>
                <td><div class="flex items-center gap-2"><div class="mini-bar flex-1"><span style="width:${(Math.abs(g.total) / max * 100).toFixed(1)}%;background:#2a78d6"></span></div><span class="text-[11px] text-slate-500 w-9 text-right">${r.absTotal ? Math.round(Math.abs(g.total) / r.absTotal * 100) : 0}%</span></div></td>
                <td class="num text-xs">${money(g.total / g.count)}</td>
            </tr>`).join('') + `<tr class="font-bold"><td>Total</td><td class="num">${r.list.length}</td><td class="num">${money(r.total)}</td><td></td><td></td></tr>`
            : '<tr class="empty-row"><td colspan="5">No transactions in this period.</td></tr>');
    }

    // A download in the browser; the share sheet in the phone app (js/native.js).
    function download(name, text) {
        Native.saveFile(name, text, 'text/csv;charset=utf-8').catch(e => UI.toast('Couldn\'t save the file: ' + (e.message || e), 'error'));
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
            const rows = [[BY_LABEL[r.o.by], 'Transactions', 'Total', '% of total', 'Average'].map(tr)]
                .concat(r.rows.map(g => [label(r.o, g.key), g.count, g.total, r.absTotal ? Math.round(Math.abs(g.total) / r.absTotal * 1000) / 10 : 0, g.total / g.count]))
                .concat([['Total', r.list.length, r.total, 100, '']]);
            download(`reporte_${r.o.by}_${r.from.replace('0000-01-01', 'inicio')}_${r.to.replace('9999-12-31', 'hoy')}.csv`, Importers.toCSV(rows));
        },
        'rep.txns': () => {
            const r = build(App.buildContext());
            const members = Store.state.members || [];
            const rows = [['Date', 'Type', 'Description', 'Place', 'Category', 'Subcategory', 'Amount', 'Payment method', 'Person'].map(tr)]
                .concat(r.list.slice().sort((a, b) => a.date.localeCompare(b.date)).map(t => [t.date, t.type || 'Gasto', t.description, t.store || '', t.parentCategory, t.category || '', ((t.type || 'Gasto') === 'Ingreso' ? 1 : -1) * Engine.spendAmount(t), t.paymentType || '', ((members.find(p => p.id === t.memberId) || {}).name) || '']));
            download(`transacciones_${r.from.replace('0000-01-01', 'inicio')}_${r.to.replace('9999-12-31', 'hoy')}.csv`, Importers.toCSV(rows));
        }
    });

    App.defineView('transacciones/reportes', { render, update: render });
    window.Reports = { build };
})();
