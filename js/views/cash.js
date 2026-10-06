/*
 * Cash ahead: "Seguro para gastar" (safe to spend today) and the money calendar.
 * Both read the same picture: cash in checking/cash accounts, bills with a due day, repeating
 * or scheduled transactions, paydays (net salary of each month) and savings still to set aside.
 * The math lives in Engine (cashNow, cashEvents, safeToSpend, cashForecast).
 */
(function () {
    'use strict';
    const { money, money0, esc } = Fmt;
    const iso = (d) => Engine.isoDate(d);
    const lastOfMonth = (y, m) => new Date(y, m, 0);

    // Budget lines, what was spent on them and the net pay, for one month (null if that year
    // isn't part of the plan).
    // A year not set up yet borrows the closest configured year's plan and salary.
    function monthData(y, m) {
        const years = Object.keys(Store.state.years).map(Number).filter(Boolean);
        if (!years.length) return null;
        const src = Store.state.years[y] ? y : years.reduce((a, b) => (Math.abs(b - y) < Math.abs(a - y) ? b : a));
        const yd = Store.effective(src);
        const items = Engine.monthItems(yd, String(m));
        const spend = Engine.lineSpend(items, Store.state.transactions, y, String(m));
        const payroll = Engine.payroll(yd);
        const mb = Engine.monthBudget(yd, String(m), payroll);
        return { year: y, month: m, items, spend, pay: mb.salary, payBase: payroll.netoM, other: Engine.otherIncome(yd, String(m)).planned, sweep: mb.sweep, tasa: Number(yd.tasa) || 0 };
    }

    // Months touched by [from, to], each with its data.
    function monthsBetween(fromISO, toISO) {
        const out = [];
        const [fy, fm] = fromISO.split('-').map(Number), [ty, tm] = toISO.split('-').map(Number);
        for (let y = fy, m = fm; y < ty || (y === ty && m <= tm); m === 12 ? (y++, m = 1) : m++) {
            const d = monthData(y, m);
            if (d) out.push(d);
        }
        return out;
    }

    // How the salary arrives (Ingresos → ¿Cómo te pagan?); older data only had days of the month.
    const paySchedule = () => Engine.normalizeSchedule(Store.state.settings.paySchedule || Store.state.settings.paydays);

    // For forecasts, a salary with no pay rhythm set is assumed to arrive on the last day of each
    // month (instead of never) — the views say so and invite to set the real one.
    const ASSUMED_SCHEDULE = { freq: 'monthly', days: [31] };
    function events(fromISO, toISO, opts = {}) {
        const s = Store.state;
        const months = monthsBetween(fromISO, toISO);
        const pay = {}, base = {};
        months.forEach(d => { const k = `${d.year}-${String(d.month).padStart(2, '0')}`; pay[k] = d.pay; base[k] = d.payBase; });
        const schedule = paySchedule() || (opts.assume ? Engine.normalizeSchedule(ASSUMED_SCHEDULE) : null);
        return { months, assumed: !paySchedule() && !!opts.assume, list: Engine.cashEvents({ from: fromISO, to: toISO, months, recurring: s.recurring, schedule, payPerMonth: pay, payBase: base, oneOff: s.cashEvents || [] }) };
    }

    // Savings and goal lines of this month: what they still need.
    function setAsideNow(d) {
        if (!d) return 0;
        return d.items.filter(i => Engine.isSavingsItem(i)).reduce((t, i) => t + Math.max(0, (Number(i.real) || 0) - ((d.spend.byLine[String(i.id)] || {}).spent || 0)), 0);
    }

    // Everyday spending with no fixed date (lines without a due day, savings aside), spread
    // evenly: this month what's left over the days left, other months the plan over the month.
    function dailyByMonth(months, today) {
        const out = {};
        const t = new Date(today);
        months.forEach(d => {
            const lines = d.items.filter(i => !Engine.isSavingsItem(i) && !(Number(i.dueDay) >= 1) && i.type !== 'Ingreso');
            const key = `${d.year}-${String(d.month).padStart(2, '0')}`;
            const days = lastOfMonth(d.year, d.month).getDate();
            if (d.year === t.getFullYear() && d.month === t.getMonth() + 1) {
                const left = lines.reduce((a, i) => a + Math.max(0, (Number(i.real) || 0) - ((d.spend.byLine[String(i.id)] || {}).spent || 0)), 0);
                out[key] = left / (days - t.getDate() + 1);
            } else out[key] = lines.reduce((a, i) => a + (Number(i.real) || 0), 0) / days;
        });
        return out;
    }

    function safeContext(today = new Date()) {
        const s = Store.state;
        const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const cash = Engine.cashNow(s.accounts, s.transactions, t);
        // Until the next payday after today (today's pay is assumed to be in the balance already).
        const tomorrow = new Date(t.getFullYear(), t.getMonth(), t.getDate() + 1);
        const pd = Engine.nextPayday(paySchedule(), tomorrow);
        const until = pd ? pd.date : lastOfMonth(t.getFullYear(), t.getMonth() + 1);
        const ev = events(iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(until));
        const cur = ev.months.find(d => d.year === t.getFullYear() && d.month === t.getMonth() + 1);
        const buffer = Math.max(0, Number(s.settings.cashBuffer) || 0);
        const res = cash ? Engine.safeToSpend({ cash: cash.total, today: t, until: iso(until), events: ev.list, setAside: setAsideNow(cur), buffer }) : null;
        return { cash, res, until, hasPaydays: !!pd, buffer };
    }

    // ------------------------------------------------------------------ safe to spend
    const PART_COLORS = { bills: '#64748b', scheduled: '#94a3b8', setAside: '#2a78d6', buffer: '#cbd5e1', safe: '#1baf7a' };

    function renderSafe(today) {
        const host = document.getElementById('dash-safe');
        if (!host) return;
        const c = safeContext(today);
        const untilLabel = Fmt.dayMonth(c.until);
        if (!c.cash) {
            host.innerHTML = `<div class="flex flex-col sm:flex-row sm:items-center gap-3 justify-between">
                <p class="text-sm text-slate-600">To know how much you can spend today without coming up short, tell us how much is in your checking account or cash. We subtract your pending bills, your goals and your cushion.</p>
                <div class="flex flex-wrap gap-2 shrink-0">
                    <button type="button" class="btn btn-primary btn-sm" data-action="safe.addAccount"><i class="fa-solid fa-building-columns"></i> Add my balance</button>
                    <a href="#" class="btn btn-secondary btn-sm" data-goto="transacciones/importar">Import a bank statement</a>
                </div></div>`;
            return;
        }
        const r = c.res;
        const neg = r.safe < 0;
        const parts = [['bills', 'Bills due before your payday', r.bills], ['scheduled', 'Scheduled and subscriptions', r.scheduled], ['setAside', 'Goals and savings to set aside this month', r.setAside], ['buffer', 'Your cushion', r.buffer]];
        const total = Math.max(r.cash, parts.reduce((a, p) => a + p[2], 0) + Math.max(0, r.safe), 1);
        const seg = (k, v) => v > 0 ? `<span style="width:${(v / total * 100).toFixed(2)}%;background:${PART_COLORS[k]}" title="${money(v)}"></span>` : '';
        host.innerHTML = `
            <div class="grid grid-cols-1 lg:grid-cols-5 gap-5 items-start">
                <div class="lg:col-span-2">
                    <div class="kpi-label">${neg ? 'Short before your payday' : 'Safe to use'}</div>
                    <div class="safe-hero ${neg ? 'neg' : ''}" id="safe-amount">${neg ? '−' : ''}${money0(Math.abs(r.safe))}</div>
                    <p class="text-sm text-slate-600 mt-1">${neg
                        ? `What you have doesn't cover what has to go out until ${untilLabel}. Move money from savings, postpone an expense or lower your cushion.`
                        : `≈ <strong>${money0(r.perDay)} per day</strong> until ${c.hasPaydays ? `your payday on ${untilLabel}` : `${untilLabel} (end of month)`}.`}</p>
                    ${c.hasPaydays ? '' : '<p class="help mt-1"><a href="#" class="link" data-goto="presupuesto/ingresos" data-focus="pay-schedule">Tell us how you get paid</a> to calculate until your next paycheck.</p>'}
                </div>
                <div class="lg:col-span-3">
                    <div class="safe-bar" role="img" aria-label="How your cash is split">${parts.map(p => seg(p[0], p[2])).join('')}${seg('safe', Math.max(0, r.safe))}</div>
                    <table class="safe-table">
                        <tr><td>Cash in your accounts${c.cash.adjust ? ` <span class="help">(balance on ${esc(c.cash.asOf)} ${c.cash.adjust > 0 ? '+' : '−'} ${money(Math.abs(c.cash.adjust))} logged since)</span>` : ` <span class="help">(al ${esc(c.cash.asOf)})</span>`}</td><td class="num font-bold">${money(r.cash)}</td></tr>
                        ${parts.map(([k, label, v]) => `<tr><td><i class="safe-dot" style="background:${PART_COLORS[k]}"></i>${label}${k === 'buffer' ? ` <input type="number" min="0" step="10" class="cell-input num safe-buffer" data-change="safe.buffer" value="${c.buffer || ''}" placeholder="0" aria-label="Cushion">` : ''}</td><td class="num">−${money(v)}</td></tr>`).join('')}
                        <tr class="safe-total"><td><i class="safe-dot" style="background:${PART_COLORS.safe}"></i>Safe to spend</td><td class="num">${neg ? '−' : ''}${money(Math.abs(r.safe))}</td></tr>
                    </table>
                    ${r.items.length ? `<details class="mt-2"><summary class="link text-xs">See the ${r.items.length} payment${r.items.length === 1 ? '' : 's'} counted</summary><ul class="text-xs mt-1 space-y-0.5">${r.items.map(e => `<li class="flex justify-between gap-3"><span>${esc(e.date.slice(8))}/${esc(e.date.slice(5, 7))} · ${esc(e.name)}${e.date < Engine.isoDate(new Date()) ? ' <span class="badge badge-bad">vencido</span>' : ''}</span><span class="num">−${money(-e.amount)}</span></li>`).join('')}</ul></details>` : ''}
                </div>
            </div>
            <p class="help mt-3">Only counts your checking and cash accounts (not savings). Credit card purchases don't lower your account until you pay the card. It's only as accurate as your balances: update them or import your statement often.</p>`;
    }

    // ------------------------------------------------------------------ money calendar
    const DOW = Fmt.DOW_SHORT;
    const short = (v) => { const a = Math.abs(v); const t = a >= 10000 ? `${Math.round(a / 1000)}k` : a >= 1000 ? `${(a / 1000).toFixed(1)}k` : Math.round(a).toString(); return `${v < 0 ? '−' : ''}${Fmt.currency().symbol}${t}`; };

    function calendarData(offset, today = new Date()) {
        const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const first = new Date(t.getFullYear(), t.getMonth() + offset, 1);
        const last = lastOfMonth(first.getFullYear(), first.getMonth() + 1);
        const ev = events(iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(last));
        const cash = Engine.cashNow(Store.state.accounts, Store.state.transactions, t);
        const buffer = Math.max(0, Number(Store.state.settings.cashBuffer) || 0);
        const forecast = cash ? Engine.cashForecast({ from: iso(t), to: iso(last), start: cash.total, events: ev.list, dailyByMonth: dailyByMonth(ev.months, t), buffer }) : [];
        const byDay = {};
        forecast.forEach(d => { byDay[d.date] = d; });
        const evBy = {};
        ev.list.forEach(e => { (evBy[e.date] = evBy[e.date] || []).push(e); });
        const days = [];
        for (let d = 1; d <= last.getDate(); d++) {
            const date = iso(new Date(first.getFullYear(), first.getMonth(), d));
            days.push({ day: d, date, events: evBy[date] || [], f: byDay[date] || null, past: date < iso(t), today: date === iso(t) });
        }
        return { first, last, days, cash, buffer, lead: (first.getDay() + 6) % 7, hasPaydays: !!paySchedule() };
    }

    function renderCalendar(today) {
        const host = document.getElementById('dash-cal');
        if (!host) return;
        const offset = Math.max(0, Math.min(2, Number(Store.ui.calOffset) || 0));
        const c = calendarData(offset, today);
        UI.text('dash-cal-month', `${Fmt.MONTH_NAMES[c.first.getMonth()]} ${c.first.getFullYear()}`);
        const chip = (e) => `<span class="cal-ev ${e.amount > 0 ? 'in' : e.paid ? 'paid' : 'out'}" title="${esc(e.name)}: ${e.amount > 0 ? '+' : e.paid ? 'pagado ' : '−'}${money(e.paid ? e.planned : Math.abs(e.amount))}">${e.amount > 0 ? '+' : e.paid ? '✓ ' : '−'}${short(e.paid ? e.planned : Math.abs(e.amount))} <span class="cal-ev-name">${esc(e.name)}</span></span>`;
        const cells = Array(c.lead).fill('<div class="cal-cell cal-empty" aria-hidden="true"></div>').concat(c.days.map(d => {
            const st = d.f ? d.f.status : '';
            return `<div class="cal-cell ${d.past ? 'past' : ''} ${d.today ? 'today' : ''} ${st === 'low' ? 'low' : st === 'short' ? 'short' : ''}" data-date="${d.date}">
                <div class="cal-day">${d.day}</div>
                <div class="cal-evs">${d.events.slice(0, 2).map(chip).join('')}${d.events.length > 2 ? `<span class="cal-more">+${d.events.length - 2}</span>` : ''}</div>
                ${d.f ? `<div class="cal-bal" title="Projected balance at the end of the day">${short(d.f.balance)}</div>` : ''}
            </div>`;
        }));
        const low = c.days.filter(d => d.f && d.f.status !== 'ok');
        const shortN = low.filter(d => d.f.status === 'short').length, lowN = low.length - shortN;
        const worst = c.days.filter(d => d.f).sort((a, b) => a.f.balance - b.f.balance)[0];
        const agenda = c.days.filter(d => d.events.length || (d.f && d.f.status !== 'ok' && (!low[0] || d === low[0])));
        host.innerHTML = `
            ${c.cash ? (worst ? `<div class="bs-banner ${worst.f.status === 'short' ? 'bad' : worst.f.status === 'low' ? 'warn' : 'ok'} mb-3" id="cal-note">${worst.f.status === 'ok'
                ? `<i class="fa-solid fa-circle-check"></i> This month you don't go below ${money0(worst.f.balance)} (${Fmt.dayMonth(new Date(c.first.getFullYear(), c.first.getMonth(), worst.day))}).`
                : `<i class="fa-solid fa-triangle-exclamation"></i> ${[shortN ? `${shortN} day${shortN === 1 ? '' : 's'} without enough money` : '', lowN ? `${lowN} day${lowN === 1 ? '' : 's'} below your cushion` : ''].filter(Boolean).join(' y ')}. The tightest: ${Fmt.dayMonth(new Date(c.first.getFullYear(), c.first.getMonth(), worst.day))} with ${worst.f.balance < 0 ? '−' : ''}${money0(Math.abs(worst.f.balance))}. Bring income forward, move a payment or set money aside before then.`}</div>` : '')
                : '<p class="help mb-3">Add your account balance (Net Worth → Accounts) to see how much you\'ll have each day and the days you\'d come up short.</p>'}
            <div class="cal-grid" role="grid" aria-label="Calendar of payments and income">
                ${DOW.map(d => `<div class="cal-dow">${d}</div>`).join('')}
                ${cells.join('')}
            </div>
            <div class="cal-legend"><span><i class="cal-sw in"></i>Ingreso</span><span><i class="cal-sw out"></i>Payment</span><span><i class="cal-sw paid"></i>Paid</span>${c.cash ? `<span><i class="cal-sw low"></i>Below your cushion${c.buffer ? ` (${money0(c.buffer)})` : ''}</span><span><i class="cal-sw short"></i>No money</span><span class="help">Bottom number: projected balance, with everyday spending spread evenly.</span>` : ''}</div>
            ${c.hasPaydays ? '' : '<p class="help mt-2">Without your paydays we can\'t see your pay arrive: <a href="#" class="link" data-goto="presupuesto/ingresos" data-focus="pay-schedule">tell us how you\'re paid</a>.</p>'}
            ${agenda.length ? `<details class="mt-3" ${window.innerWidth < 640 ? 'open' : ''}><summary class="link text-xs">This month's list (${agenda.length} day${agenda.length === 1 ? '' : 's'})</summary>
                <table class="table mt-2"><thead><tr><th>Day</th><th>Transaction</th><th class="num">Amount</th><th class="num">Projected balance</th></tr></thead><tbody>${agenda.map(d => `<tr class="${d.f && d.f.status !== 'ok' ? 'highlight' : ''}"><td>${d.day}</td><td>${d.events.map(e => esc(e.name) + (e.paid ? ' ✓' : '')).join(', ') || '—'}</td><td class="num">${d.events.map(e => (e.amount > 0 ? '+' : '−') + money(e.paid ? e.planned : Math.abs(e.amount))).join(', ')}</td><td class="num">${d.f ? money(d.f.balance) : '—'}</td></tr>`).join('')}</tbody></table></details>` : ''}`;
        UI.$$('[data-action="cal.move"]').forEach(b => { b.disabled = (Number(b.dataset.step) < 0 && offset === 0) || (Number(b.dataset.step) > 0 && offset === 2); });
    }

    UI.register({
        'cal.move': (el) => { Store.ui.calOffset = Math.max(0, Math.min(2, (Number(Store.ui.calOffset) || 0) + Number(el.dataset.step))); renderCalendar(new Date()); },
        'safe.addAccount': () => {
            App.go('patrimonio', { focus: 'nw-accounts' });
            if (!(Store.state.accounts || []).some(Engine.isCashAccount)) {
                const b = document.querySelector('[data-action="acct.add"]');
                if (b) b.click();
                const acc = Store.state.accounts[Store.state.accounts.length - 1];
                if (acc) { acc.kind = 'corriente'; acc.name = 'Checking account'; App.changed({ structural: true }); }
            }
        },
        'safe.buffer': (el) => { Store.state.settings.cashBuffer = Math.max(0, Fmt.parseNum(el.value, 0)); App.changed({ structural: true, step: true }); }
    });

    // ------------------------------------------------------------------ cash flow
    // The money calendar's balance as one line for the next 30/60/90 days, red below $0, with
    // the cash events you added marked on it (and listed under it to remove).
    function renderFlow(today) {
        const canvas = document.getElementById('flow-chart');
        if (!canvas) return;
        const s = Store.state, pal = UI.palette();
        const days = [30, 60, 90].includes(Number(Store.ui.flowDays)) ? Number(Store.ui.flowDays) : 30;
        UI.$$('[data-action="flow.days"]').forEach(b => b.classList.toggle('active', Number(b.dataset.days) === days));
        const t = new Date(today.getFullYear(), today.getMonth(), today.getDate());
        const end = new Date(t.getFullYear(), t.getMonth(), t.getDate() + days - 1);
        const dateEl = document.getElementById('flow-date');
        if (dateEl && !dateEl.value) dateEl.value = iso(new Date(t.getFullYear(), t.getMonth(), t.getDate() + 7));
        const upcoming = (s.cashEvents || []).filter(e => e.date >= iso(t)).sort((a, b) => a.date.localeCompare(b.date));
        UI.html('flow-events', upcoming.length ? upcoming.map(e => `<div class="flex items-center justify-between gap-2 text-sm"><span><span class="text-slate-500">${esc(Fmt.dayMonth(new Date(e.date + 'T00:00:00')))}</span> · <span data-i18n-skip>${esc(e.name || '—')}</span></span>
                <span class="flex items-center gap-1"><strong class="${e.amount < 0 ? 'text-red-600' : 'text-emerald-700'}">${e.amount < 0 ? '−' : '+'}${money(Math.abs(e.amount))}</strong><button type="button" class="row-del" data-action="flow.del" data-id="${e.id}" aria-label="Remove"><i class="fa-solid fa-xmark"></i></button></span></div>`).join('')
            : '<p class="text-xs text-slate-400">None yet.</p>');
        const cash = Engine.cashNow(s.accounts, s.transactions, t);
        UI.show('flow-body', !!cash);
        if (!cash) { UI.html('flow-note', '<p class="help mb-3">Add your checking account balance (Net Worth → Accounts) to see your cash flow.</p>'); return; }
        const ev = events(iso(new Date(t.getFullYear(), t.getMonth(), 1)), iso(end), { assume: true });
        const buffer = Math.max(0, Number(s.settings.cashBuffer) || 0);
        const f = Engine.cashForecast({ from: iso(t), to: iso(end), start: cash.total, events: ev.list, dailyByMonth: dailyByMonth(ev.months, t), buffer });
        const worst = f.reduce((a, d) => (d.balance < a.balance ? d : a), f[0]);
        const day = (d) => Fmt.dayMonth(new Date(d.date + 'T00:00:00'));
        const firstShort = f.find(d => d.balance < 0);
        UI.html('flow-note', `<div class="bs-banner ${firstShort ? 'bad' : worst.balance < buffer ? 'warn' : 'ok'} mb-3">${firstShort
            ? `<i class="fa-solid fa-triangle-exclamation"></i> Below $0 on ${day(firstShort)}. Lowest: ${money0(worst.balance)} on ${day(worst)}.`
            : `<i class="fa-solid fa-circle-check"></i> Your lowest point: ${money0(worst.balance)} on ${day(worst)}.`}</div>`
            + (ev.assumed ? '<p class="help mb-2">Pay assumed on the last day of each month: <a href="#" class="link" data-goto="presupuesto/ingresos" data-focus="pay-schedule">set your paydays</a>.</p>' : ''));
        const oneOff = (d) => d.events.filter(e => e.kind === 'oneoff');
        const red = pal.neg, blue = pal.series[0];
        UI.chart('flow-chart', {
            type: 'line',
            data: {
                labels: f.map(d => `${Fmt.MONTH_SHORT[Number(d.date.slice(5, 7)) - 1]} ${Number(d.date.slice(8))}`),
                datasets: [{
                    label: 'Balance', data: f.map(d => Math.round(d.balance * 100) / 100), borderColor: blue, borderWidth: 2, tension: 0.15,
                    fill: { target: 'origin', above: blue + '22', below: red + '55' },
                    segment: { borderColor: (c) => (c.p0.parsed.y < 0 || c.p1.parsed.y < 0 ? red : undefined) },
                    pointRadius: f.map(d => (oneOff(d).length ? 6 : 0)), pointHoverRadius: 5,
                    pointBackgroundColor: f.map(d => (!oneOff(d).length ? blue : oneOff(d).some(e => e.amount < 0) ? red : pal.series[2])), pointBorderColor: pal.surface, pointBorderWidth: 2
                }]
            },
            options: {
                scales: { y: { beginAtZero: false, grid: { color: (c) => (c.tick && c.tick.value === 0 ? pal.text2 : 'rgba(148,163,184,.18)') } } },
                plugins: {
                    legend: { display: false },
                    todayLine: { index: 0, label: 'Today' },
                    tooltip: { callbacks: { label: (c) => { const d = f[c.dataIndex]; return [`${I18n.t('Balance')}: ${money(d.balance)}`].concat(d.events.map(e => `${e.amount < 0 ? '−' : '+'}${money(Math.abs(e.amount))} ${I18n.t(e.name)}`)).join(' · '); } } }
                }
            }
        });
    }

    UI.register({
        'flow.days': (el) => { Store.ui.flowDays = Number(el.dataset.days); renderFlow(new Date()); },
        'flow.add': () => {
            const date = (document.getElementById('flow-date') || {}).value, name = ((document.getElementById('flow-name') || {}).value || '').trim();
            const amount = Math.abs(Fmt.parseNum((document.getElementById('flow-amount') || {}).value, 0));
            if (!date || !(amount > 0)) { UI.toast('Type a date and an amount.', 'error'); return; }
            const dir = (document.getElementById('flow-dir') || {}).value === 'in' ? 1 : -1;
            App.undoable(`Cash event added: ${name || money(amount)}`, () => {
                const list = Store.state.cashEvents || (Store.state.cashEvents = []);
                list.push({ id: Store.nextId(list), date, name: name.slice(0, 40), amount: dir * amount });
            });
            ['flow-name', 'flow-amount'].forEach(id => { const el = document.getElementById(id); if (el) el.value = ''; });
        },
        'flow.del': (el) => {
            const id = Number(el.dataset.id), e = (Store.state.cashEvents || []).find(x => x.id === id);
            if (!e) return;
            App.undoable(`Cash event removed: ${e.name || money(Math.abs(e.amount))}`, () => { Store.state.cashEvents = Store.state.cashEvents.filter(x => x.id !== id); });
        }
    });

    // ------------------------------------------------------------------ forecast
    // What the plan says will come in and go out between two dates: dated paydays and repeating
    // income, plus each month's budget (other incomes, spending, savings, debt payments).
    function forecastInputs(fromISO, toISO) {
        const ev = events(fromISO, toISO, { assume: true });
        const monthly = {};
        ev.months.forEach(d => {
            const k = `${d.year}-${String(d.month).padStart(2, '0')}`;
            const lines = d.items.filter(i => i.type !== 'Ingreso');
            const real = (i) => Number(i.real) || 0;
            monthly[k] = {
                income: d.other,
                savings: lines.filter(i => Engine.isSavingsItem(i)).reduce((a, i) => a + real(i), 0) + d.sweep,
                debt: lines.filter(i => i.type === 'Deuda').reduce((a, i) => a + real(i), 0),
                expense: lines.filter(i => !Engine.isSavingsItem(i) && i.type !== 'Deuda').reduce((a, i) => a + real(i), 0)
            };
        });
        return { monthly, assumed: ev.assumed, events: ev.list.filter(e => e.amount > 0 && (e.kind === 'payday' || e.kind === 'income')), months: ev.months };
    }

    window.Cash = { forecastInputs, paySchedule, safeContext, events, dailyByMonth, monthsBetween, renderSafe, calendarData, renderCalendar, renderFlow };
})();
