/* Deudas y Metas → Universidad de tus hijos (Paso 5): per child, the total cost when they start
 * (Engine.collegePlan), what the savings will grow to, and the monthly saving that closes the gap.
 * A child can be linked to a savings goal (its saved amount and monthly come from there). */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const cfg = () => Store.state.college || (Store.state.college = { kids: [], costInflation: null, returnPct: null });
    const types = () => (Store.defaults.collegeTypes ? Store.defaults.collegeTypes() : []);
    const defs = () => Store.defaults.collegeDefaults || { costInflation: 5, returnPct: 6 };
    const typeOf = (k) => types().find(t => t.id === k.type) || types()[0];
    const goalOf = (k) => k.goalId ? (Store.state.goals || []).find(g => g.id === k.goalId) : null;

    function planFor(k) {
        const c = cfg(), g = goalOf(k), t = typeOf(k);
        return Engine.collegePlan({ age: k.age, years: k.years || 4, annualCost: k.cost === null || k.cost === undefined ? t.cost : k.cost,
            costInflation: c.costInflation === null || c.costInflation === undefined ? defs().costInflation : c.costInflation,
            saved: g ? Number(g.current) || 0 : Number(k.saved) || 0, monthly: g ? Number(g.monthly) || 0 : Number(k.monthly) || 0,
            returnPct: c.returnPct === null || c.returnPct === undefined ? (g && Number(g.rate) ? Number(g.rate) : defs().returnPct) : c.returnPct });
    }

    function render(ctx) {
        if (!document.getElementById('metas-college')) return;
        const c = cfg(), d = defs(), goals = ctx.state.goals || [];
        const num = (k, field, step, val, ph) => `<input type="number" class="cell-input num" min="0" step="${step}" data-input="college.set" data-id="${k.id}" data-field="${field}" value="${val === null || val === undefined ? '' : esc(String(val))}" ${ph ? `placeholder="${esc(ph)}"` : ''}>`;
        UI.html('college-body', c.kids.length ? c.kids.map(k => {
            const g = goalOf(k), t = typeOf(k);
            return `<tr data-row="${k.id}">
                <td><input class="cell-input" value="${esc(k.name)}" data-change="college.set" data-id="${k.id}" data-field="name" aria-label="Name"></td>
                <td>${num(k, 'age', 1, k.age)}</td>
                <td><select class="cell-input" data-change="college.set" data-id="${k.id}" data-field="type">${Views.selectOptions(types().map(x => ({ value: x.id, label: x.label })), t.id)}</select></td>
                <td>${num(k, 'cost', 500, k.cost, money0(t.cost))}</td>
                <td>${num(k, 'years', 1, k.years || 4)}</td>
                <td><select class="cell-input" data-change="college.set" data-id="${k.id}" data-field="goalId" aria-label="Savings goal">${Views.selectOptions([{ value: '', label: 'No goal (type below)' }].concat(goals.map(x => ({ value: String(x.id), label: x.name }))), k.goalId ? String(k.goalId) : '')}</select>
                    ${g ? '' : `<div class="flex gap-1 mt-1">${num(k, 'saved', 100, k.saved, 'Saved')}${num(k, 'monthly', 10, k.monthly, 'Per month')}</div>`}</td>
                <td class="text-center"><button class="row-del" data-action="college.delete" data-id="${k.id}" title="Remove" aria-label="Remove"><i class="fa-solid fa-trash-can"></i></button></td>
            </tr>`;
        }).join('') : `<tr class="empty-row"><td colspan="7">${Views.emptyState('fa-graduation-cap', 'Add your kids to see what college will cost and how much to set aside each month.')}</td></tr>`);
        const inf = document.getElementById('college-infl'), ret = document.getElementById('college-ret');
        if (inf && inf !== document.activeElement) { inf.value = c.costInflation === null || c.costInflation === undefined ? '' : c.costInflation; inf.placeholder = d.costInflation + '%'; }
        if (ret && ret !== document.activeElement) { ret.value = c.returnPct === null || c.returnPct === undefined ? '' : c.returnPct; ret.placeholder = d.returnPct + '%'; }
        update(ctx);
    }

    function update(ctx) {
        if (!document.getElementById('metas-college')) return;
        const c = cfg(), y = ctx.today.getFullYear();
        UI.html('college-results', c.kids.map(k => {
            const p = planFor(k), g = goalOf(k);
            const start = y + Math.ceil(p.yearsToStart);
            const pct = Math.round(p.pct * 100);
            return `<div class="college-card">
                <div class="flex items-center justify-between gap-2"><div class="font-bold text-sm" data-i18n-skip>${esc(k.name || '—')}</div><span class="badge ${p.pct >= 1 ? 'badge-ok' : p.pct >= 0.5 ? 'badge-warn' : 'badge-bad'}">${pct}%</span></div>
                <div class="text-[11px] text-slate-500"><span>${p.yearsToStart > 0 ? `Starts in ${start}` : 'Already in school'}</span> · <span>would cost ${money0(p.todayCost)} today</span></div>
                <div class="calc-result mt-2"><div class="flex justify-between"><span>Total cost</span><strong>${money0(p.total)}</strong></div><div class="flex justify-between"><span>You'd have saved</span><strong>${money0(p.projected)}</strong></div><div class="flex justify-between"><span>Missing</span><strong>${money0(p.gap)}</strong></div></div>
                <div class="progress-track mt-2"><div class="progress-fill" style="width:${pct}%"></div></div>
                <p class="text-xs mt-2">${p.gap <= 0 ? 'What you set aside is enough!' : p.monthlyNeeded === null ? 'There\'s no time left to save: scholarships, work, and a school you can pay for without debt.' : `<span>To cover it all: <strong>${money0(p.monthlyNeeded)}/mo</strong> starting today.</span>`}
                ${!g && p.monthlyNeeded ? ` <button type="button" class="link" data-action="college.goal" data-id="${k.id}">Create a savings goal for it</button>` : ''}</p>
            </div>`;
        }).join(''));
    }

    UI.register({
        'college.set': (el) => {
            const k = cfg().kids.find(x => x.id === Number(el.dataset.id));
            if (!k) return;
            const f = el.dataset.field;
            if (f === 'name' || f === 'type') k[f] = el.value;
            else if (f === 'goalId') k.goalId = el.value ? Number(el.value) : null;
            else if (f === 'cost') k.cost = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            else k[f] = Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ structural: f === 'goalId' || f === 'type', step: true });
        },
        'college.setting': (el) => {
            cfg()[el.dataset.field] = el.value === '' ? null : Math.max(0, Fmt.parseNum(el.value, 0));
            App.changed({ step: true });
        },
        'college.add': () => {
            const c = cfg();
            const id = Store.nextId(c.kids);
            c.kids.push({ id, name: window.I18n ? I18n.t('Child') : 'Child', age: 5, type: types()[0].id, years: 4, cost: null, saved: 0, monthly: 0, goalId: null });
            App.changed({ structural: true, step: true });
            const input = document.querySelector(`#college-body tr[data-row="${id}"] input`);
            if (input) { input.focus(); input.select(); }
        },
        'college.delete': (el) => {
            const id = Number(el.dataset.id);
            App.undoable('Removed from the estimator', () => { const c = cfg(); c.kids = c.kids.filter(k => k.id !== id); });
        },
        // A savings goal for this child: the total, what's saved, the monthly that closes it.
        'college.goal': (el) => {
            const k = cfg().kids.find(x => x.id === Number(el.dataset.id));
            if (!k) return;
            const p = planFor(k), start = new Date().getFullYear() + Math.ceil(p.yearsToStart);
            const name = `${window.I18n ? I18n.t('College') : 'College'}: ${k.name}`;
            App.undoable(`Goal «${name}» created: ${money(p.monthlyNeeded)} a month in your budget`, () => {
                const goals = Store.state.goals;
                const g = { id: Store.nextId(goals), name, target: Math.round(p.total), current: Number(k.saved) || 0, monthly: Math.ceil(p.monthlyNeeded), rate: cfg().returnPct === null || cfg().returnPct === undefined ? defs().returnPct : cfg().returnPct, targetDate: `${start}-08`, createdYear: new Date().getFullYear() };
                goals.push(g);
                k.goalId = g.id;
            });
        }
    });

    window.College = { render, update, planFor };
})();
