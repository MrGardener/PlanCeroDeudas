/* First-run setup guide: one screen, a few short steps (household → pay → accounts → bills →
   debts), no jumping between tabs. Opens on a fresh install; afterwards only from Settings
   ("Setup guide") or "Start with my own data". Each step saves when you press Next. */
(function () {
    'use strict';
    const { money, esc } = Fmt;
    const STEPS = ['welcome', 'household', 'pay', 'accounts', 'bills', 'debts', 'done'];
    const COLORS = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#4a3aa7'];
    let sheet = null, step = 0;

    const yd = () => Store.active();
    const num = (id) => Fmt.parseNum((document.getElementById(id) || {}).value || '', 0);
    const val = (id) => ((document.getElementById(id) || {}).value || '').trim();
    const field = (id, label, value, opts = {}) => `<label class="field"><span class="field-label">${label}</span><input id="${id}" class="input" ${opts.type ? `type="${opts.type}"` : ''} ${opts.type === 'number' ? 'inputmode="decimal" min="0" step="any"' : ''} value="${esc(value === undefined || value === null ? '' : String(value))}" ${opts.ph ? `placeholder="${esc(opts.ph)}"` : ''}>${opts.help ? `<span class="help">${opts.help}</span>` : ''}</label>`;

    // Data someone typed or imported (not the example family): the guide never replaces it.
    const ownData = () => { const s = Store.state; return !s.settings.sample && (s.transactions.length > 0 || (s.debts || []).length > 0 || (s.accounts || []).length > 0); };

    function body() {
        const k = STEPS[step], s = Store.state, y = yd();
        const dots = `<div class="flex gap-1 mb-3" aria-hidden="true">${STEPS.slice(1, -1).map((_, i) => `<span class="h-1.5 flex-1 rounded-full ${i < step ? 'bg-emerald-500' : 'bg-slate-200'}"></span>`).join('')}</div>`;
        const nav = (next = 'Next', back = true) => `<div class="flex justify-between gap-2 mt-4">${back ? '<button type="button" class="btn btn-secondary" data-action="setup.back">Back</button>' : '<span></span>'}<span class="flex gap-2"><button type="button" class="btn btn-secondary" data-action="setup.skip">Skip</button><button type="button" class="btn btn-primary" data-action="setup.next">${next}</button></span></div>`;
        if (k === 'welcome') return `<p class="text-sm">Let's set up your plan in 5 short steps (about 5 minutes). Everything stays on this device, and you can change any of it later.</p>
            <ol class="text-sm list-decimal ml-5 mt-2 space-y-1"><li>Who's in your household</li><li>How you get paid</li><li>Your accounts and their balances</li><li>Your main monthly bills</li><li>Your debts</li></ol>
            <div class="flex flex-wrap justify-end gap-2 mt-4">${ownData() ? '' : '<button type="button" class="btn btn-secondary" data-action="setup.example">Look at the example family first</button>'}<button type="button" class="btn btn-primary" data-action="setup.start">Set up my plan</button></div>`;
        if (k === 'household') return `${dots}<p class="text-sm mb-3"><strong>Who's in your household?</strong> Transactions can be one person's or the whole household's.</p>
            ${field('su-names', 'Names, separated by commas', (s.members || []).map(p => p.name).join(', '), { ph: 'E.g. Ana, Luis' })}${nav()}`;
        if (k === 'pay') {
            const g = Engine.usGrossPay(y), h = y.hourly || {}, us = Store.COUNTRY === 'US';
            return `${dots}<p class="text-sm mb-3"><strong>How do you get paid?</strong> Your main paycheck; other income can be added later in the budget.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-3">
                ${us ? `<label class="field"><span class="field-label">Paid</span><select id="su-type" class="input" data-change="setup.redraw"><option value="salary" ${g.payType === 'salary' ? 'selected' : ''}>A salary</option><option value="hourly" ${g.payType === 'hourly' ? 'selected' : ''}>By the hour</option></select></label>` : ''}
                ${us && (val('su-type') || g.payType) === 'hourly' ? field('su-rate', `Hourly rate (${esc(Fmt.currency().symbol)})`, h.rate || '', { type: 'number' }) + field('su-hours', 'Hours a week', h.hours || 40, { type: 'number' })
                    : field('su-gross', `Monthly gross pay (${esc(Fmt.currency().symbol)})`, y.sueldo || '', { type: 'number', help: 'Before taxes.' })}
                <label class="field"><span class="field-label">How often</span><select id="su-freq" class="input"><option value="biweekly">Every 2 weeks</option><option value="weekly">Every week</option><option value="semi">Twice a month (15th and 30th)</option><option value="monthly">Once a month</option></select></label>
                ${field('su-next', 'Next payday', Engine.isoDate(new Date()), { type: 'date' })}
            </div>${nav()}`;
        }
        if (k === 'accounts') return `${dots}<p class="text-sm mb-3"><strong>Your accounts today.</strong> Leave empty what you don't have.</p>
            <div class="grid grid-cols-1 sm:grid-cols-3 gap-3">${field('su-checking', 'Checking ($)', '', { type: 'number' })}${field('su-savings', 'Savings ($)', '', { type: 'number' })}${field('su-card', 'Credit card: what you owe ($)', '', { type: 'number' })}</div>${nav()}`;
        if (k === 'bills') {
            const items = (y.budgetBase || []).filter(i => !i.link).slice(0, 16);
            return `${dots}<p class="text-sm mb-3"><strong>Your main monthly bills.</strong> Type what you usually pay; 0 for what doesn't apply. You'll fine-tune the budget later.</p>
            <div class="grid grid-cols-1 sm:grid-cols-2 gap-x-3 gap-y-2">${items.map(i => `<label class="flex items-center justify-between gap-2 text-sm"><span data-i18n-skip>${esc(I18n.t(i.name))}</span><input class="input su-bill" style="max-width:8rem" type="number" inputmode="decimal" min="0" step="any" data-id="${i.id}" value="${Number(i.prep) || 0}" aria-label="${esc(I18n.t(i.name))}"></label>`).join('')}</div>${nav()}`;
        }
        if (k === 'debts') return `${dots}<p class="text-sm mb-3"><strong>Your debts</strong> (not the mortgage): cards, car, student or personal loans. Leave empty if none — great!</p>
            ${[0, 1, 2].map(i => `<div class="grid grid-cols-2 sm:grid-cols-4 gap-2 mb-2">${field(`su-d${i}-name`, 'Name', '', { ph: i ? '' : 'E.g. Visa' })}${field(`su-d${i}-bal`, 'Balance ($)', '', { type: 'number' })}${field(`su-d${i}-min`, 'Minimum a month ($)', '', { type: 'number' })}${field(`su-d${i}-rate`, 'Interest (%)', '', { type: 'number' })}</div>`).join('')}${nav('Finish')}`;
        return `<p class="text-sm"><i class="fa-solid fa-circle-check text-emerald-600"></i> <strong>Your plan is set up.</strong> Next: give every dollar a job in your budget, then log or import what you spend.</p>
            <p class="help mt-2">You can open this guide again from Settings.</p>
            <div class="flex justify-end gap-2 mt-4"><button type="button" class="btn btn-primary" data-action="setup.close">Go to my budget</button></div>`;
    }

    function draw() { if (sheet) { sheet.body.innerHTML = body(); const first = sheet.body.querySelector('input'); if (first && !Store.ui.noAutoFocus) first.focus({ preventScroll: true }); } }
    function open() {
        step = 0;
        sheet = UI.sheet({ title: 'Setup guide', icon: 'fa-compass', wide: true, html: body(), onClose: () => { sheet = null; done(); } });
    }
    function done() {
        if (!Store.state.settings.setupSeen) { Store.state.settings.setupSeen = true; Store.state.settings.welcomeDismissed = true; App.changed({ structural: true }); }
    }

    // Save what this step asked for.
    function save(k) {
        const s = Store.state, y = yd();
        if (k === 'household') {
            const names = val('su-names').split(',').map(x => x.trim()).filter(Boolean).slice(0, 8);
            const list = s.members || (s.members = []);
            names.forEach((n, i) => { if (!list.some(p => p.name.toLowerCase() === n.toLowerCase())) list.push({ id: Store.nextId(list), name: n.slice(0, 30), color: COLORS[(list.length + i) % COLORS.length] }); });
        } else if (k === 'pay') {
            if (val('su-type') === 'hourly') {
                y.payType = 'hourly';
                y.hourly = Object.assign({ rate: 0, hours: 40, otHours: 0, otRate: 1.5, otInBudget: false }, y.hourly || {}, { rate: num('su-rate'), hours: num('su-hours') || 40 });
                y.sueldo = Math.round(Engine.usGrossPay(y).baseM * 100) / 100;
            } else if (num('su-gross') > 0) { y.payType = 'salary'; y.sueldo = num('su-gross'); }
            const next = val('su-next') || Engine.isoDate(new Date()), d = new Date(next + 'T12:00'), f = val('su-freq');
            s.settings.paySchedule = f === 'monthly' ? { freq: 'monthly', days: [d.getDate()], interval: 1 }
                : f === 'semi' ? { freq: 'monthly', days: [15, 30], interval: 1 }
                    : { freq: 'weekly', weekday: d.getDay(), interval: f === 'biweekly' ? 2 : 1, anchor: next };
        } else if (k === 'accounts') {
            const accts = s.accounts || (s.accounts = []), today = Engine.isoDate(new Date());
            [['su-checking', 'Checking', 'corriente', 1], ['su-savings', 'Savings', 'ahorros', 1], ['su-card', 'Credit card', 'tarjeta', -1]].forEach(([id, name, kind, sign]) => {
                if (!val(id)) return;
                // Walking through again updates the account of that kind instead of adding a twin.
                const had = accts.find(a => a.kind === kind);
                if (had) { had.balance = sign * Math.abs(num(id)); had.updatedAt = today; return; }
                accts.push({ id: Store.nextId(accts), name: I18n.t(name), kind, balance: sign * Math.abs(num(id)), updatedAt: today });
            });
        } else if (k === 'bills') {
            (sheet ? [...sheet.body.querySelectorAll('.su-bill')] : []).forEach(el => {
                const i = (y.budgetBase || []).find(x => String(x.id) === el.dataset.id);
                if (i) { const v = Math.max(0, Fmt.parseNum(el.value, 0)); i.prep = v; i.real = v; }
            });
        } else if (k === 'debts') {
            const debts = s.debts || (s.debts = []);
            [0, 1, 2].forEach(i => {
                const name = val(`su-d${i}-name`), bal = num(`su-d${i}-bal`);
                if (!name || !(bal > 0) || debts.some(d => d.name.toLowerCase() === name.toLowerCase())) return;
                const min = num(`su-d${i}-min`) || Math.max(25, Math.round(bal * 0.02));
                const debt = { id: Store.nextId(debts), name: name.slice(0, 40), kind: /card|visa|master|amex|discover|tarjeta/i.test(name) ? 'tarjeta' : 'personal', balance: bal, originalBalance: bal, rate: num(`su-d${i}-rate`), minPayment: min, monthly: min, createdYear: new Date().getFullYear() };
                debts.push(debt);
                // The card typed on the accounts step is this debt: link them so it counts once.
                const card = debt.kind === 'tarjeta' && (s.accounts || []).find(a => a.kind === 'tarjeta' && !a.debtId);
                if (card) card.debtId = debt.id;
            });
        }
    }

    UI.register({
        'setup.open': () => open(),
        'setup.start': async () => {
            const s = Store.state;
            // The example family makes way for an empty plan; your own data is kept and completed.
            if (s.settings.sample) {
                if (!(await UI.confirm({ title: 'Start with my own data', message: 'The example family is removed and you start with an empty plan.', confirmText: 'Start' }))) return;
                App.commitHistory();
                Store.reset('empty');
                Store.ui.month = 'base';
            }
            Store.state.settings.welcomeDismissed = true;
            step = 1; draw();
            App.changed({ structural: true });
        },
        'setup.example': () => {
            Store.reset('example');
            Store.state.settings.setupSeen = true;
            if (sheet) sheet.close();
            App.changed({ structural: true });
        },
        'setup.redraw': () => { const t = val('su-type'); draw(); const el = document.getElementById('su-type'); if (el) el.value = t; },
        'setup.next': () => { save(STEPS[step]); App.changed({ structural: true }); step = Math.min(STEPS.length - 1, step + 1); draw(); },
        'setup.skip': () => { step = Math.min(STEPS.length - 1, step + 1); draw(); },
        'setup.back': () => { step = Math.max(1, step - 1); draw(); },
        'setup.close': () => { if (sheet) sheet.close(); App.changed({ step: true }); App.go('presupuesto/plan'); }
    });

    // A fresh install opens the guide once.
    function maybeOpen() {
        const st = Store.state.settings || {};
        if (st.setupSeen || st.welcomeDismissed || st.sample || Store.state.transactions.length) return;
        open();
    }

    window.Setup = { open, maybeOpen };
})();
