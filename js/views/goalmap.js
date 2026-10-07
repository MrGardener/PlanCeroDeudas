/* Goals like the bank's (Future → Debts & Goals): the total that goes to your goals each month,
   "+ Add a goal" (Savings, Debt payoff, Retirement), "Manage" (each kind with what it gets a month,
   the order debts are paid, a warning when the goals ask more than the budget has left), and a
   timeline that runs into the distance with each goal at the date it's reached. A slider moves the
   view to goals far away. Savings goals stay the budget's goal lines; debts stay the snowball. */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;

    const SAVE_KINDS = [
        ['emergency', 'fa-heart-pulse', 'Emergency fund'], ['auto', 'fa-car', 'Automobile'], ['college', 'fa-graduation-cap', 'College'],
        ['home', 'fa-house', 'Home'], ['recreational', 'fa-bicycle', 'Recreational'], ['vacation', 'fa-map-location-dot', 'Vacation'],
        ['electronic', 'fa-desktop', 'Electronic'], ['other', 'fa-money-bill-wave', 'Other']
    ];
    const kindIcon = (x) => x.type === 'retirement' ? 'fa-umbrella-beach' : x.type === 'debt' ? (x.kind === 'tarjeta' ? 'fa-credit-card' : 'fa-file-invoice-dollar') : ((SAVE_KINDS.find(k => k[0] === x.kind) || SAVE_KINDS[7])[1]);
    const ORDERS = [['avalanche', 'Highest interest first'], ['fastest', 'Fastest payoff first'], ['snowball', 'Lowest balance first'], ['highest-balance', 'Highest balance first']];
    const when = (today, m) => (m === null || m === undefined ? 'Never at this pace' : Fmt.monthYear(Engine.addMonths(today, m)));

    let last = null;   // the timeline as last drawn
    function timeline(ctx) {
        const s = ctx.state, r = s.retirement || {};
        return Engine.goalTimeline({ goals: s.goals, debts: s.debts, debtPlan: ctx.debts, retirement: r.goalOn ? r : null, today: ctx.today, toAssign: ctx.monthBudget ? ctx.monthBudget.balanceReal : 0 });
    }

    function render(ctx) {
        const host = document.getElementById('gm-map');
        if (!host) return;
        const t = last = timeline(ctx);
        UI.text('gm-total', money(t.total));
        const badge = document.getElementById('gm-badge');
        if (badge) badge.classList.toggle('hidden', !(t.attention || t.overBy > 0));
        if (!t.items.length) {
            host.innerHTML = `<div class="gm-welcome"><h3 class="text-xl font-bold">Welcome to Goals!</h3>
                <p class="text-sm text-slate-600 max-w-md">Goals help you plan your money in order and reach financial freedom. Plan months, years and even decades ahead.</p>
                <button type="button" class="btn btn-primary" data-action="gm.add">Get started</button></div>`;
            return;
        }
        // Years from now to the farthest goal; the slider picks where the view starts.
        const y0 = ctx.today.getFullYear(), far = Math.max(1, ...t.items.map(x => (x.months === null ? 0 : x.months / 12)));
        const span = Math.max(3, Math.min(12, Math.ceil(far) + 1));
        const maxStart = Math.max(0, Math.ceil(far) - span + 2);
        const start = Math.min(maxStart, Math.max(0, Number(Store.ui.gmStart) || 0));
        // Near years take more room (perspective): height from the bottom = sqrt(fraction of the view);
        // nearer goals are bigger. The road narrows to 28% of the width at the far end.
        const pos = (years) => Math.sqrt(Math.max(0, Math.min(1, (years - start) / span)));
        const edge = (p) => 36 * p;   // % from each side where the road's edge is at that height
        const lines = Array.from({ length: span + 1 }, (_, i) => start + i).map(k => { const p = pos(k); return `<div class="gm-year" style="bottom:${(p * 100).toFixed(1)}%;left:${edge(p).toFixed(1)}%;right:${edge(p).toFixed(1)}%"><span style="font-size:${(0.95 - 0.4 * p).toFixed(2)}rem">${y0 + k}</span></div>`; }).join('');
        const shown = t.items.filter(x => x.months !== null && x.months / 12 >= start - 0.01 && x.months / 12 <= start + span)
            .sort((a, b) => b.months - a.months);   // far ones first, so near ones sit on top
        // Place them nearest first, sliding sideways until they don't cover one another.
        const W = Math.max(220, (host.clientWidth || 340) - 50), H = 344, placed = [];
        const dots = shown.slice().reverse().map(x => {
            const p = pos(x.months / 12), size = Math.round(78 - 44 * p), r = size / 2, cy = H * (1 - p) - r * 0.3;
            let cx = W / 2;
            for (let k = 1; k < 40 && placed.some(o => Math.hypot(o.x - cx, o.y - cy) < o.r + r + 4); k++) cx = W / 2 + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * (r * 0.9);
            placed.push({ x: cx, y: cy, r });
            return `<button type="button" class="gm-dot is-${x.type} ${x.attention ? 'needs' : ''}" style="top:${(cy - r).toFixed(0)}px;left:${(cx - r).toFixed(0)}px;width:${size}px;height:${size}px;font-size:${(size / 2.6).toFixed(0)}px"
                data-action="gm.open" data-type="${x.type}" data-id="${esc(String(x.id))}" aria-label="${esc(`${I18n.t(x.name)}: ${when(ctx.today, x.months)}`)}"><i class="fa-solid ${kindIcon(x)}"></i></button>`;
        }).join('');
        const never = t.items.filter(x => x.months === null);
        host.innerHTML = `<div class="gm-wrap">
                <div class="gm-slider"><span>${y0 + start + span}</span><input type="range" min="0" max="${maxStart}" step="1" value="${start}" data-input="gm.scroll" aria-label="Move the timeline" ${maxStart ? '' : 'disabled'}><span>Now</span></div>
                <div class="gm-road"><div class="gm-track"></div>${lines}${dots}</div>
            </div>
            <p class="text-xs text-slate-500 mt-1">${esc(Fmt.MONTH_NAMES[ctx.today.getMonth()])} ${y0}. Tap a goal for its details; slide to see goals farther away.</p>
            ${never.length ? `<p class="text-xs text-red-600 mt-1"><i class="fa-solid fa-circle-exclamation"></i> Not on the line (nothing goes in yet): <span data-i18n-skip>${never.map(x => esc(I18n.t(x.name))).join(', ')}</span></p>` : ''}`;
    }

    // ------------------------------------------------------------------ sheets
    let sh = null;   // { sheet, view, ... } — one sheet, its views drawn inside
    function open(view, extra = {}) {
        if (sh && sh.sheet && document.body.contains(sh.sheet.el)) { Object.assign(sh, { view }, extra); draw(); return; }
        sh = Object.assign({ view }, extra);
        sh.sheet = UI.sheet({ title: 'Goals', icon: 'fa-location-arrow', wide: true, html: '<div id="gm-body"></div>', onClose: () => { sh = null; } });
        draw();
    }
    const head = (title, back) => `<div class="flex items-center gap-2 mb-3">${back ? `<button type="button" class="icon-btn icon-btn-light" data-action="gm.view" data-view="${back}" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button>` : ''}<strong>${title}</strong></div>`;
    function draw() {
        const host = document.getElementById('gm-body');
        if (!host || !sh) return;
        const ctx = App.buildContext(), s = ctx.state, t = last = timeline(ctx);
        const accounts = s.accounts || [];
        const bal = (a) => (['tarjeta', 'hipoteca'].includes(a.kind) ? -Math.abs(Number(a.balance) || 0) : Number(a.balance) || 0);
        switch (sh.view) {
            case 'type':
                host.innerHTML = head('Add a goal') + `<p class="text-sm font-semibold mb-2">Select a goal type</p>
                    ${[['savings', 'fa-piggy-bank', 'Savings', 'Start with an emergency fund. Then save for college, a new car, a dream vacation or anything else.'],
                        ['debt', 'fa-sack-dollar', 'Debt payoff', 'Once you have an emergency fund, the best thing for your finances is to pay off your debts.'],
                        ['retirement', 'fa-umbrella-beach', 'Retirement', 'The earlier you start saving for retirement, the more you\'ll enjoy those years.']].map(k => `<button type="button" class="gm-type is-${k[0]}" data-action="gm.view" data-view="${k[0] === 'savings' ? 'kinds' : k[0] === 'debt' ? 'debts' : 'retire'}"><span class="gm-type-icon"><i class="fa-solid ${k[1]}"></i></span><span><strong class="block">${esc(k[2])}</strong><span class="text-xs text-slate-500">${esc(k[3])}</span></span></button>`).join('')}`;
                return;
            case 'kinds':
                host.innerHTML = head('Save for…', 'type') + `<div class="range-list">${SAVE_KINDS.map(k => `<button type="button" data-action="gm.kind" data-kind="${k[0]}"><i class="fa-solid ${k[1]} text-emerald-600"></i> ${esc(k[2])}</button>`).join('')}</div>`;
                return;
            case 'newSaving': {
                const d = sh.draft, acct = accounts.find(a => String(a.id) === String(d.accountId));
                const saved = acct ? Math.max(0, bal(acct)) : 0, target = Fmt.parseNum(d.target, 0);
                host.innerHTML = head('Create a new goal', 'kinds') + `<div class="gm-goal-top"><span class="gm-dot-static is-savings"><i class="fa-solid ${(SAVE_KINDS.find(k => k[0] === d.kind) || SAVE_KINDS[7])[1]}"></i></span>
                        <div class="flex-1 min-w-0"><div class="text-lg font-semibold truncate" data-i18n-skip>${esc(d.name)}</div><div class="flex justify-between text-xs text-slate-500"><span>${money0(saved)} / ${money0(target)}</span><span>${target > 0 ? Math.round(Math.min(1, saved / target) * 100) : 0}%</span></div>
                        <div class="progress-track mt-1"><div class="progress-fill" style="width:${target > 0 ? Math.min(100, saved / target * 100).toFixed(1) : 0}%"></div></div></div></div>
                    <div class="acd-fields mt-3">
                        <label class="acd-field"><span>Goal name</span><input class="input" id="gm-name" maxlength="40" value="${esc(d.name)}" data-change="gm.draft" data-f="name"></label>
                        <label class="acd-field"><span>Amount to save</span><input type="number" class="input" id="gm-target" min="0" step="any" placeholder="Enter an amount" value="${esc(d.target)}" data-change="gm.draft" data-f="target"></label>
                        <label class="acd-field"><span>Account</span><select class="input" id="gm-account" data-change="gm.draft" data-f="accountId"><option value="">Select an account (or none)</option>${accounts.filter(a => !['tarjeta', 'hipoteca'].includes(a.kind)).map(a => `<option value="${a.id}" ${String(d.accountId) === String(a.id) ? 'selected' : ''}>${esc(a.name)} · ${money(bal(a))}</option>`).join('')}</select></label>
                        <label class="acd-field"><span>Each month</span><input type="number" class="input" id="gm-monthly" min="0" step="any" value="${esc(d.monthly)}" data-change="gm.draft" data-f="monthly"></label>
                    </div>
                    <p class="help mt-2">The goal goes into your budget's Savings with this amount each month. A linked account's balance is what's saved.</p>
                    <div class="flex justify-end mt-3"><button type="button" class="btn btn-primary" data-action="gm.saveSaving"><i class="fa-regular fa-circle-check"></i> Save</button></div>`;
                return;
            }
            case 'debts':
                host.innerHTML = head('Select debts to track', 'type') + (s.debts.filter(d => Number(d.balance) > 0).length ? `<div class="gm-list">${s.debts.filter(d => Number(d.balance) > 0).map(d => `<label class="fa-row"><input type="checkbox" data-change="gm.track" data-id="${d.id}" ${d.track === false ? '' : 'checked'}><span class="gm-dot-static is-debt sm"><i class="fa-solid ${d.kind === 'tarjeta' ? 'fa-credit-card' : 'fa-file-invoice-dollar'}"></i></span><span class="flex-1 min-w-0 truncate" data-i18n-skip>${esc(d.name)}</span><strong>${money(Number(d.balance) || 0)}</strong></label>`).join('')}</div>
                    <p class="help mt-2">Ticked debts show on your goals timeline. Every debt stays in your snowball either way.</p>`
                    : '<p class="help">No debts. Add one in the Debts card (or as a card or loan in Accounts).</p>');
                return;
            case 'retire': {
                const r = s.retirement || {}, d = sh.draft || (sh.draft = { birthday: r.birthday || '', age: r.edadJubilacion || 65, target: r.goalTarget || '', accounts: r.goalAccounts || accounts.filter(a => Engine.isRetirementMoney(a)).map(a => a.id), monthly: r.aporteMensual || 0 });
                const ret = accounts.filter(a => Engine.isRetirementMoney(a) || a.kind === 'ahorros' || a.kind === 'retiro');
                const saved = ret.filter(a => d.accounts.map(String).includes(String(a.id))).reduce((x, a) => x + Math.max(0, bal(a)), 0);
                host.innerHTML = head('Retirement', 'type') + `<div class="acd-fields">
                        <label class="acd-field"><span>Birthday</span><input type="date" class="input" id="gm-bday" value="${esc(d.birthday)}" data-change="gm.rdraft" data-f="birthday"></label>
                        <label class="acd-field"><span>Retirement age</span><input type="number" class="input" min="40" max="80" value="${esc(d.age)}" data-change="gm.rdraft" data-f="age"></label>
                        <label class="acd-field"><span>Desired savings</span><input type="number" class="input" id="gm-rtarget" min="0" step="any" value="${esc(d.target)}" data-change="gm.rdraft" data-f="target"></label>
                        <label class="acd-field"><span>Each month</span><input type="number" class="input" min="0" step="any" value="${esc(d.monthly)}" data-change="gm.rdraft" data-f="monthly"></label>
                    </div>
                    <div class="gl-head mt-3"><span>Current savings</span><span>${money0(saved)}</span></div>
                    <p class="help">Include all the accounts that save for your retirement. Don't see one? <a href="#" class="link" data-goto="patrimonio" data-focus="acct-hub">Add it here</a>.</p>
                    ${ret.map(a => `<label class="fa-row"><input type="checkbox" data-change="gm.raccount" data-id="${a.id}" ${d.accounts.map(String).includes(String(a.id)) ? 'checked' : ''}><span class="flex-1 truncate" data-i18n-skip>${esc(a.name)}</span><strong>${money(bal(a))}</strong></label>`).join('') || '<p class="help">No savings or retirement accounts yet.</p>'}
                    <p class="text-xs text-slate-500 mt-2">Assumes a 6.0% annual rate of return.</p>
                    <div class="flex justify-between mt-3">${r.goalOn ? '<button type="button" class="link text-red-600 text-sm" data-action="gm.retireOff">Remove the retirement goal</button>' : '<span></span>'}<button type="button" class="btn btn-primary" data-action="gm.saveRetire"><i class="fa-regular fa-circle-check"></i> Save</button></div>`;
                return;
            }
            case 'manage': {
                const by = (k) => t.items.filter(x => x.type === k), sum = (l, f) => l.reduce((a, x) => a + f(x), 0);
                const sav = by('savings'), debts = by('debt'), ret = by('retirement');
                const row = (dot, label, sub, amount, view) => `<button type="button" class="gm-row" data-action="gm.view" data-view="${view}"><span class="gm-bullet is-${dot}"></span><span class="flex-1 text-left"><span class="block font-semibold">${esc(I18n.t(label))}</span><span class="text-xs text-slate-500">${sub}</span></span><strong>${money0(amount)}</strong></button>`;
                host.innerHTML = head('Manage goals') + (t.overBy > 0 ? `<div class="bs-banner bad mb-3"><i class="fa-solid fa-circle-exclamation"></i> <span>You've overbudgeted your goals.</span> <span>Your goals ask ${money(t.overBy)} more than what's left in your budget.</span></div>` : '')
                    + (ret.length ? row('retirement', 'Retirement', `${ret.length} goal${ret.length === 1 ? '' : 's'}${ret[0].attention ? ` · <span class="text-red-600">${esc(I18n.t('Needs attention'))}</span>` : ''}`, ret[0].monthly, 'retire')
                        : '<div class="gm-row"><span class="gm-bullet is-retirement"></span><span class="flex-1 font-semibold">Retirement</span><button type="button" class="btn btn-secondary btn-sm" data-action="gm.view" data-view="retire">Add a retirement goal</button></div>')
                    + row('savings', 'Savings', `${sav.length} goal${sav.length === 1 ? '' : 's'}${sav.some(x => x.attention) ? `, <span class="text-red-600">${sav.filter(x => x.attention).length} ${esc(I18n.t('need attention'))}</span>` : ''}`, sum(sav, x => x.monthly), 'savings')
                    + row('debt', 'Debt payoff', `${debts.length} goal${debts.length === 1 ? '' : 's'}`, sum(debts, x => x.extra), 'debtPlan')
                    + `<div class="text-right font-bold mt-3">Total monthly contribution: ${money0(t.total)}</div>`;
                return;
            }
            case 'savings': {
                const sav = t.items.filter(x => x.type === 'savings'), top = sav.find(x => x.state !== 'reached');
                host.innerHTML = head('Savings', 'manage') + `<label class="field"><span class="field-label">Monthly contribution to the top savings goal${top ? ` (<span data-i18n-skip>${esc(top.name)}</span>)` : ''}</span><input type="number" class="input" id="gm-top-sav" min="0" step="any" value="${top ? top.monthly : 0}" ${top ? '' : 'disabled'}></label>
                    <div class="flex justify-center my-2"><button type="button" class="btn btn-secondary" data-action="gm.saveTopSav" ${top ? '' : 'disabled'}>Save</button></div>
                    <div class="gl-head mt-2"><span>In progress</span></div>
                    ${sav.map(x => `<button type="button" class="gm-row" data-action="gm.open" data-type="savings" data-id="${x.id}">${x.attention ? '<i class="fa-solid fa-circle-exclamation text-red-600"></i>' : '<span class="gm-bullet is-savings"></span>'}<span class="flex-1 text-left"><span class="block font-semibold" data-i18n-skip>${esc(x.name)}</span><span class="text-xs text-slate-500">${x.state === 'reached' ? 'Reached' : `Projected ${esc(when(ctx.today, x.months))}`}</span></span><span class="text-right"><strong class="block">${money0(x.monthly)}</strong><span class="text-xs text-slate-500">Monthly</span></span></button>`).join('') || '<p class="help">No savings goals yet.</p>'}`;
                return;
            }
            case 'debtPlan': {
                const debts = t.items.filter(x => x.type === 'debt'), extra = debts.reduce((a, x) => a + x.extra, 0), order = s.debtPlan.strategy || 'snowball';
                host.innerHTML = head('Debt payoff', 'manage') + `<p class="text-sm font-semibold">Additional monthly contribution to the top debt</p>
                    ${sh.editExtra ? `<div class="flex gap-2 items-center my-2"><input type="number" class="input" id="gm-extra" min="0" step="any" value="${Math.round(extra * 100) / 100}" style="max-width:10rem"><button type="button" class="btn btn-secondary" data-action="gm.saveExtra">Save</button></div>`
                        : `<div class="flex items-center gap-2 my-2"><span class="text-2xl font-black">${money0(extra)}</span><button type="button" class="icon-btn icon-btn-light" data-action="gm.editExtra" aria-label="Change it"><i class="fa-solid fa-pen"></i></button></div>`}
                    <div class="flex items-center justify-between gap-2 mt-3 border-b pb-2" style="border-color:var(--line)"><span class="font-semibold">In progress</span>
                        <select class="cell-input" style="width:auto" data-change="gm.order" aria-label="Order">${ORDERS.map(o => `<option value="${o[0]}" ${o[0] === order ? 'selected' : ''}>${esc(I18n.t(o[1]))}</option>`).join('')}</select></div>
                    ${debts.map(x => `<button type="button" class="gm-row" data-action="gm.open" data-type="debt" data-id="${x.id}"><span class="text-blue-600 font-bold w-5">${x.order}</span><span class="flex-1 text-left"><span class="block font-semibold"><span>Pay off</span> <span data-i18n-skip>${esc(x.name)}</span></span><span class="text-xs text-slate-500">Projected ${esc(when(ctx.today, x.months))}</span></span><span class="text-right"><strong class="block">${money0(x.minPayment)}${x.order === 1 && extra > 0 ? ' +' : ''}</strong><span class="text-xs text-slate-500">Monthly</span></span></button>`).join('') || '<p class="help">No debts being tracked.</p>'}
                    <p class="help mt-2">Lowest balance first is Dave Ramsey's debt snowball: quick wins keep you going.</p>`;
                return;
            }
            case 'details': {
                const x = t.items.find(i => i.type === sh.type && String(i.id) === String(sh.id));
                if (!x) { sh.view = 'manage'; draw(); return; }
                const pct = x.type === 'debt' ? (x.original > 0 ? 1 - x.balance / x.original : 0) : (x.target > 0 ? Math.min(1, x.saved / x.target) : 0);
                const progress = x.type === 'debt' ? `${money0(x.original - x.balance)} / ${money0(x.original)}` : `${money0(x.saved)} / ${money0(x.target)}`;
                const d = x.type === 'debt' ? s.debts.find(z => z.id === x.id) : null, g = x.type === 'savings' ? s.goals.find(z => z.id === x.id) : null;
                const acct = (d && (accounts.find(a => a.debtId === d.id) || null)) || (g && g.accountId && accounts.find(a => a.id === g.accountId));
                const due = d && Number(d.dueDay) >= 1 ? (() => { const n = new Date(ctx.today.getFullYear(), ctx.today.getMonth() + (ctx.today.getDate() > d.dueDay ? 1 : 0), d.dueDay); return Fmt.dayMonth(n) + ', ' + n.getFullYear(); })() : '—';
                const field = (label, v) => `<div class="acd-field"><span>${esc(I18n.t(label))}</span><span data-i18n-skip>${v}</span></div>`;
                host.innerHTML = `<div class="flex items-center gap-2 mb-3"><button type="button" class="icon-btn icon-btn-light" data-action="gm.view" data-view="${sh.back || 'manage'}" aria-label="Back"><i class="fa-solid fa-arrow-left"></i></button><strong>Goal details</strong>
                        <div class="relative ml-auto"><button type="button" class="icon-btn icon-btn-light" data-action="gm.menu" aria-label="More"><i class="fa-solid fa-ellipsis"></i></button>${sh.menu ? `<div class="tdt-menu" role="menu"><button type="button" role="menuitem" data-action="gm.remove"><i class="fa-solid ${x.type === 'debt' ? 'fa-eye-slash' : 'fa-trash-can'}"></i> ${x.type === 'debt' ? 'Stop tracking' : 'Delete goal'}</button></div>` : ''}</div></div>
                    <div class="gm-goal-top"><span class="gm-dot-static is-${x.type}"><i class="fa-solid ${kindIcon(x)}"></i></span><div class="flex-1 min-w-0"><div class="text-lg font-semibold truncate">${x.type === 'debt' ? `<span>Pay off</span> <span data-i18n-skip>${esc(x.name)}</span>` : `<span data-i18n-skip>${esc(I18n.t(x.name))}</span>`}</div>
                        <div class="flex justify-between text-xs text-slate-500"><span>${progress}</span><span>${Math.round(pct * 100)}%</span></div><div class="progress-track mt-1"><div class="progress-fill" style="width:${(pct * 100).toFixed(1)}%"></div></div></div></div>
                    <div class="acd-fields mt-3">
                        ${acct ? field('Account', esc(acct.name)) : ''}
                        ${x.type === 'debt' ? field('Minimum payment', money(x.minPayment)) + field('Interest', `${x.rate}%`) + field('Payment due', esc(due)) : field('Each month', money(x.monthly))}
                        ${field('Projected', esc(when(ctx.today, x.months)))}
                    </div>
                    ${x.type === 'savings' ? '<p class="help mt-2">Change the amount, the date or the account in the goal\'s card below.</p>' : x.type === 'debt' ? '<p class="help mt-2">Change the balance, rate or payments in the Debts card.</p>' : ''}`;
                return;
            }
        }
    }

    // ------------------------------------------------------------------ actions
    UI.register({
        'gm.add': () => open('type'),
        'gm.manage': () => open('manage'),
        'gm.view': (el) => { if (!sh) open(el.dataset.view); else { sh.view = el.dataset.view; sh.menu = false; sh.editExtra = false; if (el.dataset.view === 'retire') sh.draft = null; draw(); } },
        'gm.scroll': (el) => { Store.ui.gmStart = Number(el.value) || 0; render(App.buildContext()); },
        'gm.open': (el) => {
            const back = sh && sh.view ? sh.view : null;
            if (el.dataset.type === 'retirement') { open('retire', { draft: null }); return; }
            open('details', { type: el.dataset.type, id: el.dataset.id, back: back && back !== 'details' ? back : 'manage', menu: false });
        },
        'gm.kind': (el) => {
            const k = SAVE_KINDS.find(x => x[0] === el.dataset.kind) || SAVE_KINDS[7];
            sh.draft = { kind: k[0], name: I18n.t(k[2]), target: '', accountId: '', monthly: '' };
            sh.view = 'newSaving'; draw();
            setTimeout(() => { const i = document.getElementById('gm-target'); if (i) i.focus(); }, 30);
        },
        'gm.draft': (el) => { sh.draft[el.dataset.f] = el.value; draw(); },
        'gm.saveSaving': () => {
            const d = sh.draft, target = Math.max(0, Fmt.parseNum(d.target, 0));
            if (!(target > 0)) { UI.toast('Type the amount to save.', 'error'); return; }
            let created = null;
            App.undoable(`Goal added: ${d.name}`, () => {
                const goals = Store.state.goals, acct = d.accountId ? (Store.state.accounts || []).find(a => String(a.id) === String(d.accountId)) : null;
                created = { id: Store.nextId(goals), name: (d.name || I18n.t('Other')).slice(0, 40), kind: d.kind, target, current: acct ? Math.max(0, Number(acct.balance) || 0) : 0, monthly: Math.max(0, Fmt.parseNum(d.monthly, 0)), rate: Number(Store.active().tasa) || 0, createdYear: new Date().getFullYear() };
                if (acct) created.accountId = acct.id;
                goals.push(created);
            });
            if (sh && sh.sheet) sh.sheet.close();
            UI.toast('Goal added to your budget\'s Savings.', 'ok');
        },
        'gm.track': (el) => {
            const d = Store.state.debts.find(x => x.id === Number(el.dataset.id));
            if (!d) return;
            if (el.checked) delete d.track; else d.track = false;
            App.changed({ structural: true });
        },
        'gm.rdraft': (el) => { sh.draft[el.dataset.f] = el.value; draw(); },
        'gm.raccount': (el) => { const id = Number(el.dataset.id), a = sh.draft.accounts.map(Number); sh.draft.accounts = el.checked ? [...new Set(a.concat([id]))] : a.filter(x => x !== id); draw(); },
        'gm.saveRetire': () => {
            const d = sh.draft, target = Math.max(0, Fmt.parseNum(d.target, 0));
            if (!/^\d{4}-\d\d-\d\d$/.test(d.birthday || '')) { UI.toast('Type your birthday.', 'error'); return; }
            if (!(target > 0)) { UI.toast('Type how much you want to have saved.', 'error'); return; }
            App.undoable('Retirement goal saved', () => {
                const r = Store.state.retirement, accts = Store.state.accounts || [];
                const b = new Date(d.birthday + 'T00:00:00'), t = new Date();
                r.goalOn = true; r.birthday = d.birthday; r.goalTarget = target; r.goalAccounts = d.accounts.map(Number);
                r.goalSaved = accts.filter(a => r.goalAccounts.includes(a.id)).reduce((x, a) => x + Math.max(0, Number(a.balance) || 0), 0);
                r.edadJubilacion = Math.max(40, Math.min(80, Math.round(Fmt.parseNum(d.age, 65))));
                r.edadActual = t.getFullYear() - b.getFullYear() - (t < new Date(t.getFullYear(), b.getMonth(), b.getDate()) ? 1 : 0);
                r.aporteMensual = Math.max(0, Fmt.parseNum(d.monthly, 0));
            });
            open('manage');
        },
        'gm.retireOff': () => { App.undoable('Retirement goal removed', () => { Store.state.retirement.goalOn = false; }); open('manage'); },
        'gm.saveTopSav': () => {
            const top = last && last.items.find(x => x.type === 'savings' && x.state !== 'reached');
            const v = Math.max(0, Fmt.parseNum((document.getElementById('gm-top-sav') || {}).value, 0));
            if (!top) return;
            App.undoable(`${top.name}: ${money0(v)} a month`, () => { const g = Store.state.goals.find(x => x.id === top.id); if (g) g.monthly = v; });
            draw();
        },
        'gm.editExtra': () => { sh.editExtra = true; draw(); const i = document.getElementById('gm-extra'); if (i) { i.focus(); i.select(); } },
        // The extra goes to the debt first in the order; the others get their minimum (the snowball
        // rolls each paid-off payment into the next one by itself).
        'gm.saveExtra': () => {
            const v = Math.max(0, Fmt.parseNum((document.getElementById('gm-extra') || {}).value, 0));
            const ctx = App.buildContext(), first = ctx.debts.items.find(i => { const d = Store.state.debts.find(z => z.id === i.id); return d && Number(d.balance) > 0; });
            App.undoable(`Extra for debts: ${money0(v)} a month`, () => {
                Store.state.debts.forEach(d => { if (Number(d.balance) > 0) d.monthly = Number(d.minPayment) || 0; });
                const d = first && Store.state.debts.find(z => z.id === first.id);
                if (d) d.monthly = Math.round(((Number(d.minPayment) || 0) + v) * 100) / 100;
            });
            sh.editExtra = false; draw();
        },
        'gm.order': (el) => { Store.state.debtPlan.strategy = el.value; App.changed({ structural: true, step: true }); draw(); },
        'gm.menu': () => { sh.menu = !sh.menu; draw(); },
        'gm.remove': async () => {
            const type = sh.type, id = sh.id;
            if (type === 'debt') {
                App.undoable('Debt no longer on the goals timeline', () => { const d = Store.state.debts.find(x => String(x.id) === String(id)); if (d) d.track = false; });
            } else {
                const g = Store.state.goals.find(x => String(x.id) === String(id));
                if (!g || !(await UI.confirm({ title: 'Delete this goal?', message: 'It\'s removed from your goals and your budget. You can undo it.', confirmText: 'Delete', danger: true }))) return;
                App.undoable(`Goal deleted: ${g.name}`, () => { Store.state.goals = Store.state.goals.filter(x => x !== g); });
            }
            sh.view = sh.back || 'manage'; sh.menu = false; draw();
        }
    });

    window.GoalMap = { render, open };
})();
