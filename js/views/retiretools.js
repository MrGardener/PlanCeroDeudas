/* Futuro → Jubilación (US) → "Your 401(k) and IRA": three small tools.
 * - The employer's match (Engine.matchOptimizer): the match formula is kept on the year
 *   (yd.matchTiers); your contribution comes from your paycheck's 401(k) deductions.
 * - Roth or traditional (Engine.rothVsTraditional): on screen only (Store.ui.roth); starts from
 *   your 401(k) a year, your top tax rate today and an assumed rate in retirement.
 * - This year's IRA (Engine.iraTracker): what you've put in (yd.iraContributed) against the limit
 *   and the Roth IRA income limits. */
(function () {
    'use strict';
    const { money0, esc } = Fmt;

    // Your 401(k) as a share of pay: the paycheck's 401(k)/403(b)/457(b) deductions, pre-tax and Roth.
    function myDeferral(ctx) {
        const yd = ctx.year, p = ctx.pay, salary = (p.gross && p.gross.baseM * 12) || p.sueldoAnual || 0;
        const ded = Engine.resolveDeductions(Object.assign({}, yd, { country: 'US' })).filter(x => x.t && (x.t.limit === 'deferral' || x.t.limit === '457'));
        const yearly = ded.reduce((a, x) => a + x.annual, 0);
        return { salary, yearly, pct: salary > 0 ? Math.round(yearly / salary * 1000) / 10 : 0 };
    }
    // Your top tax rate today (the federal bracket your taxable income reaches, plus the state's),
    // and a guess for retirement: one federal bracket lower.
    function topRates(ctx) {
        const yd = ctx.year, p = ctx.pay, br = Engine.forStatus((yd.usTax || {}).brackets, Engine.usStatus(yd.filingStatus), 'brackets') || [[0, 0]];
        const i = Math.max(0, br.filter(([from]) => (p.baseImponible || 0) > from).length - 1);
        const st = Number(p.stateRate) || 0, r2 = (x) => Math.round(x * 100) / 100;
        return { now: r2(br[i][1] * 100 + st), later: r2(br[Math.max(0, i - 1)][1] * 100 + st) };
    }

    function render(ctx) {
        const box = document.getElementById('ret-tools');
        if (!box || ctx.year.country !== 'US') return;
        const yd = ctx.year, mine = myDeferral(ctx), ui = Store.ui.roth || (Store.ui.roth = {});
        const num = (key, label, value, attrs, help, action = 'rtools.set') => `<label class="field"><span class="field-label">${label}</span><input type="number" class="input" ${attrs} value="${esc(String(value))}" data-change="${action}" data-key="${key}">${help ? `<span class="help">${help}</span>` : ''}</label>`;
        // 1. The match.
        const tiers = (yd.matchTiers || []).slice(0, 2);
        while (tiers.length < 2) tiers.push({ rate: 0, upTo: 0 });
        const m = Engine.matchOptimizer({ salary: mine.salary, contribPct: mine.pct, tiers });
        const matchMsg = !(m.matchMax > 0) ? '<p class="help">Type your employer\'s match (your benefits guide says it, e.g. "100% of the first 3%").</p>'
            : m.missed > 0.5 ? `<div class="bs-banner warn mt-2"><i class="fa-solid fa-gift"></i> <span>You put in ${mine.pct}% of your pay.</span> <span>Put in ${m.pctForMax}% (${money0(m.extraOwn)} more a year from you) and your employer adds ${money0(m.missed)} more a year: free money.</span></div>`
                : `<p class="text-xs mt-2 text-emerald-700"><i class="fa-solid fa-circle-check"></i> <span>You get the whole match: ${money0(m.matchMax)} a year.</span></p>`;
        const tierRow = (i) => `<div class="grid grid-cols-2 gap-2">${num(`rate${i}`, i ? 'Then matches (%)' : 'Your employer matches (%)', tiers[i].rate, 'min="0" max="200" step="25"', '', 'rtools.tier')}${num(`upTo${i}`, i ? 'of the next (% of pay)' : 'of the first (% of pay)', tiers[i].upTo, 'min="0" max="25" step="0.5"', '', 'rtools.tier')}</div>`;
        // 2. Roth or traditional.
        const r = ctx.retirement, rates = topRates(ctx);
        const pick = (k, d) => (ui[k] === undefined ? d : ui[k]);
        const c = { amount: pick('amount', Math.round(mine.yearly) || 7500), rateNow: pick('rateNow', rates.now), rateLater: pick('rateLater', rates.later), years: pick('years', Math.max(1, r.aniosRestantes || 25)), returnPct: pick('returnPct', Number(ctx.defaultReturn) || 7) };
        const rt = Engine.rothVsTraditional(c);
        const rothMsg = rt.better === 'same' ? '<span>Both end the same: the tax rate is the same now and later.</span>'
            : rt.better === 'roth' ? `<span>Roth leaves ${money0(rt.roth - rt.traditional)} more:</span> <span>your tax rate later is higher than today's.</span>`
            : `<span>Traditional leaves ${money0(rt.traditional - rt.roth)} more:</span> <span>your tax rate later is lower than today's (and it lowers your taxes now by ${money0(rt.taxNow)} a year).</span>`;
        // 3. This year's IRA.
        const age = Number(Store.state.retirement.edadActual) || null;
        const ira = Engine.iraTracker({ contributed: yd.iraContributed, age, magi: (ctx.pay.incomeWages || 0) + ((ctx.pay.earners || []).reduce((a, e) => a + (Number(e.incomeWages) || 0), 0)), status: yd.filingStatus, months: 12 - ctx.today.getMonth(), t: yd.usTax || {} });
        const iraMsg = [ira.room > 0 ? `<span>Room left: ${money0(ira.room)} (${money0(ira.perMonth)} a month through December; for this year you have until April 15).</span>` : '<span>This year\'s IRA is full.</span>',
            ira.rothPhase === 'none' ? '<span class="text-amber-700">At your income a Roth IRA allows nothing this year: a traditional IRA (maybe a "backdoor" Roth) instead.</span>'
                : ira.rothPhase === 'partial' ? `<span class="text-amber-700">At your income a Roth IRA allows up to ${money0(ira.rothLimit)} this year.</span>` : ''].filter(Boolean).join(' ');
        UI.html('ret-tools', `<div class="grid grid-cols-1 lg:grid-cols-3 gap-4">
            <div class="panel tone-slate space-y-2"><div class="section-label"><i class="fa-solid fa-gift text-emerald-600"></i> Your employer's match</div>
                ${tierRow(0)}${tierRow(1)}
                <p class="help">Your 401(k) now: ${mine.pct}% of your pay (${money0(mine.yearly)} a year), from your paycheck's deductions.</p>${matchMsg}</div>
            <div class="panel tone-slate space-y-2"><div class="section-label"><i class="fa-solid fa-scale-balanced text-indigo-600"></i> Roth or traditional?</div>
                <div class="grid grid-cols-2 gap-2">${num('amount', 'A year ($)', c.amount, 'min="0" step="500"')}${num('years', 'Years to retirement', c.years, 'min="1" max="60" step="1"')}
                ${num('rateNow', 'Your tax rate now (%)', c.rateNow, 'min="0" max="60" step="1"', 'Federal + state, your top rate.')}${num('rateLater', 'In retirement (%)', c.rateLater, 'min="0" max="60" step="1"', 'A guess: one federal bracket lower.')}</div>
                <div class="grid grid-cols-2 gap-2 text-center mt-1"><div class="kpi tone-slate"><span class="kpi-label">Traditional</span><span class="kpi-value">${money0(rt.traditional)}</span></div><div class="kpi tone-slate"><span class="kpi-label">Roth</span><span class="kpi-value">${money0(rt.roth)}</span></div></div>
                <p class="text-xs">${rothMsg}</p><p class="help">After taxes, at ${c.returnPct}% a year, the same money out of your paycheck either way.</p></div>
            <div class="panel tone-slate space-y-2"><div class="section-label"><i class="fa-solid fa-piggy-bank text-blue-600"></i> This year's IRA</div>
                ${num('iraContributed', 'Put in so far this year ($)', Number(yd.iraContributed) || 0, 'min="0" step="100"', '', 'rtools.ira')}
                <div class="progress-track"><div class="progress-fill" style="width:${Math.min(100, ira.limit > 0 ? (ira.limit - ira.room) / ira.limit * 100 : 0)}%;background:#3b82f6"></div></div>
                <p class="text-xs"><span>Limit ${money0(ira.limit)}${age >= 50 ? ' (with the catch-up from 50)' : ''}.</span> ${iraMsg}</p></div>
        </div>`);
    }

    UI.register({
        'rtools.set': (el) => { (Store.ui.roth || (Store.ui.roth = {}))[el.dataset.key] = Math.max(0, Fmt.parseNum(el.value, 0)); App.changed(); },
        'rtools.tier': (el) => {
            const yd = Store.active(), [, f, i] = el.dataset.key.match(/^(rate|upTo)(\d)$/);
            const tiers = (yd.matchTiers || []).slice(0, 2);
            while (tiers.length < 2) tiers.push({ rate: 0, upTo: 0 });
            tiers[Number(i)] = Object.assign({}, tiers[Number(i)], { [f]: Math.min(f === 'rate' ? 200 : 25, Math.max(0, Fmt.parseNum(el.value, 0))) });
            yd.matchTiers = tiers;
            App.changed({ step: true });
        },
        'rtools.ira': (el) => { Store.active().iraContributed = Math.min(1e6, Math.max(0, Fmt.parseNum(el.value, 0))); App.changed({ step: true }); }
    });

    window.RetireTools = { render };
})();
