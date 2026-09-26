/* Ahorro DPF: forward projection from today's pólizas, and the pólizas/cooperativas registry. */
(function () {
    'use strict';
    const { money, money0, esc, parseNum } = Fmt;

    // ---------------------------------------------------------------- proyección
    function updateProjection(ctx) {
        const s = ctx.state;
        const proj = ctx.projection;
        UI.text('proj-start', ctx.projectionStart);
        UI.text('proj-opening', money0(proj.opening));
        UI.text('proj-annual', money0(ctx.annual.savingsReal));
        UI.text('proj-annual-note', ctx.annual.sweep > 0 ? `Incluye ${money0(ctx.annual.sweep)} de barrido` : `${((ctx.savingsRate) * 100).toFixed(0)}% de tu sueldo bruto`);
        UI.text('proj-interest', money0(proj.totalInterest));
        UI.text('proj-pol-interest', money0(s.polizas.reduce((t, p) => t + Engine.polizaInterest(p), 0)));
        UI.text('proj-final', money0(proj.finalBalance));

        UI.html('proj-body', proj.rows.map(r => `
            <tr class="${r.year === s.activeYear ? 'highlight' : ''}">
                <td>${r.year}${r.year === s.activeYear ? ' <span class="badge badge-ok">activo</span>' : ''}</td>
                <td class="num">${money(r.contribution)}</td>
                <td class="num">${money(r.totalContrib)}</td>
                <td class="num">${r.rate.toFixed(2)}%</td>
                <td class="num text-emerald-700">+${money(r.interest)}</td>
                <td class="num text-emerald-700">+${money(r.totalInterest)}</td>
                <td class="num font-bold text-amber-900">${money(r.balance)}</td>
            </tr>`).join(''));

        UI.chart('proj-chart', {
            type: 'line',
            data: {
                labels: proj.rows.map(r => r.year),
                datasets: [
                    { label: 'Capital aportado (pólizas + ahorro)', data: proj.rows.map(r => proj.opening + r.totalContrib), borderColor: '#3b82f6', backgroundColor: 'rgba(59,130,246,.08)', fill: true, tension: .3, pointRadius: 0 },
                    { label: 'Balance DPF con interés', data: proj.rows.map(r => r.balance), borderColor: '#059669', backgroundColor: 'rgba(16,185,129,.15)', fill: true, tension: .3, pointRadius: 0 }
                ]
            }
        });

        const series = Engine.incomeExpenseSeries({ startYear: s.configStartYear, endYear: s.configEndYear, getYear: y => Store.peekYear(y) });
        UI.chart('proj-ie-chart', {
            type: 'line',
            data: {
                labels: series.map(r => r.year),
                datasets: [
                    { label: 'Costo de vida (gastos + deudas)', data: series.map(r => r.consumption), borderColor: '#dc2626', fill: false, tension: .3, pointRadius: 0 },
                    { label: 'Ingreso neto anual', data: series.map(r => r.income), borderColor: '#059669', backgroundColor: 'rgba(5,150,105,.15)', fill: '-1', tension: .3, pointRadius: 0 }
                ]
            }
        });
    }

    // ------------------------------------------------------------------ pólizas
    function polizaRow(p, coops) {
        const names = coops.map(c => c.name);
        const options = names.includes(p.coopName) ? names : [p.coopName].concat(names);
        return `<tr data-row="${p.id}">
            <td><select class="cell-input" data-change="poliza.set" data-id="${p.id}" data-field="coopName">${Views.selectOptions(options, p.coopName)}</select></td>
            <td><input class="cell-input" style="min-width:6.5rem" value="${esc(p.number)}" data-change="poliza.set" data-id="${p.id}" data-field="number"></td>
            <td><input type="number" class="cell-input num" min="0" step="100" value="${Number(p.amount) || 0}" data-input="poliza.set" data-id="${p.id}" data-field="amount"></td>
            <td><input type="number" class="cell-input num" min="0" step="0.1" value="${Number(p.rate) || 0}" data-input="poliza.set" data-id="${p.id}" data-field="rate"></td>
            <td><input type="number" class="cell-input num" min="1" step="30" value="${Number(p.days) || 360}" data-input="poliza.set" data-id="${p.id}" data-field="days"></td>
            <td><select class="cell-input" data-change="poliza.set" data-id="${p.id}" data-field="modality">${Views.selectOptions(Engine.MODALITIES, p.modality)}</select></td>
            <td class="whitespace-nowrap"><input type="date" class="cell-input" style="width:auto" value="${esc(p.maturityDate)}" data-change="poliza.set" data-id="${p.id}" data-field="maturityDate"> <span data-cell="maturity"></span></td>
            <td class="num font-bold text-emerald-700" data-cell="interest"></td>
            <td class="text-center"><button class="row-del" data-action="poliza.delete" data-id="${p.id}" title="Eliminar póliza"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function coopRow(c) {
        return `<tr data-row="${c.id}">
            <td><input class="cell-input" value="${esc(c.name)}" data-change="coop.set" data-id="${c.id}" data-field="name"></td>
            <td><input class="cell-input" style="min-width:6.5rem" value="${esc(c.segment)}" data-change="coop.set" data-id="${c.id}" data-field="segment"></td>
            <td><input type="number" class="cell-input num" min="0" step="0.1" value="${Number(c.defaultRate) || 0}" data-input="coop.set" data-id="${c.id}" data-field="defaultRate"></td>
            <td><select class="cell-input" data-change="coop.set" data-id="${c.id}" data-field="interestType">${Views.selectOptions(Engine.MODALITIES, c.interestType)}</select></td>
            <td><input type="number" class="cell-input num" min="0" step="1000" value="${Number(c.cosedeMax) || 0}" data-input="coop.set" data-id="${c.id}" data-field="cosedeMax"></td>
            <td class="text-center"><button class="row-del" data-action="coop.delete" data-id="${c.id}" title="Eliminar cooperativa"><i class="fa-solid fa-trash-can"></i></button></td>
        </tr>`;
    }

    function renderPolizas(ctx) {
        const s = ctx.state;
        UI.html('pol-body', s.polizas.length ? s.polizas.map(p => polizaRow(p, s.cooperativas)).join('') : '<tr class="empty-row"><td colspan="9">Registra tus pólizas para que tu saldo DPF sea real.</td></tr>');
        UI.html('coop-body', s.cooperativas.map(coopRow).join('') || '<tr class="empty-row"><td colspan="6">Sin cooperativas.</td></tr>');
        updatePolizas(ctx);
    }

    function updatePolizas(ctx) {
        const s = ctx.state;
        let totalInt = 0;
        s.polizas.forEach(p => {
            const row = document.querySelector(`#pol-body tr[data-row="${p.id}"]`);
            if (!row) return;
            const interest = Engine.polizaInterest(p);
            totalInt += interest;
            row.querySelector('[data-cell="interest"]').textContent = '+' + money(interest);
            const st = Engine.maturityStatus(p.maturityDate, ctx.today);
            row.querySelector('[data-cell="maturity"]').innerHTML = !st ? '' : st.kind === 'vencida' ? '<span class="badge badge-bad">Vencida</span>' : st.kind === 'pronto' ? `<span class="badge badge-warn">Vence en ${st.days}d</span>` : '';
        });
        UI.text('pol-total', money(ctx.polizasCapital));
        UI.text('pol-total-int', '+' + money(totalInt));

        const over = ctx.cosede.filter(c => c.exceeded);
        const banner = document.getElementById('cosede-banner');
        banner.className = `panel flex items-center gap-3 ${over.length ? 'tone-red' : 'tone-emerald'}`;
        banner.innerHTML = over.length
            ? `<i class="fa-solid fa-triangle-exclamation text-2xl text-red-600"></i><div class="text-xs"><div class="font-bold text-red-900">Riesgo: cobertura COSEDE excedida</div><div class="text-red-800">${over.map(e => `${esc(e.name)}: ${money0(e.total)} supera ${money0(e.limit)}`).join(' · ')}. Reparte el excedente en otra cooperativa.</div></div>`
            : `<i class="fa-solid fa-shield-halved text-2xl text-emerald-600"></i><div class="text-xs"><div class="font-bold text-emerald-900">Protegido por COSEDE</div><div class="text-emerald-800">Tus montos por cooperativa están dentro de la cobertura del seguro de depósitos.</div></div>`;
    }

    const find = (list, el) => list.find(x => x.id === Number(el.dataset.id));
    const NUMERIC = ['amount', 'rate', 'days', 'defaultRate', 'cosedeMax'];

    UI.register({
        'poliza.set': (el) => {
            const p = find(Store.state.polizas, el);
            if (!p) return;
            const f = el.dataset.field;
            p[f] = NUMERIC.includes(f) ? Math.max(0, parseNum(el.value, 0)) : el.value;
            App.changed();
        },
        'poliza.add': () => {
            const s = Store.state;
            const coop = s.cooperativas[0] || { name: 'Cooperativa', defaultRate: 8.5, interestType: Engine.MODALITIES[0] };
            const due = new Date(Date.now() + 360 * 86400000).toISOString().slice(0, 10);
            s.polizas.push({ id: Store.nextId(s.polizas), coopName: coop.name, number: 'DPF-' + String(Date.now()).slice(-5), amount: 1000, rate: coop.defaultRate, days: 360, modality: coop.interestType, maturityDate: due });
            App.changed({ structural: true });
        },
        'poliza.delete': (el) => {
            const p = find(Store.state.polizas, el);
            App.undoable(`Póliza ${p.number} eliminada`, () => { Store.state.polizas = Store.state.polizas.filter(x => x !== p); });
        },
        'coop.set': (el) => {
            const c = find(Store.state.cooperativas, el);
            if (!c) return;
            const f = el.dataset.field;
            const old = c.name;
            c[f] = NUMERIC.includes(f) ? Math.max(0, parseNum(el.value, 0)) : el.value;
            // Renaming a cooperativa renames it in your pólizas too, so COSEDE totals stay grouped.
            if (f === 'name') Store.state.polizas.forEach(p => { if (p.coopName === old) p.coopName = c.name; });
            App.changed({ structural: f === 'name' });
        },
        'coop.add': () => {
            const s = Store.state;
            s.cooperativas.push({ id: Store.nextId(s.cooperativas), name: 'Nueva cooperativa', segment: 'Segmento 1', defaultRate: 8.5, interestType: 'Mensual (Compuesto)', cosedeMax: 32000 });
            App.changed({ structural: true });
        },
        'coop.delete': (el) => {
            const c = find(Store.state.cooperativas, el);
            App.undoable(`Cooperativa "${c.name}" eliminada`, () => { Store.state.cooperativas = Store.state.cooperativas.filter(x => x !== c); });
        }
    });

    App.defineView('ahorro/proyeccion', { update: updateProjection });
    App.defineView('ahorro/polizas', { render: renderPolizas, update: updatePolizas });
})();
