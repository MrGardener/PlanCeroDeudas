// US edition (ZeroDebtPlan) end-to-end checks.
const { openApp, ROOT } = require('./harness');
const path = require('path');
let pass = 0, fail = 0;
const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
const text = (page, id) => page.evaluate(id => (document.getElementById(id) || {}).textContent || '', id);
const go = (page, k) => page.evaluate(k => { App.go(k); if (k === 'config') document.querySelectorAll('[data-tab=config] details').forEach(d => { d.open = true; }); }, k);
// Locking again saves the plan and reloads the page (nothing of it stays in memory): run `fn` in the
// page and wait for the lock screen of the new page.
const lockAndWait = async (page, fn) => { await Promise.all([page.waitForEvent('load', { timeout: 10000 }), page.evaluate(fn)]); await page.waitForSelector('#lock-screen'); await page.waitForTimeout(150); };
(async () => {
  const { browser, page, errors } = await openApp({ file: 'index.html?edition=us', viewport: { width: 1366, height: 900 } });
  await page.evaluate(() => { Store.reset('starter'); App.commitHistory(); App.go('resumen'); });
  ok(await page.evaluate(() => [Store.KEY, Store.COUNTRY, document.title, I18n.lang].join()) === 'zerodebtplan_us_store,US,ZeroDebtPlan,en', 'US edition: own storage, country, title, English');
  ok((await text(page, 'brand-title')) === 'ZeroDebtPlan', 'brand name');
  const nav = await page.$$eval('#main-nav .nav-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(nav.length === 5 && nav.some(n => n.includes('Future')) && nav.some(n => n.includes('Transactions')) && nav.some(n => n.includes('Net Worth')), 'US navigation', nav);
  const futureTabs = await page.$$eval('[data-tab="futuro"] .tab-segmented button', els => els.map(e => e.textContent.trim()));
  ok(futureTabs.some(n => n.includes('Savings & CDs')) && futureTabs.some(n => n.includes('Mortgage')), 'Future holds savings, mortgage…', futureTabs);
  // Payroll
  await go(page, 'presupuesto/ingresos');
  const pay = await page.evaluate(() => App.buildContext().pay);
  ok(Math.abs(pay.netoM - 4007.56) < 0.01 && pay.country === 'US', 'Michigan single $5,000/mo → $4,007.56 net (2026 $5,900 exemption)', pay.netoM);
  ok((await text(page, 'inc-payroll')).includes('Federal income tax') && (await text(page, 'inc-payroll')).includes('Medicare') && (await text(page, 'inc-payroll')).includes('Michigan 4.25%'), 'payroll breakdown shows US taxes');
  ok(await page.isHidden('[data-bind="year.d3"]') && await page.isHidden('#inc-ded-status'), 'Ecuador-only fields are hidden');
  await page.selectOption('[data-bind="year.filingStatus"]', 'mfj');
  await page.fill('[data-bind="year.dependents"]', '2'); await page.dispatchEvent('[data-bind="year.dependents"]', 'input');
  ok(await page.evaluate(() => App.buildContext().pay.fedM) < pay.fedM && (await text(page, 'inc-us-ded-kpis')).includes('$4,400.00'), 'married + 2 kids: lower federal tax, $4,400 in credits');
  await page.selectOption('#inc-city', 'Detroit');
  ok(Math.abs(await page.evaluate(() => App.buildContext().pay.localM) - (5000 * 12 - 4 * 600) * 0.024 / 12) < 0.01 && (await text(page, 'inc-payroll')).includes('Detroit'), 'Detroit city tax 2.4% after $600 × 4 people');
  await page.selectOption('#inc-state', 'TX');
  ok(await page.evaluate(() => App.buildContext().pay.stateM) === 0 && (await text(page, 'inc-state-note')).includes("doesn't tax wages") && await page.evaluate(() => Store.active().localRate) === 0, 'Texas: no state tax, city reset');
  await page.selectOption('#inc-state', 'CA');
  ok((await text(page, 'inc-state-note')).includes("don't have California"), 'a state without a table asks for the rate');
  await page.fill('#inc-state-rate', '6'); await page.dispatchEvent('#inc-state-rate', 'change');
  ok(Math.abs(await page.evaluate(() => App.buildContext().pay.stateM) - 5000 * 0.06) < 0.01, 'typed state rate is used');
  await page.selectOption('#inc-state', 'MI');
  await page.selectOption('[data-bind="year.filingStatus"]', 'single');
  await page.fill('[data-bind="year.dependents"]', '0'); await page.dispatchEvent('[data-bind="year.dependents"]', 'input');
  await page.selectOption('#inc-city', '');
  // Pay stub: US taxes recognized as computed; 401(k) pre-tax lowers taxes
  await page.evaluate(() => PayScan.fromText(`Pay Period: 09/14/2026 - 09/27/2026  Pay Date: 10/02/2026\nGross Pay  2,307.69\nFederal Income Tax  170.00\nSocial Security  135.00\nMedicare  31.00\nMI State Income Tax  86.00\n401(k) Pre-Tax  138.46\nMedical PPO  69.23\nNet Pay  1,678.00`));
  await page.waitForSelector('#scan-save');
  const inc = await page.$$eval('.scan-inc', els => els.map(e => e.checked));
  ok(inc.filter(Boolean).length === 2 && (await page.textContent('.modal-backdrop:not(.hidden)')).includes('The app already calculates it'), 'stub: taxes are computed by the app; 401(k) and medical are kept', inc);
  ok(await page.inputValue('#scan-ppy') === '26', 'biweekly stub');
  const before = await page.evaluate(() => App.buildContext().pay.fedM);
  await page.click('#scan-save');
  const after = await page.evaluate(() => App.buildContext().pay);
  ok(after.fedM < before && after.pretaxM > 0 && Math.abs(after.otrosDescuentosM - (138.46 + 69.23) * 26 / 12) < 0.02, 'pre-tax deductions lower federal tax and come off net', [before, after.fedM, after.otrosDescuentosM]);
  await page.evaluate(() => { Store.active().payDeductions = []; App.changed({ structural: true }); });
  // Mortgage PITI
  await go(page, 'hipoteca');
  ok((await text(page, 'mort-summary')).includes('Total monthly payment (PITI)') && (await text(page, 'mort-summary')).includes('Principal & interest'), 'mortgage shows PITI');
  const piti = await page.evaluate(() => { const m = Store.state.mortgage; const pi = Engine.frenchPayment(m.amount, m.rate, m.years * 12); return Engine.pitiMonthly(Object.assign({ payment: pi }, m)).total; });
  ok(Math.abs(piti - (1580.17 + 4000 / 12 + 1500 / 12)) < 1, 'PITI = P&I + tax + insurance', piti);
  // Retirement: Social Security
  await go(page, 'jubilacion');
  const ss = await page.evaluate(() => App.buildContext().retirement.pension);
  ok(ss > 1500 && ss < 3000 && (await page.textContent('[data-view="jubilacion"]')).includes('Social Security'), 'retirement uses a Social Security estimate', ss);
  ok(await page.isHidden('[data-bind="retirement.tasaReemplazo"]'), 'IESS replacement rate hidden');
  // Import: OFX
  await go(page, 'presupuesto/importar');
  ok(await page.isHidden('#imp-xml'), 'SRI invoice import hidden');
  const n0 = await page.evaluate(() => Store.state.transactions.length);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/chase.ofx'));
  await page.waitForTimeout(250);
  ok((await page.textContent('#imp-summary')).includes('3 to import'), 'OFX rows read', await page.textContent('#imp-summary'));
  await page.selectOption('#imp-ofx-account select', 'new:ahorros');
  await page.click('#imp-commit');
  const acct = await page.evaluate(() => Store.state.accounts[Store.state.accounts.length - 1]);
  ok(await page.evaluate(() => Store.state.transactions.length) === n0 + 3 && acct && acct.balance === 2340.55, 'OFX imported and the account balance updated', acct);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/chase.ofx'));
  await page.waitForTimeout(250);
  ok((await page.textContent('#imp-summary')).includes('0 to import'), 'the same OFX again: all already imported (FITID)', await page.textContent('#imp-summary'));
  await page.click('[data-action="imp.cancel"]');
  // Settings: US tax table, FDIC
  await go(page, 'config');
  ok(await page.$$eval('#cfg-us-brackets tr', r => r.length) === 7 && await page.isHidden('[data-bind="year.iessRate"]'), 'federal table editable; IESS parameters hidden');
  await page.fill('[data-bind="year.usTax.stdDeduction.single"]', '20000'); await page.dispatchEvent('[data-bind="year.usTax.stdDeduction.single"]', 'input');
  ok(await page.evaluate(() => App.buildContext().pay.stdDeduction) === 20000, 'nested tax parameters are editable');
  // Spanish in the US edition: US wording
  await page.selectOption('#cfg-lang', 'es');
  await page.waitForTimeout(150);
  const navEs = await page.$$eval('#main-nav .nav-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  const futEs = await page.$$eval('[data-tab="futuro"] .tab-segmented button', els => els.map(e => e.textContent.trim()));
  ok(futEs.some(n => n.includes('Ahorro y CDs')) && navEs.some(n => n.includes('Resumen')), 'Spanish in the US edition uses US wording', navEs.concat(futEs));
  await go(page, 'jubilacion');
  ok((await page.textContent('[data-view="jubilacion"]')).includes('Seguro Social') && !(await page.textContent('[data-view="jubilacion"]')).includes('Pensión IESS'), 'Spanish: Seguro Social, not IESS');
  await page.selectOption('#cfg-lang', 'en').catch(async () => { await go(page, 'config'); await page.selectOption('#cfg-lang', 'en'); });
  // Mobile
  await page.setViewportSize({ width: 390, height: 844 });
  for (const k of ['resumen', 'presupuesto/ingresos', 'hipoteca', 'config']) {
    await go(page, k); await page.waitForTimeout(200);
    ok(await page.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 0, `US: no horizontal scroll on mobile (${k})`);
  }
  // Next moves on the Overview (example family): three, snoozing one brings the next.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('resumen'); });
  await page.waitForTimeout(200);
  const mv0 = await page.$$eval('#dash-moves .move-title', a => a.map(e => e.textContent.trim()));
  ok(mv0.length === 3 && await page.isVisible('#dash-moves-card'), 'Overview shows the next 3 moves', mv0);
  const health = await page.evaluate(() => ({ n: Number(document.querySelector('#dash-health .health-num').textContent), pillars: document.querySelectorAll('#dash-health .health-pillar').length, txt: document.getElementById('dash-health').textContent }));
  ok(health.n >= 0 && health.n <= 100 && health.pillars === 4 && /Spend/.test(health.txt) && /Borrow/.test(health.txt), 'Overview shows the financial health score with 4 pillars', health.n);
  const firstKey = await page.$eval('#dash-moves [data-action="moves.snooze"]', b => b.dataset.key);
  await page.click('#dash-moves [data-action="moves.snooze"]');
  const mv1 = await page.$$eval('#dash-moves [data-action="moves.snooze"]', a => a.map(e => e.dataset.key));
  ok(!mv1.includes(firstKey) && await page.evaluate(k => !!Store.state.settings.movesSnoozed[k], firstKey), 'Not now hides a move for two weeks', [firstKey, mv1]);
  // Retirement: need vs. have, and the monthly fix goes into the simulator.
  await go(page, 'futuro/jubilacion');
  await page.waitForTimeout(200);
  ok(/You'd need/.test(await page.textContent('#ret-gap')) && /%/.test(await page.textContent('#ret-gap')), 'retirement shows need vs have', (await page.textContent('#ret-gap')).slice(0, 120));
  await page.fill('#ret-desired', '20000');
  await page.dispatchEvent('#ret-desired', 'input');
  await page.waitForTimeout(150);
  ok(/more a month/.test(await page.textContent('#ret-gap')), 'a bigger lifestyle shows the extra monthly saving');
  await page.click('#ret-gap [data-action="ret.tryGap"]');
  ok(await page.evaluate(() => Store.state.retirement.whatIfExtra > 0), 'the fix goes into the what-if simulator');
  // Budget coaching (example family).
  await page.evaluate(() => { App.go('presupuesto/plan'); document.getElementById('bud-coach-card').open = true; });
  await page.waitForTimeout(200);
  const coachTxt = await page.textContent('#bud-coach');
  ok(/Housing/.test(coachTxt) && /guideline|Guideline/.test(coachTxt) && await page.$$eval('#bud-coach tbody tr', r => r.length) >= 5, 'budget coaching compares the plan with guidelines', coachTxt.slice(0, 120));
  // Insurance check (example family): guessed from the budget, answers override.
  await page.evaluate(() => { App.go('futuro/metas'); document.getElementById('metas-insurance').open = true; });
  await page.waitForTimeout(200);
  const ins = await page.$$eval('#ins-list .ins-row', r => r.map(e => e.className.split(' ').pop()));
  ok(ins.length === 7 && ins.includes('ok'), 'insurance check lists 7 coverages with what you have', ins);
  const missingBefore = await page.evaluate(() => document.querySelectorAll('#ins-list .ins-row.falta').length);
  if (missingBefore) {
    const key = await page.$eval('#ins-list .ins-row.falta select', s => s.dataset.key);
    await page.selectOption(`#ins-list select[data-key="${key}"]`, 'si');
    ok(await page.evaluate(() => document.querySelectorAll('#ins-list .ins-row.falta').length) === missingBefore - 1, 'saying you have it marks it covered');
  }
  // College estimator (example family): Emma linked to her 529 goal, a goal created for Leo.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/metas'); document.getElementById('metas-college').open = true; });
  await page.waitForTimeout(200);
  ok(await page.$$eval('#college-results .college-card', c => c.length) === 2 && /Total cost/.test(await page.textContent('#college-results')), 'college estimator shows each child');
  const nGoals = await page.evaluate(() => Store.state.goals.length);
  await page.click('#college-results [data-action="college.goal"]');
  const leo = await page.evaluate(() => { const k = Store.state.college.kids.find(x => x.name === 'Leo'); const g = Store.state.goals.find(x => x.id === k.goalId); return g && { name: g.name, monthly: g.monthly, target: g.target, n: Store.state.goals.length }; });
  ok(leo && leo.n === nGoals + 1 && /Leo/.test(leo.name) && leo.monthly > 0 && leo.target > 100000, 'a savings goal is created and linked for the child', leo);
  // Estate + yearly review checklists keep the date of each step.
  await go(page, 'patrimonio');
  await page.waitForTimeout(150);
  ok(await page.$$eval('#check-estate .check-item', a => a.length) === 6 && await page.$$eval('#check-review .check-item', a => a.length) === 9, 'estate and yearly review checklists');
  await page.click('#check-estate input[data-key="will"]');
  await page.click('#check-review input[data-key="credit"]');
  const ck = await page.evaluate(() => ({ will: Store.state.checklists.estate.will, credit: (Store.state.checklists.review[String(new Date().getFullYear())] || {}).credit, pct: document.getElementById('check-estate-pct').textContent, today: Engine.isoDate(new Date()) }));
  ok(ck.will === ck.today && ck.credit === ck.today && ck.pct === '17%', 'checking a step saves its date (the yearly one under this year)', ck);
  // Chart values show under the chart, not in a box over it (plan phone-and-corebank, step 2).
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('resumen'); });
  await page.waitForTimeout(400);
  const cv = await page.$('#dash-curve-chart');
  await cv.scrollIntoViewIfNeeded();
  const bb = await cv.boundingBox();
  await page.mouse.move(bb.x + bb.width * 0.6, bb.y + bb.height * 0.5);
  await page.waitForTimeout(300);
  const ro = await page.evaluate(() => { const c = UI.chartInstance('dash-curve-chart'), r = c.canvas.parentNode.nextElementSibling; return { cls: r && r.className, txt: r && r.textContent, box: c.options.plugins.tooltip.enabled }; });
  ok(ro.cls === 'chart-readout' && /\$/.test(ro.txt || '') && ro.box === false, 'tapping a chart shows its values under the chart (no box over it)', ro);
  // Edit an automatic rule (step 3).
  await page.evaluate(() => { Store.state.rules = [{ id: 7, contains: 'STARBUKS', category: 'Alimentación', sub: 'Mercado/Supermercado' }]; App.changed({ structural: true }); App.go('transacciones/importar'); });
  await page.waitForTimeout(250);
  await page.click('[data-action="rule.edit"][data-id="7"]');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  const preset = await page.evaluate(() => document.querySelector('.modal select[name="cat"]').value);
  await page.fill('.modal input[name="contains"]', 'STARBUCKS');
  await page.fill('.modal input[name="rename"]', 'Starbucks');
  await page.selectOption('.modal select[name="cat"]', 'G|Alimentación|Restaurantes');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(250);
  const ru = await page.evaluate(() => ({ r: Store.state.rules[0], row: document.getElementById('rule-body').textContent }));
  ok(preset === 'G|Alimentación|Mercado/Supermercado' && ru.r.contains === 'STARBUCKS' && ru.r.rename === 'Starbucks' && ru.r.sub === 'Restaurantes' && ru.r.type === 'Gasto' && /STARBUCKS/.test(ru.row), 'a rule can be edited: text, name, category and subcategory', ru);
  // Rules pick from the same list as Settings → Categories, in English, with the budget line folded away.
  await page.click('#imp-rules-card [data-action="rule.add"]');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  const rd = await page.evaluate(() => {
    const sel = document.querySelector('.modal select[name="cat"]');
    const groups = [...sel.querySelectorAll('optgroup')].map(g => ({ label: g.label, subs: [...g.querySelectorAll('option')].map(o => o.textContent) }));
    const more = document.querySelector('.modal details.modal-more');
    return { groups, cats: Object.keys(Store.state.taxonomy.expense).map(c => I18n.t(c)), more: !!more && !more.open && !!more.querySelector('select[name="line"]'), lineGroups: [...document.querySelectorAll('.modal select[name="line"] optgroup')].map(g => g.label) };
  });
  const grp = (l) => (rd.groups.find(g => g.label === l) || { subs: [] }).subs;
  const spanishLeft = rd.groups.some(g => /Vivienda|Alimentación|Servicios Básicos|›/.test(g.label + g.subs.join('|')));
  ok(JSON.stringify(rd.groups.slice(0, rd.cats.length).map(g => g.label)) === JSON.stringify(rd.cats) && !spanishLeft, 'the rule dialog lists the categories in the same order as Settings → Categories, in English', rd.groups.map(g => g.label));
  ok(grp('Utilities & Communication').includes('Trash & Recycling') && grp('Shopping').includes('Online Shopping') && grp('Taxes').includes('Federal Income Tax (IRS)') && grp('Hobbies').includes('Arts & Crafts') && grp('Financial & Legal').includes('Foreign Transaction Fees') && grp('Financial & Legal').includes('Credit Card Fees (annual, late)'), 'new categories: trash, shopping, taxes, hobbies, card and foreign transaction fees', rd.groups.filter(g => /Utilities|Shopping|Taxes|Hobbies|Financial/.test(g.label)));
  ok(rd.more && rd.lineGroups.includes('Food'), 'the budget line is optional, folded under More options and grouped by category', rd.lineGroups);
  await page.fill('.modal input[name="contains"]', 'AMZN MKTP');
  await page.selectOption('.modal select[name="cat"]', 'G|Compras|Compras en Línea');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  if (await page.isVisible('.modal-backdrop:not(.hidden) [data-dialog-cancel]')) await page.click('.modal-backdrop:not(.hidden) [data-dialog-cancel]');
  const amz = await page.evaluate(() => { const r = Store.state.rules.find(x => x.contains === 'AMZN MKTP'); return { r, row: [...document.querySelectorAll('#rule-body tr')].map(tr => tr.textContent).find(t => /AMZN MKTP/.test(t)) }; });
  ok(amz.r && amz.r.category === 'Compras' && amz.r.sub === 'Compras en Línea' && amz.r.type === 'Gasto' && /Shopping/.test(amz.row) && /Online Shopping/.test(amz.row) && !/Compras/.test(amz.row), 'a new rule keeps its subcategory and the rules list shows it in English', amz);
  await page.click(`[data-action="rule.edit"][data-id="${amz.r.id}"]`);
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  const ed = await page.evaluate(() => { const sel = document.querySelector('.modal select[name="cat"]'); return { v: sel.value, shown: sel.selectedOptions[0].textContent, group: sel.selectedOptions[0].parentElement.label }; });
  await page.click('.modal-backdrop:not(.hidden) [data-dialog-cancel]');
  ok(ed.v === 'G|Compras|Compras en Línea' && ed.shown === 'Online Shopping' && ed.group === 'Shopping', 'editing a rule shows its category in English', ed);
  await page.evaluate(() => { Store.state.rules = []; App.changed({ structural: true }); });
  // Household paychecks: another member's pay before taxes, taxed with the main paycheck.
  await page.evaluate(() => { Store.reset('empty'); const s = Store.state, y = Store.active(); s.members = [{ id: 1, name: 'Mike', color: '#2a78d6' }, { id: 2, name: 'Sarah', color: '#eb6834' }]; Object.assign(y, { sueldo: 6000, payType: 'salary', filingStatus: 'mfj', dependents: 1, state: 'MI', localName: 'Grand Rapids', payDeductions: [], otherIncomes: [] }); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(250);
  const mainAlone = await page.evaluate(() => App.buildContext().pay.netoM);
  ok(/Other paychecks in the household/.test(await text(page, 'inc-earners-card')) && !!(await page.$('[data-action="earner.add"][data-member="2"]')), 'Income & Taxes: other paychecks card offers Sarah\'s paycheck');
  await page.click('[data-action="earner.add"][data-member="2"]');
  await page.waitForTimeout(250);
  await page.fill('#inc-earners [data-f="gross"]', '4000');
  await page.dispatchEvent('#inc-earners [data-f="gross"]', 'change');
  await page.waitForTimeout(250);
  await page.fill('#inc-earners [data-f="retirement"]', '200');
  await page.dispatchEvent('#inc-earners [data-f="retirement"]', 'change');
  await page.waitForTimeout(250);
  const hhPay = await page.evaluate(() => { const c = App.buildContext(), y = Store.active(), l = y.otherIncomes[0], e = c.pay.earners[0]; return { pay: l.pay.sueldo, k401: l.pay.payDeductions.map(d => d.kind + ':' + d.monthly).join(), amount: l.amount, net: e && e.netoM, fed: e && e.fedM, main: c.pay.netoM, joint: c.pay.household.joint, budgetIncome: c.monthBudget.income, card: document.getElementById('inc-earners').innerText }; });
  ok(hhPay.pay === 4000 && hhPay.k401 === 'retirement:200' && Math.abs(hhPay.amount - hhPay.net) < 0.01 && hhPay.net > 2000 && hhPay.net < 3800 && hhPay.fed > 0 && hhPay.joint && /Married filing jointly/.test(hhPay.card) && /Take-home a month/.test(hhPay.card), 'Sarah\'s pay before taxes: federal, FICA, state and city taken; her take-home is the budget line', hhPay);
  ok(hhPay.main < mainAlone && Math.abs(hhPay.budgetIncome - (hhPay.main + hhPay.net)) < 0.02, 'filing jointly, the main paycheck pays its share of the higher bracket; the budget counts both take-homes', { mainAlone, main: hhPay.main, net: hhPay.net, income: hhPay.budgetIncome });
  await page.evaluate(() => App.go('presupuesto/plan'));
  await page.waitForTimeout(250);
  const row = await page.evaluate(() => { const r = document.querySelector('#bud-simple [data-income] a[data-goto="presupuesto/ingresos"].bs-input, #bud-body tr[data-income] a[data-goto="presupuesto/ingresos"]'); return r ? r.textContent : null; });
  ok(row && /\$2,|\$3,/.test(row), 'the budget shows her paycheck after taxes (not typed), linked to Income & Taxes', row);
  // Single: each on their own.
  await page.evaluate(() => { Store.active().filingStatus = 'single'; App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  ok(/taxed on its own/.test(await text(page, 'inc-earners')), 'filing single: each paycheck is taxed on its own');
  // A take-home typed earlier can be entered before taxes instead; "Another person's paycheck" adds someone.
  await page.evaluate(() => { const y = Store.active(); y.otherIncomes = [{ id: 5, name: 'Sarah (paycheck)', amount: 2500, category: 'Ingresos Laborales', memberId: 2 }]; App.changed({ structural: true }); });
  await page.waitForTimeout(150);
  await page.click('[data-action="earner.convert"][data-id="5"]');
  await page.waitForTimeout(250);
  const conv = await page.evaluate(() => { const l = Store.active().otherIncomes[0]; return { gross: l.pay && l.pay.sueldo, amount: l.amount }; });
  ok(conv.gross > 2500 && conv.gross % 50 === 0 && Math.abs(conv.amount - 2500) < 600, 'a typed take-home becomes a paycheck before taxes (an estimate to correct)', conv);
  await page.click('#inc-earners [data-action="earner.add"]:not([data-member])');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  await page.fill('.modal input[name="name"]', 'Emma');
  await page.fill('.modal input[name="gross"]', '900');
  await page.click('.modal [data-dialog-ok]');
  await page.waitForTimeout(250);
  const emma = await page.evaluate(() => { const s = Store.state, m = s.members.find(x => x.name === 'Emma'), l = Store.active().otherIncomes.find(x => m && x.memberId === m.id); return { m: !!m, gross: l && l.pay.sueldo, amount: l && l.amount }; });
  ok(emma.m && emma.gross === 900 && emma.amount > 600 && emma.amount < 900, '"Another person\'s paycheck" adds the person and their paycheck', emma);
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); });
  // Household step 2: whose accounts; the other paychecks' 401(k) and Social Security in retirement.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(250);
  const whose = await page.evaluate(() => { const sel = document.querySelector('#acct-body select[data-field="memberId"]'); return { n: document.querySelectorAll('#acct-body select[data-field="memberId"]').length, opts: sel && [...sel.options].map(o => o.textContent) }; });
  ok(whose.n > 0 && whose.opts.includes('Mike') && whose.opts.includes('Sarah') && whose.opts.some(o => /Household/.test(o)), 'accounts say whose they are', whose);
  await page.evaluate(() => { const y = Store.active(); y.otherIncomes = [{ id: 1, name: 'Sarah (paycheck)', amount: 0, category: 'Ingresos Laborales', memberId: 2, pay: { payType: 'salary', sueldo: 3200, payDeductions: [{ id: 1, name: '401(k)', group: 'retirement', kind: 'retirement', pretax: true, monthly: 300 }, { id: 2, name: 'Match', group: 'employer', kind: 'retirement', monthly: 100 }] } }]; Earners.syncAmounts(); App.changed({ structural: true }); App.go('futuro/jubilacion'); });
  await page.waitForTimeout(300);
  const ret2 = await page.evaluate(() => { const c = App.buildContext(); return { pensions: c.retirement.pensions.map(p => p.name), sarah: (c.earnersRetirement[0] || {}).own, match: (c.earnersRetirement[0] || {}).match, ahorro: document.getElementById('ret-ahorro-who').textContent, aporte: document.getElementById('ret-aporte-who').textContent, note: document.getElementById('ret-pension-note').textContent, gross: c.householdGross, main: c.pay.sueldoAnual }; });
  ok(ret2.pensions.join() === 'Mike,Sarah' && /Mike/.test(ret2.note) && /Sarah/.test(ret2.note), 'retirement: Social Security for each earner', ret2);
  ok(ret2.sarah === 300 && ret2.match === 100 && /Sarah/.test(ret2.aporte) && /401\(k\)/.test(ret2.aporte) && /match/.test(ret2.aporte), 'retirement: the other paycheck\'s 401(k) and its match count in the monthly contribution', ret2);
  ok(/Retirement accounts:/.test(ret2.ahorro) && /Mike/.test(ret2.ahorro) && /Sarah/.test(ret2.ahorro) && Math.abs(ret2.gross - (ret2.main + 3200 * 12)) < 1, 'retirement accounts by person; Baby Step 4 counts the household\'s pay', ret2);
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); });
  // Investment prices: Alpha Vantage's one-a-second limit is waited out, its daily limit keeps the last
  // price (and says so), Google Sheets needs no key (one request), and the daily update runs once.
  await page.evaluate(() => { const s = Store.state; s.holdings = [{ id: 1, ticker: 'AAA', name: '', kind: 'ETF', shares: 2, price: 10, priceAt: '2026-01-01T00:00:00Z', priceSource: 'alphavantage' }, { id: 2, ticker: 'BBB', name: '', kind: 'ETF', shares: 1, price: 0, priceAt: null, priceSource: 'manual' }]; s.settings.priceProvider = 'alphavantage'; s.settings.priceKey = 'TESTKEY'; App.changed({ structural: true }); App.go('patrimonio'); });
  const avCalls = [];
  let avMode = 'burst';
  await page.route(/alphavantage\.co\/query/, r => {
    const sym = new URL(r.request().url()).searchParams.get('symbol');
    avCalls.push([sym, Date.now()]);
    const body = avMode === 'daily' ? { Information: 'We have detected your API key and our standard API rate limit is 25 requests per day.' }
      : sym === 'BBB' && avCalls.filter(c => c[0] === 'BBB').length === 1 ? { Information: 'Please consider spreading out your free API requests more sparingly (1 request per second).' }
      : { 'Global Quote': { '05. price': sym === 'AAA' ? '101.50' : '55.25' } };
    r.fulfill({ contentType: 'application/json', body: JSON.stringify(body) });
  });
  await page.click('[data-action="hold.refresh"]');
  await page.waitForFunction(() => Store.state.holdings[1].price > 0, null, { timeout: 15000 });
  const av = await page.evaluate(() => Store.state.holdings.map(h => [h.price, h.priceSource, !!h.priceFail]));
  const gap = avCalls[1][1] - avCalls[0][1];
  ok(JSON.stringify(av) === JSON.stringify([[101.5, 'alphavantage', false], [55.25, 'alphavantage', false]]) && gap >= 1200 && avCalls.length === 3, 'Alpha Vantage: a second apart; the one-a-second limit is waited out and retried, so both prices update', { av, gap, calls: avCalls.map(c => c[0]) });
  avMode = 'daily'; avCalls.length = 0;
  await page.click('[data-action="hold.refresh"]');
  await page.waitForFunction(() => Store.state.holdings.every(h => h.priceFail), null, { timeout: 10000 });
  const avd = await page.evaluate(() => ({ prices: Store.state.holdings.map(h => h.price), fail: Store.state.holdings[0].priceFail, row: document.querySelector('#hold-body tr[data-row="2"] [data-cell="when"]').textContent }));
  ok(avd.prices.join() === '101.5,55.25' && /daily limit/.test(avd.fail) && /Last update failed/.test(avd.row) && avCalls.length === 1, 'Alpha Vantage daily limit: stops asking, keeps the last prices and says why on the row', { avd, calls: avCalls.length });
  await page.unroute(/alphavantage\.co\/query/);
  // Google Sheets: the settings show a link field instead of the key.
  await page.evaluate(() => { App.go('config'); document.getElementById('cfg-prices').scrollIntoView(); });
  await page.selectOption('#cfg-prices select[data-bind="settings.priceProvider"]', 'gsheet');
  await page.waitForTimeout(150);
  const gsUI = await page.evaluate(() => ({ key: document.getElementById('cfg-price-key').classList.contains('hidden'), sheet: !document.getElementById('cfg-price-sheet').classList.contains('hidden'), help: /GOOGLEFINANCE/.test(document.getElementById('cfg-price-sheet-help').textContent) }));
  ok(gsUI.key && gsUI.sheet && gsUI.help, 'Settings → Prices: Google Sheets asks for the published link (with steps), not a key', gsUI);
  await page.fill('#cfg-price-sheet input', 'https://docs.google.com/spreadsheets/d/e/2PACX-test/pub?gid=0&single=true&output=csv');
  await page.dispatchEvent('#cfg-price-sheet input', 'change');
  let gsCalls = 0;
  await page.route(/docs\.google\.com\/spreadsheets/, r => { gsCalls++; r.fulfill({ contentType: 'text/csv', body: 'Symbol,Price\nAAA,"1,234.50"\nNYSEARCA:BBB,60.10\nCCC,#N/A\n' }); });
  await page.evaluate(() => App.go('patrimonio'));
  await page.click('[data-action="hold.refresh"]');
  await page.waitForFunction(() => Store.state.holdings[0].price === 1234.5, null, { timeout: 8000 });
  const gs = await page.evaluate(() => ({ h: Store.state.holdings.map(h => [h.price, h.priceSource, h.priceFail || '']), note: document.getElementById('hold-key-note').textContent }));
  ok(JSON.stringify(gs.h) === JSON.stringify([[1234.5, 'gsheet', ''], [60.1, 'gsheet', '']]) && gsCalls === 1 && /Google Sheets/.test(gs.note) && /once a day/.test(gs.note), 'Google Sheets: every price in one request, no key; the note says they update once a day', { gs, gsCalls });
  const daily = await page.evaluate(async () => { Store.state.settings.pricesCheckedAt = new Date(Date.now() - 2 * 86400000).toISOString(); Store.state.holdings[0].price = 1; const first = Prices.daily(); await first; const again = Prices.daily(); return { ran: !!first, again: again === null, price: Store.state.holdings[0].price, toasts: document.querySelectorAll('.toast-error').length }; });
  ok(daily.ran && daily.again && daily.price === 1234.5 && gsCalls === 2, 'prices update by themselves once a day (not again the same day)', daily);
  await page.evaluate(() => { Store.state.settings.priceAuto = false; Store.state.settings.pricesCheckedAt = null; });
  ok(await page.evaluate(() => Prices.daily() === null), 'the daily update can be turned off');
  await page.unroute(/docs\.google\.com\/spreadsheets/);
  await page.evaluate(() => { const s = Store.state; s.holdings = []; Object.assign(s.settings, { priceProvider: 'finnhub', priceKey: '', priceSheet: '', priceAuto: true, pricesCheckedAt: null }); App.changed({ structural: true }); });
  // Categories live in Settings: rename (carried to transactions) and add a subcategory (step 4).
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('config'); document.getElementById('cfg-categories').open = true; });
  await page.waitForTimeout(250);
  const catBefore = await page.evaluate(() => Store.state.transactions.filter(t => t.parentCategory === 'Alimentación').length);
  await page.click('[data-action="cat.rename"][data-parent="Alimentación"]');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  const shown = await page.inputValue('.modal input[name="name"]');
  await page.fill('.modal input[name="name"]', 'Groceries & Dining');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(250);
  await page.click('[data-action="cat.addSub"][data-parent="Groceries & Dining"]');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  await page.fill('.modal input[name="name"]', 'Coffee');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(250);
  const cr = await page.evaluate(() => ({ n: Store.state.transactions.filter(t => t.parentCategory === 'Groceries & Dining').length, old: Store.state.transactions.filter(t => t.parentCategory === 'Alimentación').length, subs: Store.state.taxonomy.expense['Groceries & Dining'], list: document.getElementById('cat-list').textContent }));
  ok(shown === 'Food' && catBefore > 0 && cr.n === catBefore && cr.old === 0 && cr.subs.includes('Coffee') && /Groceries & Dining/.test(cr.list), 'Settings → Categories: rename carries to transactions; add a subcategory', [shown, catBefore, cr.n, cr.old]);
  // Household (shared) next to each person (step 5).
  await page.evaluate(() => { Store.reset('example'); if (!(Store.state.members || []).length) Store.state.members = [{ id: 1, name: 'Ana', color: '#2a78d6' }]; App.changed({ structural: true }); App.go('transacciones/lista'); });
  await page.waitForTimeout(250);
  const hh = await page.evaluate(() => {
    const opts = [...document.querySelectorAll('#txn-member option')].map(o => [o.value, o.textContent]);
    const ym = Engine.isoDate(new Date()).slice(0, 7), t = Store.state.transactions.find(x => (x.type || 'Gasto') === 'Gasto' && x.date.startsWith(ym)) || Store.state.transactions.find(x => (x.type || 'Gasto') === 'Gasto');
    t.memberId = Engine.HOUSEHOLD;
    App.changed({ structural: true });
    return { opts, badge: !!document.querySelector('.member-dot[title="Household (shared)"]') };
  });
  ok(hh.opts.some(([v, l]) => v === '-1' && /Household \(shared\)/.test(l)) && hh.opts[0][0] === '', 'Whose? offers "Household (shared)" next to each person', hh.opts);
  await page.evaluate(() => { App.go('transacciones/reportes'); });
  await page.waitForTimeout(200);
  await page.selectOption('#rep-by', 'member');
  await page.waitForTimeout(200);
  ok(/Household/.test(await page.textContent('#rep-body')), 'reports by person show the household as its own row');
  // Typed vs. imported; typed ones not on a statement yet (step 8).
  await page.evaluate(() => { const d = Engine.isoDate(new Date()); Store.reset('empty'); Store.state.transactions = [
    { id: 1, type: 'Gasto', description: 'Typed coffee', parentCategory: 'Alimentación', category: 'Restaurantes', amount: 4, date: d, createdAt: d },
    { id: 2, type: 'Gasto', description: 'Typed and matched', parentCategory: 'Alimentación', category: 'Restaurantes', amount: 9, date: d, importRef: 'r1' },
    { id: 3, type: 'Gasto', description: 'From the bank', parentCategory: 'Alimentación', category: 'Restaurantes', amount: 12, date: d, source: 'csv', importRef: 'r2' }];
    App.changed({ structural: true }); App.go('transacciones/lista'); });
  await page.waitForTimeout(250);
  await page.selectOption('#txn-f-origin', 'unreconciled');
  await page.waitForTimeout(200);
  const rec = await page.evaluate(() => ({ list: document.getElementById('txn-body').textContent }));
  ok(/Typed coffee/.test(rec.list) && !/Typed and matched/.test(rec.list) && !/From the bank/.test(rec.list) && /Typed/.test(rec.list), 'filter: typed transactions no statement has confirmed yet', rec.list.slice(0, 200));
  await page.selectOption('#txn-f-origin', 'all');
  await page.waitForTimeout(200);
  const all = await page.evaluate(() => document.getElementById('txn-body').textContent);
  ok(/confirmed by a statement/.test(all) && /Imported/.test(all), 'each transaction says where it came from', all.slice(0, 300));
  // Hourly pay, overtime and bonuses (docs/plans/hourly-pay.md, phase 2).
  await page.evaluate(() => { Store.reset('example'); Store.active().sueldo = 5000; Store.active().payDeductions = []; App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  const net0 = await page.evaluate(() => Engine.payroll(Store.effective(Store.state.activeYear)).netoM);
  await page.selectOption('#inc-paytype [data-change="paytype.set"]', 'hourly');
  await page.waitForTimeout(200);
  const hr = await page.evaluate(() => ({ t: Store.active().payType, rate: Store.active().hourly.rate, sueldo: Store.active().sueldo, ro: document.getElementById('inc-sueldo').readOnly, label: document.getElementById('inc-sueldo-label').textContent }));
  ok(hr.t === 'hourly' && Math.abs(hr.rate - 28.85) < 0.01 && Math.abs(hr.sueldo - 5000) < 2 && hr.ro && /base pay/.test(hr.label), 'switching to hourly starts from the salary (same base pay); the monthly field is worked out', hr);
  const setHourly = async (field, v) => { await page.fill(`#inc-paytype input[data-field="${field}"]`, String(v)); await page.dispatchEvent(`#inc-paytype input[data-field="${field}"]`, 'change'); await page.waitForTimeout(150); };
  await setHourly('rate', 25); await setHourly('hours', 40); await setHourly('otHours', 5);
  const h1 = await page.evaluate(() => ({ sueldo: Store.active().sueldo, net: Engine.payroll(Store.effective(Store.state.activeYear)).netoM, txt: document.getElementById('inc-paytype').textContent.replace(/\s+/g, ' '), annual: document.getElementById('inc-annual').textContent }));
  ok(Math.abs(h1.sueldo - 4333.33) < 0.01 && /Base pay: \$4,333\.33 a month/.test(h1.txt) && /Usual overtime: \$812\.50 a month/.test(h1.txt) && /\$61,750\.00/.test(h1.annual), '$25 × 40 h: base $4,333.33; overtime $812.50; the year $61,750', h1);
  await page.check('#inc-paytype input[data-field="otInBudget"]');
  await page.waitForTimeout(150);
  const h2 = await page.evaluate(() => Engine.payroll(Store.effective(Store.state.activeYear)).netoM);
  ok(h2 > h1.net + 500, 'counting overtime raises the budget\'s take-home pay', [h1.net, h2]);
  await page.click('#inc-paytype [data-action="bonus.add"]');
  await page.waitForTimeout(150);
  await page.fill('#inc-paytype input[data-field="amount"]', '3000');
  await page.dispatchEvent('#inc-paytype input[data-field="amount"]', 'change');
  await page.waitForTimeout(150);
  await page.check('#inc-paytype input[data-field="inBudget"]');
  await page.waitForTimeout(150);
  const bn = await page.evaluate(() => { const yd = Store.effective(Store.state.activeYear), p = Engine.payroll(yd); return { b: Store.active().bonuses[0], dec: Engine.monthBudget(yd, '12', p).salary - Engine.monthBudget(yd, '11', p).salary }; });
  ok(bn.b.amount === 3000 && bn.b.month === '12' && bn.b.inBudget && bn.dec > 2000 && bn.dec < 3000, 'a planned $3,000 December bonus adds its take-home to December', bn);
  await page.evaluate(() => { Device.setLang('es'); });
  await page.waitForTimeout(250);
  const esTxt = (await page.textContent('#inc-paytype')).replace(/\s+/g, ' ');
  ok(/Cómo te pagan/.test(esTxt) && /Bonos este año/.test(esTxt) && /Pago por hora/.test(esTxt) && /Diciembre/.test(esTxt), 'the pay block in Spanish', esTxt.slice(0, 160));
  await page.evaluate(() => { Device.setLang('en'); });
  await page.waitForTimeout(150);
  await page.selectOption('#inc-paytype [data-change="paytype.set"]', 'salary');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.active().payType === 'salary' && !document.getElementById('inc-sueldo').readOnly), 'back to salary: the monthly field is typed again');
  ok(net0 > 0, 'baseline take-home', net0);
  // Pay stub with hours, overtime and a bonus (phase 4): back to a salary first, then scan.
  await page.evaluate(() => { const y = Store.active(); y.payType = 'salary'; y.bonuses = []; App.changed({ structural: true }); PayScan.fromText('Pay Period: 09/14/2026 - 09/27/2026  Pay Date: 10/02/2026\nEarnings Rate Hours Current YTD\nRegular 25.0000 80.00 2,000.00 38,000.00\nOvertime 37.5000 6.00 225.00 1,125.00\nBonus 500.00 500.00\nGross Pay 2,725.00\nFederal Income Tax 250.00\nNet Pay 2,100.00'); });
  await page.waitForTimeout(250);
  const sc = (await page.textContent('.sheet-body')).replace(/\s+/g, ' ');
  ok(/Paid by the hour: \$25\.00 an hour, 40 hours a week/.test(sc) && /3 hours a week at 1\.5×/.test(sc) && /Add this \$500\.00 bonus/.test(sc), 'the stub review offers its hourly pay, overtime and bonus', sc.slice(0, 300));
  await page.check('#scan-ot');
  await page.waitForTimeout(150);
  await page.click('#scan-save');
  await page.waitForTimeout(250);
  const st = await page.evaluate(() => { const y = Store.active(); return { t: y.payType, h: y.hourly, sueldo: y.sueldo, b: y.bonuses.map(b => [b.amount, b.month, b.inBudget]) }; });
  ok(st.t === 'hourly' && st.h.rate === 25 && st.h.hours === 40 && st.h.otHours === 3 && st.h.otRate === 1.5 && Math.abs(st.sueldo - 4333.33) < 0.01 && JSON.stringify(st.b) === '[[500,"10",false]]', 'saving the stub sets hourly pay, usual overtime and the paid bonus', st);
  // Extra paychecks (phase 3): every 2 weeks from the year's first Friday.
  await page.evaluate(() => { const y = Store.state.activeYear, d = new Date(y, 0, 1); d.setDate(1 + (5 - d.getDay() + 7) % 7); Store.state.settings.paySchedule = { freq: 'weekly', weekday: 5, interval: 2, anchor: Engine.isoDate(d) }; App.changed({ structural: true }); });
  await page.waitForTimeout(200);
  const xp = await page.evaluate(() => ({ txt: document.getElementById('pay-extra').textContent.replace(/\s+/g, ' '), months: Engine.extraPaycheckMonths(Store.state.settings.paySchedule, Store.state.activeYear).months.map(m => Fmt.MONTH_NAMES[m.month - 1]) }));
  ok(xp.months.length >= 2 && /3rd paycheck in/.test(xp.txt) && xp.months.every(m => xp.txt.includes(m)) && /Budget on 2 paychecks a month/.test(xp.txt), 'every 2 weeks: the months with a 3rd paycheck are named', xp);
  await page.check('#pay-extra input[data-change="pay.onChecks"]');
  await page.waitForTimeout(200);
  const oc = await page.evaluate(() => { const yd = Store.effective(Store.state.activeYear), p = Engine.payroll(yd), m = Engine.extraPaycheckMonths(yd.paySchedule, yd.calYear).months[0].month; return { on: Store.active().budgetOnPaychecks, base: Engine.monthBudget(yd, 'base', p).salary, extra: Engine.monthBudget(yd, String(m), p).salary, each: p.netoM * 12 / 26, toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') }; });
  ok(oc.on && Math.abs(oc.base - oc.each * 2) < 0.01 && Math.abs(oc.extra - oc.each * 3) < 0.01 && /Budgeting on your paychecks/.test(oc.toast), 'budget on 2 paychecks: the plan has 2, the extra month 3', oc);
  // Refund or owe (example family): a refund now; less withholding → owe, with the W-4 fix.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  ok(/Your refund would be/.test(await page.textContent('#inc-refund')), 'the example family gets a refund estimate', (await page.textContent('#inc-refund')).slice(0, 120));
  await page.fill('#inc-refund-in [data-key="perCheck"]', '40');
  await page.dispatchEvent('#inc-refund-in [data-key="perCheck"]', 'input');
  await page.waitForTimeout(150);
  const owe = await page.textContent('#inc-refund');
  ok(/You'd owe/.test(owe) && /more per paycheck/.test(owe) && await page.evaluate(() => document.activeElement && document.activeElement.dataset.key === 'perCheck'), 'less withholding → owe, with extra per paycheck; typing keeps focus', owe.slice(0, 160));
  // Itemize or standard: the example family is better off with the standard deduction; a bigger
  // mortgage interest flips it, and "Use" puts the itemized total in the paycheck math.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  const it0 = (await page.textContent('#inc-itemize')).replace(/\s+/g, ' ');
  ok(/Mortgage interest/.test(it0) && /State, local and property taxes/.test(it0) && /Charitable gifts/.test(it0) && /The standard deduction is better for you/.test(it0) && /\$34,200/.test(it0), 'itemize check: the example family takes the standard deduction (+ $2,000 for gifts)', it0.slice(0, 300));
  await page.fill('#inc-itemize-in [data-key="mortgage"]', '30000');
  await page.dispatchEvent('#inc-itemize-in [data-key="mortgage"]', 'input');
  await page.waitForTimeout(150);
  const it1 = await page.textContent('#inc-itemize');
  ok(/Itemizing is better for you/.test(it1) && await page.evaluate(() => document.activeElement && document.activeElement.dataset.key === 'mortgage'), 'more mortgage interest → itemize, and typing keeps focus', it1.slice(0, 200));
  const fed0 = await page.evaluate(() => App.buildContext().pay.fedM);
  await page.click('#inc-itemize [data-action="itemize.use"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.active().itemized) > 32200 && await page.evaluate(() => App.buildContext().pay.fedM) < fed0 && /Itemized/.test(await page.textContent('#inc-us-ded-kpis')), '"Use" sets the itemized deduction and lowers the federal tax');
  // Investments: cost and gain per holding, the mix against the target, rebalancing, new money.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(200);
  const hold = (await page.textContent('#nw-holdings')).replace(/\s+/g, ' ');
  ok(/\+\$1,522 \(\+24\.9%\)/.test(hold) && /\+\$2,240 \(\+19\.0%\)/.test(hold) && /Manual/.test(hold), 'gain per holding and in total', hold.slice(0, 200));
  ok(/drifted 5\.6 points/.test(hold) && /Buy \$788/.test(hold) && /Sell \$663/.test(hold), 'the example mix has drifted: buy and sell amounts', hold.match(/U\.S\. stocks\$.{0,200}/));
  await page.fill('#mix-new', '1000');
  await page.dispatchEvent('#mix-new', 'input');
  await page.waitForTimeout(100);
  const split = await page.textContent('#mix-split');
  ok(/U\.S\. stocks\s*\$888\s*International stocks\s*\$112/.test(split), 'new money only: where to put the next contribution', split);
  ok(await page.evaluate(() => document.activeElement && document.activeElement.id === 'mix-new'), 'typing the contribution keeps focus');
  await page.click('[data-action="mix.preset"][data-key="calm"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.state.investTarget.bonds === 40 && document.querySelector('#mix-in [data-key="bonds"]').value === '40'), 'a preset sets the target and the inputs show it');
  await page.selectOption('#mix-in select[data-id="3"]', 'cash');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => Store.state.holdings.find(h => h.id === 3).asset === 'cash') && /Cash \/ money market/.test(await page.textContent('#mix-bars')), 'a holding\'s class can be changed');
  const costCell = '#hold-body tr[data-row="1"] [data-field="cost"]';
  await page.fill(costCell, '9000'); await page.dispatchEvent(costCell, 'input');
  await page.waitForTimeout(100);
  ok(/−\$1,358/.test(await page.textContent('#hold-body tr[data-row="1"] [data-cell="gain"]')), 'a higher cost shows a loss');
  // Prepay the mortgage or invest: the example at 10% → investing wins, with the break-even; at 5% → prepay.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/hipoteca'); });
  await page.waitForTimeout(200);
  const pp = (await page.textContent('#mort-prepay')).replace(/\s+/g, ' ');
  ok(/investing would leave \$[\d,]+ more/.test(pp) && /only wins if it earns more than 6\.\d% a year/.test(pp) && /House paid off \d+y/.test(pp) && /From your balance today/.test(pp), 'prepay or invest: investing wins at 10%, with the break-even', pp.slice(0, 300));
  await page.fill('#mort-prepay-in [data-key="returnPct"]', '5');
  await page.dispatchEvent('#mort-prepay-in [data-key="returnPct"]', 'input');
  await page.waitForTimeout(100);
  ok(/Paying down the house leaves \$[\d,]+ more/.test(await page.textContent('#mort-prepay-out')) && await page.evaluate(() => document.activeElement.dataset.key === 'returnPct'), 'at 5% paying the house wins; typing keeps focus');
  // Rate sensitivity: the mortgage at ±1 point, CDs renewing 1 point lower.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/hipoteca'); });
  await page.waitForTimeout(200);
  const rates = (await page.textContent('#mort-rates')).replace(/\s+/g, ' ');
  ok(/1 point lower · 5\.25% \$1,501\.99/.test(rates) && /1 point higher · 7\.25% \$1,855\.52/.test(rates) && /\+\$181\/mo/.test(rates), 'mortgage payment and interest at ±1 point', rates.slice(0, 200));
  await go(page, 'ahorro/polizas');
  await page.waitForTimeout(150);
  ok(/If the rate is 1 point lower when they renew, they'd earn \$[\d,]+: \$[\d,]+ less a year/.test(await page.textContent('#pol-rate-risk')), 'CDs: what a 1-point lower renewal costs a year');
  // Side income: the example's photography income → % to set aside, a tax fund goal.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  const side = await page.textContent('#inc-side');
  const sidePct = Number((side.match(/(\d+)%/) || [])[1]);
  ok(/Side income/.test(side) && sidePct >= 20 && sidePct <= 45 && /quarterly/.test(side), 'side income shows the share to set aside and quarterly payments', side.slice(0, 160));
  await page.click('#inc-side [data-action="side.goal"]');
  ok(await page.evaluate(() => Store.state.goals.some(g => g.taxFund && g.monthly > 0)), 'a tax fund goal can be created');
  // Subscription finder on the example family.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('transacciones/lista'); });
  await page.waitForTimeout(200);
  const foundTxt = await page.textContent('#rec-found');
  ok(/Disney\+/.test(foundTxt) && /iCloud/.test(foundTxt) && /repeating charge/.test(foundTxt), 'the finder lists untracked subscriptions', foundTxt.slice(0, 200));
  const nRec = await page.evaluate(() => Store.state.recurring.length);
  await page.click('#rec-found .found-row:has-text("Disney+") [data-action="subs.track"]');
  const tracked = await page.evaluate(() => { const r = Store.state.recurring.find(x => x.description === 'Disney+'); return r && { r, linked: Store.state.transactions.filter(t => t.recurringId === r.id).length, n: Store.state.recurring.length, next: Engine.nextOccurrence(r, new Date()), today: Engine.isoDate(new Date()) }; });
  ok(tracked && tracked.n === nRec + 1 && tracked.r.frequency === 'monthly' && tracked.linked >= 12 && tracked.next >= tracked.today, 'Schedule turns it into a repeating movement linked to its past charges', tracked && [tracked.n, tracked.linked, tracked.next]);
  ok(!/Disney\+/.test(await page.textContent('#rec-found')), 'a scheduled one leaves the list');
  ok(await page.evaluate(() => Engine.dueOccurrences(Store.state.recurring.find(x => x.description === 'Disney+'), new Date()).length === 0), 'scheduling does not re-post charges already logged');
  await page.click('#rec-found .found-row:has-text("Help for Mom") [data-action="subs.dismiss"]');
  ok(!/Help for Mom/.test(await page.textContent('#rec-found')) && await page.evaluate(() => (Store.state.settings.dismissedRepeats || []).length === 1), 'Not recurring hides it for good');
  // Net worth month by month + milestones (example family).
  await go(page, 'patrimonio');
  await page.waitForTimeout(200);
  const prog = await page.evaluate(() => ({ points: (UI.chartInstance('nw-month-chart') || { data: { datasets: [{ data: [] }] } }).data.datasets[0].data.length, txt: document.getElementById('nw-milestones').textContent, hist: Store.state.netWorthHistory.length }));
  ok(prog.points === Math.min(6, prog.hist) && prog.hist >= 12, 'the example shows net worth month by month (6 months first)', prog.points);
  ok(/Reached \(\d+\)/.test(prog.txt) && /Up next/.test(prog.txt) && /Net worth of \$/.test(prog.txt), 'milestones: reached and up next', prog.txt.slice(0, 160));
  const er = await page.evaluate(() => Store.state.debts.find(d => /ER bill/.test(d.name)));
  await go(page, 'futuro/metas');
  await page.click(`#debt-body tr[data-row="${er.id}"] [data-action="debt.pay"]`);
  await page.fill('.modal input[name="amount"]', String(er.balance));
  await page.fill('.modal input[name="interest"]', '0');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(600);
  const ms = await page.evaluate(id => ({ m: Store.state.milestones['debt-' + id], toasts: [...document.querySelectorAll('.toast')].map(t => t.textContent).join(' | ') }), er.id);
  ok(ms.m === await page.evaluate(() => Engine.isoDate(new Date())) && /Milestone!/.test(ms.toasts), 'paying a debt off is a dated, celebrated milestone', ms);
  // Phones: debts and goals show as one card per row, each field labeled; tables on desktop.
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/metas'); document.getElementById('goal-table').open = true; });
  await page.waitForTimeout(150);
  ok(await page.isVisible('#metas-goals thead') && await page.evaluate(() => getComputedStyle(document.querySelector('#debt-body tr')).display) === 'table-row', 'desktop: debts and goals stay tables', await page.evaluate(() => [getComputedStyle(document.querySelector('#metas-goals thead')).display, getComputedStyle(document.querySelector('#debt-body tr')).display, innerWidth, Store.ui.tab, document.querySelectorAll('#debt-body tr').length]));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(200);
  const card = await page.evaluate(() => ({ head: getComputedStyle(document.querySelector('#metas-goals thead')).display, row: getComputedStyle(document.querySelector('#debt-body tr')).display,
    labels: [...document.querySelectorAll('#goal-body tr:first-child td')].map(td => getComputedStyle(td, '::before').content), over: document.documentElement.scrollWidth - innerWidth }));
  ok(card.head === 'none' && card.row === 'grid' && card.labels.includes('"Budget per month"') && card.labels.includes('"Target"') && card.over <= 0, 'phone: debts and goals as labeled cards, no sideways scroll', card);
  await page.fill('#debt-body tr:first-child [data-field="balance"]', '1234');
  await page.dispatchEvent('#debt-body tr:first-child [data-field="balance"]', 'input');
  ok(await page.evaluate(() => Store.state.debts[0].balance === 1234 && document.activeElement.dataset.field === 'balance'), 'phone: editing in a card works and keeps focus');
  await page.setViewportSize({ width: 1366, height: 900 });
  // Erase all my data in English: the dialog asks for DELETE, any case works, then a box confirms.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('config'); document.querySelectorAll('[data-tab=config] details').forEach(d => { d.open = true; }); });
  await page.click('[data-action="cfg.purge"]');
  await page.waitForTimeout(100);
  ok(/Type DELETE to confirm/.test(await page.textContent('.modal')), 'English: the erase dialog asks for DELETE');
  await page.fill('.modal input[name="word"]', 'Delete');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  const purged = await page.evaluate(() => ({ n: ['transactions', 'debts', 'goals', 'accounts', 'holdings'].map(k => Store.state[k].length).join(), saved: JSON.parse(localStorage.getItem(Store.KEY) || '{}'), box: (document.querySelector('.modal') || {}).textContent || '' }));
  ok(purged.n === '0,0,0,0,0' && (purged.saved.transactions || []).length === 0 && /Your data has been erased/.test(purged.box), 'typing "Delete" erases everything (memory and storage) and confirms it', [purged.n, purged.box.slice(0, 80)]);
  await page.click('[data-dialog-ok]');
  // Smart CSV import (engine, streams, rules) — see e2e-imp.js.
  await require('./e2e-imp.js')(page, ok);
  // Spending donut: categories of the month, a slice opens its transactions, per person.
  await page.evaluate(() => { Store.reset('example'); Store.ui.spending = null; App.changed({ structural: true }); App.go('transacciones/reportes'); });
  await page.waitForTimeout(400);
  const sp = await page.evaluate(() => { const t = new Date(), y = t.getFullYear(), m = t.getMonth(); const r = Engine.spendingBreakdown(Store.state.transactions, { from: Engine.isoDate(new Date(y, m, 1)), to: Engine.isoDate(new Date(y, m + 1, 0)) }); return { total: Fmt.money(r.total), first: r.rows[0].key, n: r.rows.length, rows: document.querySelectorAll('#spend-legend .spend-row').length, center: document.getElementById('spend-center').textContent, chart: !!UI.chartInstance('spend-donut') }; });
  ok(sp.chart && sp.rows === sp.n && sp.n <= 7 && sp.center.includes(sp.total), 'spending: donut, total in the middle, one row per slice', sp);
  // Tap a row: selected (tinted, the middle shows it); tap again: its subcategories in an inner ring.
  await page.click('#spend-legend .spend-row >> nth=0');
  await page.waitForTimeout(150);
  const sel1 = await page.evaluate(() => ({ pick: Store.ui.spending.pick, cat: Store.ui.spending.cat, picked: !!document.querySelector('#spend-legend .spend-row.is-picked'), center: document.getElementById('spend-center').textContent, open: !!document.querySelector('[data-action="spend.open"]') }));
  ok(sel1.pick === 'Vivienda' && !sel1.cat && sel1.picked && /Housing/.test(sel1.center) && /Select to view transactions/.test(sel1.center) && sel1.open, 'spending: a tap selects a category (middle shows it)', sel1);
  await page.click('#spend-legend .spend-row.is-picked');
  await page.waitForTimeout(150);
  const lvl2 = await page.evaluate(() => ({ cat: Store.ui.spending.cat, rings: UI.chartInstance('spend-donut').data.datasets.length, text: document.getElementById('spend-legend').textContent, center: document.getElementById('spend-center').textContent, rows: document.querySelectorAll('#spend-legend .spend-row').length, back: !!document.querySelector('[data-action="spend.back"]') }));
  ok(lvl2.cat === 'Vivienda' && lvl2.rings === 2 && /of all spending/.test(lvl2.text) && /period before/.test(lvl2.text) && /Total:/.test(lvl2.text) && /Housing/.test(lvl2.center) && lvl2.rows >= 1 && lvl2.back, 'spending: a second tap opens its subcategories (inner ring, Back, total)', lvl2);
  // The middle: the transactions of what's selected, in a sheet with ←; one opens its details.
  await page.click('#spend-legend .spend-row >> nth=0');
  await page.click('#spend-center');
  await page.waitForTimeout(200);
  const lvl3 = await page.evaluate(() => { const sh = document.querySelector('.modal-backdrop.sheet'); return { sub: Store.ui.spending.pick, rows: sh ? sh.querySelectorAll('[data-action="spend.txnOpen"]').length : 0, end: sh ? /End of the list/.test(sh.textContent) : false, back: !!(sh && sh.querySelector('[data-action="spend.txnsBack"]')) }; });
  ok(!!lvl3.sub && lvl3.rows >= 1 && lvl3.end && lvl3.back, 'spending: the middle lists the transactions with ← back', lvl3);
  const spTid = await page.evaluate(() => Number(document.querySelector('[data-action="spend.txnOpen"]').dataset.id));
  await page.click('[data-action="spend.txnOpen"] >> nth=0');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => /Transaction details/.test(document.querySelector('.modal-backdrop.sheet').textContent) && !!document.querySelector('[data-action="tdt.backTo"]')), 'spending: a transaction opens its details with Back');
  // Change its category: the picker, "Category updated", Back returns to the list.
  await page.click('[data-action="tdt.category"]');
  await page.evaluate(() => document.querySelector('[data-action="tdt.catOpen"][data-parent="Alimentación"]').click());
  await page.evaluate(() => document.querySelector('[data-action="tdt.catSet"][data-parent="Alimentación"]:not([data-sub=""])').click());
  await page.waitForTimeout(150);
  const spChanged = await page.evaluate((id) => ({ cat: Store.state.transactions.find(t => t.id === id).parentCategory, toast: /Category updated/.test(document.body.textContent) }), spTid);
  ok(spChanged.cat === 'Alimentación' && spChanged.toast, 'spending: changing the category saves it and says so', spChanged);
  await page.click('[data-action="tdt.backTo"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !!document.querySelector('.modal-backdrop.sheet [data-action="spend.txnsBack"]')), 'spending: Back from the details returns to the list');
  await page.click('[data-action="spend.txnsBack"]');
  await page.waitForTimeout(300);
  await page.click('[data-action="spend.back"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !Store.ui.spending.cat && !document.querySelector('.modal-backdrop.sheet') && UI.chartInstance('spend-donut').data.datasets.length === 1), 'spending: back to all categories');
  // Dates: ‹ steps a month back; the picker sets Last 90 days; household only.
  const spFrom = await page.evaluate(() => Store.ui.spending.from);
  await page.click('[data-action="spend.rangeStep"][data-dir="-1"]');
  await page.waitForTimeout(150);
  const spPrev = await page.evaluate(() => ({ from: Store.ui.spending.from, to: Store.ui.spending.to, label: document.getElementById('spend-range-label').textContent }));
  ok(spPrev.from < spFrom && spPrev.from.slice(8) === '01' && spPrev.label.includes(spPrev.from.slice(0, 4)), 'spending: ‹ steps one month back', spPrev);
  await page.click('[data-action="spend.rangePick"]');
  await page.click('[data-action="spend.rangeSet"][data-range="90d"]');
  await page.selectOption('#spend-who', String(-1));
  await page.waitForTimeout(150);
  const sp6 = await page.evaluate(() => ({ center: document.getElementById('spend-center').textContent, range: Store.ui.spending.range, label: document.getElementById('spend-range-label').textContent }));
  ok(sp6.range === '90d' && /Last 90 days/.test(sp6.label) && /Total amount/.test(sp6.center) && !sp6.center.includes(sp.total), 'spending: last 90 days, household only', sp6);
  // Income tab: where the money came from (90 days, everyone: paydays are in there).
  await page.selectOption('#spend-who', '');
  await page.click('[data-action="spend.kind"][data-kind="income"]');
  await page.waitForTimeout(150);
  const spInc = await page.evaluate(() => ({ kind: Store.ui.spending.kind, active: document.querySelector('[data-action="spend.kind"].active').dataset.kind, rows: document.querySelectorAll('#spend-legend .spend-row').length, first: Engine.spendingBreakdown(Store.state.transactions, { from: Store.ui.spending.from, to: Store.ui.spending.to, type: 'Ingreso' }).rows[0] }));
  ok(spInc.kind === 'income' && spInc.active === 'income' && spInc.rows >= 1 && !!spInc.first, 'spending: the Income tab shows income by category', spInc);
  await page.click('[data-action="spend.kind"][data-kind="spend"]');
  // Trends: stacked areas by category with an income line; 1Y; one category; one account.
  await page.click('[data-action="trends.months"][data-months="12"]');
  await page.waitForTimeout(200);
  const tr1 = await page.evaluate(() => { const c = UI.chartInstance('trends-chart'); return { labels: c.data.labels.length, sets: c.data.datasets.map(d => d.label), stacked: c.options.scales.y.stacked, rows: document.querySelectorAll('#trends-table tr').length }; });
  ok(tr1.labels === 12 && tr1.rows === 12 && tr1.stacked && tr1.sets.includes('Income') && tr1.sets.length >= 3, 'trends: 12 months stacked by category with income', tr1);
  await page.selectOption('#trends-category', 'Alimentación');
  await page.waitForTimeout(200);
  const tr2 = await page.evaluate(() => UI.chartInstance('trends-chart').data.datasets.map(d => d.label));
  ok(!tr2.includes('Income') && tr2.length >= 1 && !tr2.includes('Food'), 'trends: one category shows its subcategories', tr2);
  await page.evaluate(() => { Store.state.transactions.push({ id: 999001, date: Engine.isoDate(new Date()), type: 'Gasto', parentCategory: 'Ocio', category: 'Cine', description: 'Movies', amount: 33, accountId: 77 }); App.update(); });
  await page.selectOption('#trends-category', '');
  await page.evaluate(() => { const s = document.getElementById('trends-account'); s.insertAdjacentHTML('beforeend', '<option value="77">x</option>'); s.value = '77'; s.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const tr3 = await page.evaluate(() => { const c = UI.chartInstance('trends-chart'); return c.data.datasets.map(d => d.label + ':' + d.data.reduce((a, v) => a + v, 0)); });
  ok(tr3.length === 2 && /:33$/.test(tr3[0]) && tr3[1] === 'Income:0', 'trends: one account', tr3);
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== 999001); Store.ui.trends = null; App.update(); });
  // Budget bubbles: one per category, sized by plan, colored by share spent; tap → its lines.
  await page.evaluate(() => { Store.reset('example'); Store.ui.month = 'base'; Store.ui.budgetBubbles = false; App.changed({ structural: true }); App.go('presupuesto/plan'); });
  await page.waitForTimeout(300);
  await page.click('[data-action="budget.bubbles"]');
  await page.waitForTimeout(200);
  const bub = await page.evaluate(() => { const b = [...document.querySelectorAll('#bs-bubbles .bubble')]; const sizes = b.map(x => x.offsetWidth); return { n: b.length, grid: document.querySelector('#bud-simple .bs-grid').classList.contains('hidden'), first: b[0] && b[0].textContent.replace(/\s+/g, ' '), desc: sizes.every((v, i) => !i || v <= sizes[i - 1]), states: new Set(b.map(x => x.className.match(/is-(\w+)/)[1])).size, pressed: document.querySelector('[data-action="budget.bubbles"]').getAttribute('aria-pressed') }; });
  ok(bub.n >= 5 && bub.grid && /Housing/.test(bub.first) && bub.desc && bub.states >= 2 && bub.pressed === 'true', 'bubbles: one per category, biggest plan first, colored by spending', bub);
  // They don't overlap, they show the month with ‹ ›, and the summary opens to spent / earned / unbudgeted.
  const bubLay = await page.evaluate(() => { const r = [...document.querySelectorAll('#bub-field .bubble')].map(b => { const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, r: q.width / 2 }; }); let over = 0; r.forEach((a, i) => r.slice(i + 1).forEach(c => { if (Math.hypot(a.x - c.x, a.y - c.y) < a.r + c.r - 2) over++; })); return { over, month: document.getElementById('bub-month').textContent, icons: document.querySelectorAll('#bub-field .bubble-icon').length, n: r.length }; });
  ok(bubLay.over === 0 && /\d{4}/.test(bubLay.month) && bubLay.icons === bubLay.n, 'bubbles: packed without overlaps, each with its icon, month shown', bubLay);
  await page.click('[data-action="budget.sumToggle"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => { const t = document.querySelector('.bub-sum').textContent; return /Spent .* of .* budgeted/.test(t) && /Earned .* of .* projected income/.test(t) && /unbudgeted|over your income/.test(t); }), 'bubbles: the summary shows spent of budgeted, earned of projected and unbudgeted');
  // Drag a bubble: it moves where it's dropped and the others make room (still no overlaps).
  await page.evaluate(() => document.getElementById('bub-field').scrollIntoView({ block: 'center' }));
  const dragFrom = await page.evaluate(() => { const b = document.querySelectorAll('#bub-field .bubble')[3].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  const dragTo = await page.evaluate(() => { const b = document.querySelectorAll('#bub-field .bubble')[0].getBoundingClientRect(); return { x: b.x + b.width / 2, y: b.y + b.height / 2 }; });
  await page.mouse.move(dragFrom.x, dragFrom.y); await page.mouse.down();
  for (let k = 1; k <= 8; k++) await page.mouse.move(dragFrom.x + (dragTo.x - dragFrom.x) * k / 8, dragFrom.y + (dragTo.y - dragFrom.y) * k / 8);
  await page.mouse.up();
  await page.waitForTimeout(900);
  const dragged = await page.evaluate(([to, from]) => { const b = [...document.querySelectorAll('#bub-field .bubble')].map(x => { const q = x.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2, r: q.width / 2 }; }); let over = 0; b.forEach((a, i) => b.slice(i + 1).forEach(c => { if (Math.hypot(a.x - c.x, a.y - c.y) < a.r + c.r - 2) over++; })); return { near: Math.hypot(b[3].x - to.x, b[3].y - to.y) < Math.hypot(from.x - to.x, from.y - to.y) * 0.6, over, sheet: !!document.querySelector('.modal-backdrop.sheet') }; }, [dragTo, dragFrom]);
  ok(dragged.near && dragged.over === 0 && !dragged.sheet, 'bubbles: dragging one moves it and the others make room (no sheet opens)', dragged);
  await page.click('#bs-bubbles .bubble >> nth=0');
  await page.waitForTimeout(300);
  const bsheet = await page.evaluate(() => { const m = document.querySelector('.modal-backdrop.sheet'); const c = UI.chartInstance('bub-months'); return m ? { title: m.querySelector('.modal-title').textContent, head: m.querySelector('.bub-detail-head').textContent, rows: m.querySelectorAll('.bub-line').length, pace: !!m.querySelector('#bub-pace'), bars: c ? c.data.datasets[0].data.length : 0, dashed: c ? !!c.data.datasets[1].borderDash : false, edit: !!m.querySelector('.bub-actions [data-action="budget.bubEdit"]'), add: !!m.querySelector('[data-action="budget.bubAdd"]') } : null; });
  ok(bsheet && /\d{4}/.test(bsheet.title) && /Housing/.test(bsheet.head) && bsheet.rows >= 1 && bsheet.bars === 12 && bsheet.dashed && bsheet.edit && bsheet.add, 'bubbles: tapping one shows it with ✎ and +, 12 months of bars with the budget dashed, and its lines', bsheet);
  // ✎: edit the budget (the change goes to its biggest line), Save; Cancel goes back.
  await page.click('.bub-actions [data-action="budget.bubEdit"]');
  const bEdit = await page.evaluate(() => ({ q: document.getElementById('bub-detail').textContent, v: Number(document.getElementById('bub-edit-amt').value), del: !!document.querySelector('[data-action="budget.bubDelete"]') }));
  ok(/Edit budget: Housing/.test(bEdit.q) && /Total unbudgeted/.test(bEdit.q) && bEdit.v > 0 && bEdit.del, 'bubbles: ✎ asks for the new budget, shows what is unbudgeted and offers Delete', bEdit);
  await page.fill('#bub-edit-amt', String(Math.round(bEdit.v + 100)));
  await page.click('[data-action="budget.bubSave"]');
  await page.waitForTimeout(250);
  const bSaved = await page.evaluate(() => Engine.monthItems(Store.active(), 'base').filter(it => !it.link && it.linkedCategory === 'Vivienda').reduce((a, it) => a + Number(it.real), 0));
  ok(Math.abs(bSaved - Math.round(bEdit.v + 100)) < 0.01 && await page.evaluate(() => !!document.querySelector('.bub-detail-head')), 'bubbles: saving changes the budget and returns to the bubble', [bSaved, bEdit.v]);
  // +: a sub-budget from the category's subcategories.
  await page.click('[data-action="budget.bubAdd"]');
  const subName = await page.evaluate(() => { const b = document.querySelector('[data-action="budget.bubSub"]:not([disabled])'); return b && b.dataset.sub; });
  await page.click('[data-action="budget.bubSub"]:not([disabled]) >> nth=0');
  await page.fill('#bub-edit-amt', '40');
  await page.click('[data-action="budget.bubSave"]');
  await page.waitForTimeout(250);
  const bSub = await page.evaluate((sub) => { const it = Engine.monthItems(Store.active(), 'base').find(x => x.linkedCategory === 'Vivienda' && x.name === I18n.t(sub)); return it ? Number(it.real) : null; }, subName);
  ok(bSub === 40, 'bubbles: + adds a sub-budget from the subcategories', [subName, bSub]);
  // View transactions: in the sheet, ← back to the bubble.
  await page.click('[data-action="budget.bubTxns"]');
  ok(await page.evaluate(() => document.querySelectorAll('#bub-detail [data-action="budget.bubTxn"]').length >= 1 && /End of the list/.test(document.getElementById('bub-detail').textContent)), 'bubbles: View transactions lists the month\'s transactions');
  await page.click('#bub-detail [data-action="budget.bubBack"]');
  // The slider changes the line's planned amount; the pace says where spending would be by today.
  const slid = await page.evaluate(() => { const el = document.querySelector('.bub-slider'); const id = el.dataset.id; el.value = '1500'; el.dispatchEvent(new Event('input', { bubbles: true })); const it = Engine.monthItems(Store.active(), 'base').find(x => String(x.id) === id); return { real: it.real, label: el.closest('.bub-line').querySelector('[data-planned]').textContent, pace: document.getElementById('bub-pace').textContent }; });
  ok(slid.real === 1500 && /1,500/.test(slid.label) && /By today|spent of/.test(slid.pace), 'bubbles: a slider changes the plan; the pace shows', slid);
  await page.click('.modal-backdrop.sheet [data-action="budget.bubbleLine"] >> nth=0');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').length === 1 && !document.querySelector('[data-action="budget.bubbleLine"]')), 'bubbles: a line opens its details');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  await page.click('[data-action="budget.bubbles"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !document.querySelector('#bud-simple .bs-grid').classList.contains('hidden') && document.getElementById('bs-bubbles').classList.contains('hidden')), 'bubbles: back to cards');
  // "Add line" in a group adds the line to that group, named in English.
  for (const g of ['Ahorro', 'Gasto Fijo']) {
    const n0 = await page.evaluate(() => Store.active().budgetBase.length);
    await page.click(`#bud-simple .bs-card[data-group="${g}"] [data-action="budget.addRow"]`);
    await page.waitForTimeout(200);
    const added = await page.evaluate(([g, n0]) => { const it = Store.active().budgetBase[n0]; const card = document.querySelector(`#bud-simple .bs-card[data-group="${g}"]`); const inp = card && card.querySelector(`[data-line="${it && it.id}"] .bs-name-input`); return { it, inCard: !!inp, shown: inp && inp.value, focused: document.activeElement === inp }; }, [g, n0]);
    ok(added.it && added.it.type === g && added.it.name === 'New line' && added.inCard && added.shown === 'New line' && added.focused, `Add line in the ${g} group adds it there, named "New line"`, added);
    await page.evaluate(() => { const yd = Store.active(); yd.budgetBase.pop(); App.changed({ structural: true }); });
  }
  // Month ‹ ›: another month; a month with nothing planned shows the intro with Auto-generate.
  await page.evaluate(() => { Store.ui.budgetBubbles = true; App.update(); });
  const bm0 = await page.evaluate(() => document.getElementById('bub-month').textContent);
  await page.click('[data-action="budget.bubMonth"][data-dir="1"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate((m0) => document.getElementById('bub-month').textContent !== m0 && Store.ui.month !== 'base', bm0), 'bubbles: › shows the next month');
  await page.evaluate(() => { const yd = Store.active(), m = Store.ui.month; yd.monthOverrides[m] = []; App.changed({ structural: true }); });
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => /Understand the health of your finances/.test(document.getElementById('bs-bubbles').textContent) && !!document.querySelector('[data-action="budget.autoGen"]')), 'bubbles: an empty month shows the intro with Auto-generate budgets');
  await page.click('[data-action="budget.autoGen"]');
  await page.waitForTimeout(250);
  const bAuto = await page.evaluate(() => ({ lines: Engine.monthItems(Store.active(), Store.ui.month).length, bubbles: document.querySelectorAll('#bub-field .bubble').length }));
  ok(bAuto.lines >= 3 && bAuto.bubbles >= 3, 'bubbles: Auto-generate makes budgets from the last 3 months', bAuto);
  await page.evaluate(() => App.undo());
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Engine.monthItems(Store.active(), Store.ui.month).length === 0), 'bubbles: Auto-generate is undoable');
  await page.evaluate(() => { Store.ui.month = 'base'; Store.ui.budgetBubbles = false; App.changed({ structural: true }); });
  // Cash flow: daily balance ahead, red below $0, cash events added, shown and removed (undoable).
  await page.evaluate(() => { Store.reset('example'); Store.ui.flowDays = 30; App.changed({ structural: true }); App.go('resumen'); });
  await page.waitForTimeout(300);
  const fl1 = await page.evaluate(() => { const c = UI.chartInstance('flow-chart'); return { n: c.data.labels.length, today: c.options.plugins.todayLine.index, note: document.getElementById('flow-note').textContent }; });
  ok(fl1.n === 30 && fl1.today === 0 && /lowest point|Below \$0/i.test(fl1.note), 'cash flow: 30 days from today', fl1);
  // "+ Add an event" → Create manual event: payee, amount, date (once).
  await page.evaluate(() => { document.getElementById('dash-flow-card').open = true; });
  await page.click('[data-action="flow.newEvent"]');
  await page.click('[data-action="cev.manual"]');
  await page.fill('#flow-name', 'Car repair');
  await page.fill('#flow-amount', '25000');
  await page.evaluate(() => { const d = new Date(); d.setDate(d.getDate() + 5); const el = document.getElementById('flow-date'); el.value = Engine.isoDate(d); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('[data-action="flow.add"]');
  await page.waitForTimeout(300);
  const fl2 = await page.evaluate(() => { const c = UI.chartInstance('flow-chart'); const ds = c.data.datasets[0]; return { ev: Store.state.cashEvents.map(e => e.name + ':' + e.amount).join(), marked: ds.pointRadius.filter(r => r > 0).length, neg: Math.min(...ds.data) < 0, below: typeof ds.fill === 'object' && !!ds.fill.below, list: document.getElementById('flow-events').textContent, cal: Cash.events(Engine.isoDate(new Date()), Engine.isoDate(new Date(Date.now() + 9 * 864e5))).list.some(e => e.kind === 'oneoff') }; });
  ok(fl2.ev === 'Car repair:-25000' && fl2.marked === 1 && fl2.neg && fl2.below && /Car repair/.test(fl2.list) && fl2.cal, 'cash flow: a cash event shows on the chart, the list and the calendar', fl2);
  await page.click('[data-action="flow.days"][data-days="90"]');
  await page.click('[data-action="flow.del"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.state.cashEvents.length === 0 && UI.chartInstance('flow-chart').data.labels.length === 90), 'cash flow: 90 days; removing the event');
  await page.click('.toast-undo button, .toast-undo [data-toast-action], .toast-undo .toast-btn').catch(() => page.evaluate(() => App.undo()));
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.state.cashEvents.length === 1), 'cash flow: removing is undoable');
  // Debts: each debt stacked month by month until debt-free; the table has rate and payment.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/metas'); });
  await page.waitForTimeout(300);
  const ds = await page.evaluate(() => { const c = UI.chartInstance('debt-stack-chart'), p = App.buildContext().debts; const sets = c.data.datasets; const last = c.data.labels.length - 1; return { n: sets.length, debts: Store.state.debts.filter(d => d.balance > 0).length, stacked: c.options.scales.y.stacked, len: c.data.labels.length, months: p.months, endZero: sets.every(d => d.data[last] === 0), start: Math.round(sets.reduce((t, d) => t + d.data[0], 0)), total: Math.round(Store.state.debts.reduce((t, d) => t + (Number(d.balance) || 0), 0)), head: [...document.querySelectorAll('#debt-ladder-table')].length && document.querySelector('#debt-ladder-table').closest('table').querySelector('thead').textContent, row: document.querySelector('#debt-ladder-table tr').textContent }; });
  ok(ds.n === ds.debts && ds.stacked && ds.len === ds.months + 1 && ds.endZero && Math.abs(ds.start - ds.total) <= ds.n && /Rate/.test(ds.head) && /Payment/.test(ds.head) && /%/.test(ds.row), 'debts: stacked per debt to debt-free, table with rate and payment', ds);
  // Net worth over time: assets up, liabilities down, the net worth line; 6M / 1Y / All; table.
  await page.evaluate(() => { Store.reset('example'); Store.ui.nwRange = 12; Store.ui.nwView = 'bars'; App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(300);
  const nwm = await page.evaluate(() => { const c = UI.chartInstance('nw-month-chart'), h = Store.state.netWorthHistory.slice(-12), [line, a, l] = c.data.datasets; return { n: c.data.labels.length, line: line.type === 'line' && line.data.at(-1) === h.at(-1).value, a: a.data.at(-1) === h.at(-1).assets, l: l.data.at(-1) === -h.at(-1).liabilities, rows: document.querySelectorAll('#nw-month-table tr').length, change: document.getElementById('nw-month-change').textContent }; });
  ok(nwm.n === 12 && nwm.line && nwm.a && nwm.l && nwm.rows === 12 && /since/.test(nwm.change), 'net worth: assets, liabilities and the line, 1 year', nwm);
  await page.click('[data-action="nw.range"][data-months="6"]');
  await page.waitForTimeout(150);
  const n6 = await page.evaluate(() => UI.chartInstance('nw-month-chart').data.labels.length);
  await page.click('[data-action="nw.range"][data-months="0"]');
  await page.waitForTimeout(150);
  ok(n6 === 6 && await page.evaluate(() => UI.chartInstance('nw-month-chart').data.labels.length === Store.state.netWorthHistory.length), 'net worth: 6M and All', n6);
  // Like the bank's: the line (green up, gray down), 9M, current net worth; tap a month: its net
  // worth, the change from the month before, and its gains & losses account by account.
  await page.click('[data-action="nw.view"][data-view="line"]');
  await page.click('[data-action="nw.range"][data-months="9"]');
  await page.waitForTimeout(200);
  const nwl = await page.evaluate(() => { const c = UI.chartInstance('nw-month-chart'), h = Store.state.netWorthHistory; return { type: c.config.type, n: c.data.labels.length, cur: document.getElementById('nw-current').textContent, last: Fmt.money(h.at(-1).value), seg: typeof c.data.datasets[0].segment.borderColor === 'function', link: !!document.querySelector('#nw-progress [data-focus="nw-sheet"]') }; });
  ok(nwl.type === 'line' && nwl.n === 9 && /Current net worth/.test(nwl.cur) && nwl.cur.includes(nwl.last) && nwl.seg && nwl.link, 'net worth: the line, 9 months, current net worth and View assets & liabilities', nwl);
  const nwPt = await page.evaluate(() => { const c = UI.chartInstance('nw-month-chart'); c.canvas.scrollIntoView({ block: 'center' }); const p = c.getDatasetMeta(0).data[3], r = c.canvas.getBoundingClientRect(); return { x: r.left + p.x, y: r.top + p.y }; });
  await page.mouse.click(nwPt.x, nwPt.y);
  await page.waitForTimeout(200);
  const nwp = await page.evaluate(() => { const h = Store.state.netWorthHistory, i = h.findIndex(x => x.month === Store.ui.nwPick); return { i, n: h.length, txt: document.getElementById('nw-month-pick').textContent, diff: Fmt.money(Math.abs(h[i].value - h[i - 1].value)), btn: !!document.querySelector('[data-action="nw.gains"]') }; });
  ok(nwp.i === nwp.n - 6 && /net worth/.test(nwp.txt) && /From the previous month/.test(nwp.txt) && nwp.txt.includes(nwp.diff) && nwp.btn, 'net worth: tapping a month shows it and the change from the month before', nwp);
  await page.click('[data-action="nw.gains"]');
  await page.waitForTimeout(200);
  const gl = await page.evaluate(() => { const m = document.querySelector('.modal-backdrop.sheet'); return { title: m.querySelector('.modal-title').textContent, rows: m.querySelectorAll('.gl-row').length, heads: [...m.querySelectorAll('.gl-head')].map(x => x.textContent) }; });
  ok(/Gains & losses/.test(gl.title) && gl.rows >= 2 && /Gains/.test(gl.heads[0]) && /Losses/.test(gl.heads[1]), 'net worth: a month\'s gains & losses by account', gl);
  await page.click('[data-action="nw.gainsBack"]');
  // Each account's history (its value at the end of each month).
  await page.evaluate(() => { Store.ui.nwOpen = 'checking'; App.update(); });
  await page.click('#nw-sheet-body [data-action="nw.history"] >> nth=0');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const c = UI.chartInstance('nw-hist-chart'); return !!c && c.data.labels.length === 6 && c.data.datasets[0].data.every(v => v > 0) && /Account history/.test(document.querySelector('.modal-backdrop.sheet').textContent); }), 'net worth: an account\'s history, month by month');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Money tools bar: every tool one tap away; Help grid with a how-to per tool that opens it.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('resumen'); });
  await page.waitForTimeout(200);
  ok(await page.$$eval('#tools-bar a', a => a.length) === 10, 'tools bar: 10 tools');
  await page.click('#tools-bar a[data-focus="spend-card"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Store.ui.tab === 'transacciones' && Math.abs(document.getElementById('spend-card').getBoundingClientRect().top) < 400), 'tools bar: Spending opens the donut');
  await page.evaluate(() => App.go('resumen'));
  await page.click('[data-action="tools.help"]');
  await page.waitForTimeout(150);
  ok(await page.$$eval('.help-grid button', b => b.length) === 12, 'help: 12 tiles');
  await page.click('[data-action="tools.topic"][data-key="debts"]');
  await page.waitForTimeout(100);
  ok(/snowball/.test(await page.textContent('.modal-backdrop.sheet')), 'help: a topic explains the tool');
  await page.click('[data-action="tools.go"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Store.ui.tab === 'futuro' && !document.querySelector('.modal-backdrop.sheet')), 'help: Open goes to the tool');
  // All accounts: everything by type with totals; add a manual property and a loan; open a row.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(300);
  const hub = await page.evaluate(() => { const h = AccountsHub.last; return { groups: [...document.querySelectorAll('#hub-body .hub-group')].map(g => g.id.slice(4)), rows: document.querySelectorAll('#hub-body .hub-row').length, n: h.groups.reduce((t, g) => t + g.rows.length, 0), owedRed: !!document.querySelector('#hub-loan header .text-red-600'), net: Math.round(h.net) }; });
  ok(hub.groups.includes('checking') && hub.groups.includes('card') && hub.groups.includes('realestate') && hub.groups.includes('retirement') && hub.groups.includes('health') && hub.rows === hub.n && hub.owedRed, 'accounts hub: groups by type, owed in red', hub);
  await page.click('[data-action="hub.add"]');
  await page.waitForTimeout(150);
  await page.evaluate(() => { const el = document.getElementById('hub-new-type'); el.value = 'asset:' + Engine.ASSET_CATEGORIES[1]; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#hub-new-name', 'Camper');
  await page.fill('#hub-new-bal', '12000');
  await page.click('[data-action="hub.save"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.state.assets.some(a => a.name === 'Camper' && a.category === 'Vehículo' && a.purchaseValue === 12000) && /Camper/.test(document.getElementById('hub-vehicle').textContent)), 'accounts hub: add a property');
  await page.click('[data-action="hub.add"]');
  await page.selectOption('#hub-new-type', 'acct:tarjeta');
  await page.fill('#hub-new-name', 'Store card');
  await page.fill('#hub-new-bal', '300');
  await page.click('[data-action="hub.save"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.state.accounts.some(a => a.name === 'Store card' && a.kind === 'tarjeta' && a.balance === -300) && /Store card/.test(document.getElementById('hub-card').textContent)), 'accounts hub: a card is what you owe');
  await page.click('#hub-loan .hub-row >> nth=0');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => /Auto loan|Student loan|Other debt/.test(document.querySelector('.modal-backdrop.sheet').textContent)), 'accounts hub: a loan opens its details');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Account details: Activity (12 months in/out + transactions) and Details synced with the debt.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(300);
  await page.click('#hub-checking .hub-row >> nth=0');
  await page.waitForTimeout(300);
  const acd1 = await page.evaluate(() => { const c = UI.chartInstance('acd-chart'); return { bars: c && c.data.labels.length, sets: c && c.data.datasets.map(d => d.label).join(), rows: document.querySelectorAll('.acd-txn').length }; });
  ok(acd1.bars === 12 && /Money out/.test(acd1.sets) && acd1.rows > 10, 'account details: activity chart and transactions', acd1);
  await page.evaluate(() => document.querySelector('.modal-backdrop.sheet [data-dialog-cancel]').click());
  await page.click('#hub-card .hub-row >> nth=0');
  await page.waitForTimeout(200);
  await page.click('[data-action="acd.tab"][data-tab="details"]');
  await page.waitForTimeout(150);
  await page.evaluate(() => { const set = (f, v) => { const el = document.querySelector(`.acd-fields [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }; set('rate', '19.99'); set('minPayment', '160'); set('creditLimit', '10000'); set('dueDay', '15'); });
  await page.waitForTimeout(200);
  const acd2 = await page.evaluate(() => { const d = Store.state.debts.find(x => x.kind === 'tarjeta'); return { rate: d.rate, min: d.minPayment, due: d.dueDay, limit: d.creditLimit }; });
  ok(acd2.rate === 19.99 && acd2.min === 160 && acd2.due === 15 && acd2.limit === 10000, 'account details: details change the debt the snowball uses', acd2);
  await page.evaluate(() => document.querySelector('.modal-backdrop.sheet [data-dialog-cancel]').click());
  // An unlinked card account becomes a debt from its details.
  await page.evaluate(() => { Store.state.accounts.push({ id: 99, name: 'Store card', kind: 'tarjeta', balance: -420, updatedAt: Engine.isoDate(new Date()) }); App.changed({ structural: true }); AccountsHub.openDetails('account', 99); });
  await page.waitForTimeout(200);
  await page.click('[data-action="acd.tab"][data-tab="details"]');
  await page.click('[data-action="acd.toDebt"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => { const a = Store.state.accounts.find(x => x.id === 99), d = Store.state.debts.find(x => x.id === a.debtId); return !!d && d.balance === 420 && d.kind === 'tarjeta' && AccountsHub.last.groups.find(g => g.key === 'card').rows.filter(r => r.name === 'Store card').length === 1; }), 'account details: add an unlinked card to the debts, counted once');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Transactions toolbar: date range presets, ‹ › stepping, accounts, download.
  await page.evaluate(() => { Store.reset('example'); Store.ui.txnFilters = { year: 'all', month: 'all', type: 'all', category: 'all' }; Store.ui.txnLimit = 5000; App.changed({ structural: true }); App.go('transacciones/lista'); });
  await page.waitForTimeout(250);
  const rows = () => page.evaluate(() => [...document.querySelectorAll('#txn-body .txn-item')].map(r => { const t = Store.state.transactions.find(x => x.id === Number(r.dataset.row)); return { d: t.date, a: t.accountId || null }; }));
  await page.click('[data-action="txn.rangePick"]');
  await page.click('[data-action="txn.rangeSet"][data-range="last-month"]');
  await page.waitForTimeout(200);
  const lm = await page.evaluate(() => Engine.rangeFor('last-month', new Date()));
  let r1 = await rows();
  ok(r1.length > 20 && r1.every(r => r.d >= lm.from && r.d <= lm.to) && await page.textContent('#txn-range-label') === 'Last month', 'transactions: last month', r1.length);
  await page.click('[data-action="txn.rangeStep"][data-dir="-1"]');
  await page.waitForTimeout(200);
  const prev = await page.evaluate((lm) => Engine.shiftRange(lm.from, lm.to, -1), lm);
  r1 = await rows();
  ok(r1.length > 20 && r1.every(r => r.d >= prev.from && r.d <= prev.to) && /–/.test(await page.textContent('#txn-range-label')), 'transactions: ‹ steps a month back', prev);
  await page.click('[data-action="txn.accounts"]');
  await page.waitForTimeout(150);
  await page.evaluate(() => { const w = Store.state.accounts.find(a => a.kind === 'efectivo'); document.querySelectorAll('.acct-pick').forEach(c => { c.checked = c.value === String(w.id); }); });
  await page.click('[data-action="txn.acctApply"]');
  await page.waitForTimeout(200);
  const wallet = await page.evaluate(() => Store.state.accounts.find(a => a.kind === 'efectivo').id);
  r1 = await rows();
  ok(r1.length > 0 && r1.every(r => r.a === wallet) && await page.textContent('#txn-accts-label') === '1 account', 'transactions: one account', r1.length);
  const csv = await page.evaluate(async () => { let got = null; const keep = Native.saveSecure; Native.saveSecure = (name, text) => { got = { name, text }; return Promise.resolve('saved'); }; UI.run('txn.download', {}); Native.saveSecure = keep; return got; });
  ok(csv && /^transactions_\d{4}-\d\d-01_/.test(csv.name) && csv.text.trim().split('\n').length === r1.length + 1 && /Date,Payee,Category/.test(csv.text), 'transactions: download what is shown', csv && csv.name);
  // A Month close link (year + month) still works: it becomes that month.
  await page.evaluate(() => { Store.ui.txnFilters = { year: '2026', month: '3', type: 'Gasto', category: 'all', member: 'all' }; App.update(); });
  await page.waitForTimeout(150);
  r1 = await rows();
  ok(r1.length > 0 && r1.every(r => r.d.startsWith('2026-03')), 'transactions: an old year/month filter becomes a range');
  await page.evaluate(() => { Store.ui.txnFilters = { year: 'all', month: 'all', type: 'all', category: 'all' }; Store.ui.txnLimit = null; App.update(); });
  // Transaction details: tap a row; payee, memo, tag, category; flag; exclude (and include again).
  await page.evaluate(() => { Store.reset('example'); Store.ui.txnFilters = { year: 'all', month: 'all', type: 'all', category: 'all' }; Store.ui.txnSearch = ''; App.changed({ structural: true }); App.go('transacciones/lista'); });
  await page.waitForTimeout(250);
  const tid = await page.evaluate(() => Number(document.querySelector('#txn-body .txn-item:not(.row-editing)').dataset.row));
  await page.click(`#txn-body .txn-item[data-row="${tid}"] .txn-main`);
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => /Transaction details/.test(document.querySelector('.modal-backdrop.sheet').textContent)), 'transaction details: tapping a row opens them');
  const setDet = (f, v) => page.evaluate(([f, v]) => { const el = document.querySelector(`#tdt-body [data-field="${f}"]`); el.value = v; el.dispatchEvent(new Event('change', { bubbles: true })); }, [f, v]);
  await setDet('description', 'Corner Store');
  await setDet('memo', 'milk and bread');
  await page.evaluate(() => { const el = document.querySelector('#tdt-body [data-change="tdt.tag"]'); el.value = 'weekly'; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.click('[data-action="tdt.category"]');
  await page.waitForTimeout(150);
  await page.fill('#tdt-cat-q', 'coffee');
  await page.waitForTimeout(100);
  await page.click('[data-action="tdt.catSet"][data-sub="Cafetería"]');
  await page.waitForTimeout(150);
  const det = await page.evaluate((id) => { const t = Store.state.transactions.find(x => x.id === id); return { d: t.description, m: t.memo, tags: (t.tags || []).join(), c: t.parentCategory + '/' + t.category }; }, tid);
  ok(det.d === 'Corner Store' && det.m === 'milk and bread' && det.tags === 'weekly' && det.c === 'Alimentación/Cafetería', 'transaction details: payee, memo, tag and category (search)', det);
  await page.click('[data-action="tdt.menu"]');
  await page.click('[data-action="tdt.flag"]');
  await page.waitForTimeout(100);
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  await page.selectOption('#txn-f-origin', 'flagged');
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => { const r = [...document.querySelectorAll('#txn-body .txn-item')]; return r.length === 1 && Number(r[0].dataset.row) === id && !!r[0].querySelector('.fa-flag'); }, tid), 'transaction details: flagged filter');
  await page.selectOption('#txn-f-origin', 'all');
  await page.evaluate((id) => TxnDetails.open(id), tid);
  await page.waitForTimeout(150);
  const spentBefore = await page.evaluate((id) => { const t = Store.state.transactions.find(x => x.id === id); return Engine.spendingBreakdown(Store.state.transactions, { from: t.date, to: t.date }).total; }, tid);
  await page.click('[data-action="tdt.menu"]');
  await page.click('[data-action="tdt.exclude"]');
  await page.waitForTimeout(200);
  const exc = await page.evaluate((id) => { const t = Store.state.excludedTxns.find(x => x.id === id); return { gone: !Store.state.transactions.some(x => x.id === id), kept: !!t, spent: t && Engine.spendingBreakdown(Store.state.transactions, { from: t.date, to: t.date }).total, banner: /Excluded/.test(document.querySelector('.modal-backdrop.sheet').textContent) }; }, tid);
  ok(exc.gone && exc.kept && exc.banner && exc.spent < spentBefore, 'transaction details: excluded no longer counts', { exc, spentBefore });
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  await page.selectOption('#txn-f-origin', 'excluded');
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => [...document.querySelectorAll('#txn-body .txn-item')].map(r => Number(r.dataset.row)).join() === String(id), tid), 'transaction details: the Excluded filter shows it');
  await page.click(`#txn-body .txn-item[data-row="${tid}"] .txn-main`);
  await page.waitForTimeout(150);
  await page.click('[data-action="tdt.menu"]');
  await page.click('[data-action="tdt.exclude"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate((id) => Store.state.transactions.some(x => x.id === id) && !Store.state.excludedTxns.length, tid), 'transaction details: include again');
  await page.click('[data-action="tdt.menu"]');
  await page.click('[data-action="tdt.split"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => !!document.querySelector('.modal-backdrop') && !document.getElementById('tdt-body')), 'transaction details: Split opens the split');
  await page.keyboard.press('Escape');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach(m => m.remove()));
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  await page.selectOption('#txn-f-origin', 'all');
  // Smart budget: suggest from the last 90 days, apply the checked lines (undoable).
  await page.evaluate(() => { Store.reset('example'); Store.ui.month = 'base'; Store.ui.budgetBubbles = false; App.changed({ structural: true }); App.go('presupuesto/plan'); });
  await page.waitForTimeout(250);
  await page.click('[data-action="budget.suggest"]');
  await page.waitForTimeout(250);
  const sug = await page.evaluate(() => ({ rows: document.querySelectorAll('.sug-pick').length, checked: document.querySelectorAll('.sug-pick:checked').length }));
  ok(sug.rows > 10 && sug.checked >= 1 && sug.checked < sug.rows, 'smart budget: suggestions with the different ones checked', sug);
  const want = await page.evaluate(() => { const c = document.querySelector('.sug-pick:checked'); const row = c.closest('tr'); return { name: row.children[1].textContent, sugg: row.children[3].querySelector('span').textContent }; });
  await page.click('[data-action="budget.suggestApply"]');
  await page.waitForTimeout(250);
  const applied = await page.evaluate((w) => { const it = Engine.monthItems(Store.active(), 'base').find(x => I18n.t(x.name) === w.name); return it && Fmt.money0(it.real); }, want);
  ok(applied === want.sugg, 'smart budget: the checked line takes the suggestion', { want, applied });
  await page.evaluate(() => App.undo());
  await page.waitForTimeout(150);
  // Trends drill-down: tap a month → categories vs average → subcategories → transactions.
  await page.evaluate(() => { Store.reset('example'); Store.ui.trends = { months: 6, category: '', account: '' }; App.changed({ structural: true }); App.go('transacciones/reportes'); });
  await page.waitForTimeout(300);
  ok(/Tap a month/.test(await text(page, 'trends-drill')), 'trends drill: a hint before tapping');
  const tc = await page.$('#trends-chart'); await tc.scrollIntoViewIfNeeded(); const tb = await tc.boundingBox();
  await page.mouse.click(tb.x + tb.width * 0.5, tb.y + tb.height * 0.5);
  await page.waitForTimeout(250);
  const d1 = await page.evaluate(() => ({ month: (Store.ui.trends.drill || {}).month, rows: document.querySelectorAll('#trends-drill .spend-row').length, avg: /vs avg|= avg/.test(document.getElementById('trends-drill').textContent) }));
  ok(!!d1.month && d1.rows >= 3 && d1.avg, 'trends drill: a month shows its categories vs the average', d1);
  await page.evaluate(() => { const b = [...document.querySelectorAll('#trends-drill .spend-row')].find(x => x.dataset.key === 'Alimentación'); b.click(); });
  await page.waitForTimeout(200);
  const d2 = await page.evaluate(() => ({ cat: Store.ui.trends.drill.cat, head: document.querySelector('#trends-drill strong').textContent, rows: document.querySelectorAll('#trends-drill .spend-row').length }));
  ok(d2.cat === 'Alimentación' && /Food/.test(d2.head) && d2.rows >= 2, 'trends drill: a category shows its subcategories', d2);
  await page.click('#trends-drill .spend-row >> nth=0');
  await page.waitForTimeout(200);
  const d3 = await page.evaluate(() => ({ sub: Store.ui.trends.drill.sub, txns: document.querySelectorAll('#trends-drill .acd-txn').length }));
  ok(!!d3.sub && d3.txns >= 1, 'trends drill: a subcategory lists its transactions', d3);
  await page.click('[data-action="trends.up"]');
  await page.click('[data-action="trends.up"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !Store.ui.trends.drill.cat && !Store.ui.trends.drill.sub), 'trends drill: back up to the month');
  // Zoom: + twice = 4×, centered on the tapped band; a thin band fills enough of the chart to tap it;
  // drag moves (and isn't a tap); Ctrl+wheel zooms; "Show all" goes back.
  const thin = await page.evaluate(() => {
    const c = UI.chartInstance('trends-chart'), n = c.data.labels.length - 2;
    const sets = c.data.datasets.filter(d => d.stack === 'spend');
    let best = -1; sets.forEach((d, k) => { if (d.data[n] > 0 && (best < 0 || d.data[n] < sets[best].data[n])) best = k; });
    const sums = c.data.labels.map((_, i) => sets.reduce((t, d) => t + d.data[i], 0));
    return { band: best, month: n, value: sets[best].data[n], share: sets[best].data[n] / Math.max(...sums), label: sets[best].label };
  });
  await page.evaluate(({ band, month }) => { const o = Store.ui.trends, r = Engine.categoryTrend(Store.state.transactions, { end: new Date(), months: o.months, account: o.account, category: o.category }); const x = r.series[band]; o.focus = x.key === null ? '__other' : x.key; o.focusMonth = r.months[month]; o.drill = null; App.update(); }, thin);
  await page.click('[data-action="trends.zoom"][data-dir="1"]');
  await page.click('[data-action="trends.zoom"][data-dir="1"]');
  await page.waitForTimeout(150);
  const z1 = await page.evaluate(({ band, month }) => {
    const c = UI.chartInstance('trends-chart'), y = c.scales.y, meta = c.getDatasetMeta(band).data[month];
    const below = band ? c.getDatasetMeta(band - 1).data[month].y : y.getPixelForValue(0);
    return { zoom: Store.ui.trends.zoom, level: document.getElementById('trends-zoom-level').textContent, range: y.max - y.min, top: c.options.scales.y.max, px: Math.abs(below - meta.y), mid: (below + meta.y) / 2, pan: getComputedStyle(document.querySelector('[data-action="trends.pan"]')).display !== 'none' };
  }, thin);
  ok(z1.zoom === 4 && z1.level === '4×' && z1.pan && z1.px >= 12, 'trends zoom: + + = 4×, centered on the tapped band, which is now tall enough to tap; ▲ ▼ appear', { thin, z1 });
  await page.evaluate(() => { Store.ui.trends.focus = null; });
  const zc = await page.$('#trends-chart'); await zc.scrollIntoViewIfNeeded(); const zb = await zc.boundingBox();
  const xAt = await page.evaluate(({ month }) => UI.chartInstance('trends-chart').scales.x.getPixelForValue(month), thin);
  await page.mouse.click(zb.x + xAt, zb.y + z1.mid);
  await page.waitForTimeout(200);
  ok(await page.evaluate((label) => { const o = Store.ui.trends; return !!o.focus && (o.focus === label || I18n.t(o.focus) === label || (o.focus === '__other' && /Other/.test(label))); }, thin.label), 'trends zoom: tapping the thin band (zoomed in) picks it', await page.evaluate(() => Store.ui.trends.focus));
  const zBefore = await page.evaluate(() => ({ at: Store.ui.trends.zoomAt, focus: Store.ui.trends.focus }));
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height * 0.4);
  await page.mouse.down();
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height * 0.6, { steps: 6 });
  await page.mouse.up();
  await page.waitForTimeout(200);
  const zAfter = await page.evaluate(() => ({ at: Store.ui.trends.zoomAt, focus: Store.ui.trends.focus }));
  ok(zAfter.at > zBefore.at && zAfter.focus === zBefore.focus, 'trends zoom: dragging down moves the view up (and is not a tap)', { zBefore, zAfter });
  await page.mouse.move(zb.x + zb.width / 2, zb.y + zb.height / 2);
  await page.keyboard.down('Control'); await page.mouse.wheel(0, -100); await page.keyboard.up('Control');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.ui.trends.zoom) > 4, 'trends zoom: Ctrl + mouse wheel zooms in', await page.evaluate(() => Store.ui.trends.zoom));
  await page.click('[data-action="trends.pan"][data-dir="1"]');
  await page.click('[data-action="trends.zoomReset"]');
  await page.waitForTimeout(150);
  const z0 = await page.evaluate(() => { const c = UI.chartInstance('trends-chart'); return { zoom: Store.ui.trends.zoom, min: c.options.scales.y.min, level: document.getElementById('trends-zoom-level').textContent, pan: getComputedStyle(document.querySelector('[data-action="trends.pan"]')).display }; });
  ok(z0.zoom === 1 && z0.min === undefined && z0.level === '1×' && z0.pan === 'none', 'trends zoom: "Show all" goes back to the whole chart', z0);
  // Debt payoff controls: "what if" extra slider, add it to the budget; a debt's schedule.
  await page.evaluate(() => { Store.reset('example'); Store.ui.debtExtraTry = 0; App.changed({ structural: true }); App.go('futuro/metas'); });
  await page.waitForTimeout(300);
  const dBefore = await page.evaluate(() => ({ m: App.buildContext().debts.months, extra: App.buildContext().debtExtraRubros }));
  await page.evaluate(() => { const el = document.getElementById('debt-extra'); el.value = 300; el.dispatchEvent(new Event('input', { bubbles: true })); });
  await page.waitForTimeout(150);
  ok(/sooner/.test(await text(page, 'debt-extra-result')) && /less interest/.test(await text(page, 'debt-extra-result')), 'debts: what-if extra shows sooner and less interest', await text(page, 'debt-extra-result'));
  await page.click('[data-action="debt.extraApply"]');
  await page.waitForTimeout(250);
  const dAfter = await page.evaluate(() => ({ m: App.buildContext().debts.months, extra: App.buildContext().debtExtraRubros, slider: document.getElementById('debt-extra').value }));
  ok(dAfter.extra === dBefore.extra + 300 && dAfter.m < dBefore.m && dAfter.slider === '0', 'debts: add it to the budget', { dBefore, dAfter });
  await page.click('[data-action="debt.schedule"] >> nth=0');
  await page.waitForTimeout(250);
  const sch = await page.evaluate(() => { const rows = [...document.querySelectorAll('.modal-backdrop.sheet tbody tr')]; return { n: rows.length, last: rows.length && rows[rows.length - 1].lastElementChild.textContent, first: rows[0] && rows[0].children.length }; });
  ok(sch.n > 3 && sch.last === '$0.00' && sch.first === 5, 'debts: a schedule month by month down to $0', sch);
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Balance sheet: own vs owe by type; a type opens to its accounts; a property value edited in place.
  await page.evaluate(() => { Store.reset('example'); Store.ui.nwOpen = null; App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(250);
  const bs1 = await page.evaluate(() => ({ own: document.querySelectorAll('#nw-sheet-body .sheet-side')[0].textContent, owe: document.querySelectorAll('#nw-sheet-body .sheet-side')[1].textContent, types: document.querySelectorAll('#nw-sheet-body .sheet-head').length, net: AccountsHub.last.net }));
  ok(/What you own/.test(bs1.own) && /What you owe/.test(bs1.owe) && bs1.types >= 6, 'balance sheet: own and owe by type', bs1);
  await page.click('[data-action="sheet.toggle"][data-key="realestate"]');
  await page.waitForTimeout(150);
  await page.evaluate(() => { const el = document.querySelector('[data-change="sheet.assetValue"]'); el.value = String(Number(el.value) + 10000); el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.waitForTimeout(200);
  const bs2 = await page.evaluate(() => ({ net: AccountsHub.last.net, headline: document.querySelector('.sheet-net').textContent }));
  ok(Math.round(bs2.net - bs1.net) === 10000 && /Net worth/i.test(bs2.headline), 'balance sheet: a property value changes net worth', { bs1: bs1.net, bs2 });
  await page.click('[data-action="sheet.toggle"][data-key="loan"]');
  await page.waitForTimeout(150);
  await page.click('#nw-sheet-body .sheet-rows [data-action="hub.open"] >> nth=0');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => /Account details/.test(document.querySelector('.modal-backdrop.sheet').textContent)), 'balance sheet: an account opens its details');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Goal cards: status, a monthly slider that moves the date, a linked savings account, saved per month.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/metas'); });
  await page.waitForTimeout(250);
  const gc1 = await page.evaluate(() => { const c = document.querySelectorAll('#goal-cards .goal-card'); return { n: c.length, goals: Store.state.goals.length, states: [...c].map(x => x.querySelector('[data-g="state"]').textContent.trim()), eta: c[0].querySelector('[data-g="eta"]').textContent }; });
  ok(gc1.n === gc1.goals && gc1.states.every(x => /On track|Behind|Reached|No date|Not funded/.test(x)) && /Ready in|reached|month/.test(gc1.eta), 'goals: one card per goal with a status', gc1);
  const gid = await page.evaluate(() => Number(document.querySelector('#goal-cards .goal-card').dataset.goal));
  const eta1 = await page.evaluate((id) => document.querySelector(`#goal-cards [data-goal="${id}"] [data-g="eta"]`).textContent, gid);
  await page.evaluate((id) => { const el = document.querySelector(`#goal-cards [data-goal="${id}"] [data-input="goal.slide"]`); el.max = 5000; el.value = 2000; el.dispatchEvent(new Event('input', { bubbles: true })); }, gid);
  await page.waitForTimeout(150);
  const gc2 = await page.evaluate((id) => ({ monthly: Store.state.goals.find(g => g.id === id).monthly, eta: document.querySelector(`#goal-cards [data-goal="${id}"] [data-g="eta"]`).textContent }), gid);
  ok(gc2.monthly === 2000 && gc2.eta !== eta1, 'goals: the monthly slider moves the date', { eta1, gc2 });
  await page.evaluate((id) => { const sav = Store.state.accounts.find(a => a.kind === 'ahorros'); const el = document.querySelector(`#goal-cards [data-goal="${id}"] [data-change="goal.link"]`); el.value = String(sav.id); el.dispatchEvent(new Event('change', { bubbles: true })); }, gid);
  await page.waitForTimeout(150);
  const gc3 = await page.evaluate((id) => { const g = Store.state.goals.find(x => x.id === id), a = Store.state.accounts.find(x => x.id === g.accountId); return { cur: g.current, bal: a && a.balance }; }, gid);
  ok(gc3.bal !== undefined && gc3.cur === Math.max(0, gc3.bal), 'goals: linked to a savings account, its balance is what is saved', gc3);
  ok(await page.evaluate(() => !!document.querySelector('#goal-cards [data-g="velocity"] svg')), 'goals: saved per month');
  // The monthly amount: the slider stops at your monthly income; any amount can be typed.
  const cap = await page.evaluate((id) => { const el = document.querySelector(`#goal-cards [data-goal="${id}"] [data-input="goal.slide"]`); el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); App.update(); const again = document.querySelector(`#goal-cards [data-goal="${id}"] [data-input="goal.slide"]`); return { max1: Number(el.max), max2: Number(again.max), income: App.buildContext().monthBudget.income, label: document.querySelector(`#goal-cards [data-goal="${id}"] [data-g="cap"]`).textContent }; }, gid);
  ok(cap.max1 === cap.max2 && cap.max1 >= cap.income && cap.max1 < cap.income + 50 && /monthly income/.test(cap.label), 'goals: the slider stops at your monthly income (it doesn\'t keep growing)', cap);
  await page.fill(`#goal-cards [data-goal="${gid}"] [data-change="goal.typeMonthly"]`, '1234.5');
  await page.dispatchEvent(`#goal-cards [data-goal="${gid}"] [data-change="goal.typeMonthly"]`, 'change');
  await page.waitForTimeout(150);
  ok(await page.evaluate((id) => Store.state.goals.find(g => g.id === id).monthly === 1234.5, gid), 'goals: the monthly amount can be typed');
  // Goals like the bank's: total a month, the timeline, Add a goal (savings / debt payoff /
  // retirement), Manage (savings top amount, debt extra and order, details), overbudget warning.
  await page.evaluate(() => { Store.reset('example'); Store.ui.gmStart = 0; App.changed({ structural: true }); App.go('futuro/metas', { focus: 'metas-goals' }); });
  await page.waitForTimeout(300);
  const gm1 = await page.evaluate(() => ({ total: document.getElementById('gm-total').textContent, dots: document.querySelectorAll('#gm-map .gm-dot').length, years: document.querySelectorAll('#gm-map .gm-year').length, slider: !!document.querySelector('[data-input="gm.scroll"]') }));
  ok(/\$/.test(gm1.total) && gm1.dots >= 3 && gm1.years >= 4 && gm1.slider, 'goals: total monthly contribution and the timeline with each goal', gm1);
  await page.click('[data-action="gm.add"]');
  await page.click('[data-action="gm.view"][data-view="kinds"]');
  await page.click('[data-action="gm.kind"][data-kind="emergency"]');
  await page.fill('#gm-target', '1000');
  await page.dispatchEvent('#gm-target', 'change');
  const sav0 = await page.evaluate(() => { const a = Store.state.accounts.find(x => x.kind === 'ahorros'); const el = document.getElementById('gm-account'); el.value = String(a.id); el.dispatchEvent(new Event('change', { bubbles: true })); return a.id; });
  ok(/\$[\d,]+ \/ \$1,000/.test(await page.textContent('#gm-body')), 'goals: the new goal shows saved / target from its account');
  await page.click('[data-action="gm.saveSaving"]');
  await page.waitForTimeout(200);
  const gNew = await page.evaluate(() => Store.state.goals.at(-1));
  ok(gNew.kind === 'emergency' && gNew.target === 1000 && gNew.accountId === sav0 && /Emergency fund/.test(gNew.name), 'goals: Savings → Emergency fund → amount and account → Save', gNew);
  // Debt payoff: pick which debts show on the timeline.
  await page.click('[data-action="gm.add"]');
  await page.click('[data-action="gm.view"][data-view="debts"]');
  const nTrack = await page.evaluate(() => document.querySelectorAll('[data-change="gm.track"]').length);
  await page.click('[data-change="gm.track"] >> nth=0');
  await page.waitForTimeout(150);
  ok(nTrack >= 2 && await page.evaluate(() => Store.state.debts.filter(d => d.track === false).length === 1), 'goals: Debt payoff → select debts to track', nTrack);
  await page.click('[data-change="gm.track"] >> nth=0');
  // Retirement: birthday, desired savings, the retirement accounts; 6% return.
  await page.click('[data-action="gm.view"][data-view="type"]');
  await page.click('[data-action="gm.view"][data-view="retire"]');
  await page.fill('#gm-bday', '1969-01-01'); await page.dispatchEvent('#gm-bday', 'change');
  await page.fill('#gm-rtarget', '500000'); await page.dispatchEvent('#gm-rtarget', 'change');
  ok(/Assumes a 6\.0% annual rate of return/.test(await page.textContent('#gm-body')) && /Current savings/.test(await page.textContent('#gm-body')), 'goals: Retirement asks birthday, desired savings and accounts');
  await page.click('[data-action="gm.saveRetire"]');
  await page.waitForTimeout(200);
  const ret = await page.evaluate(() => ({ r: Store.state.retirement, manage: document.getElementById('gm-body').textContent }));
  ok(ret.r.goalOn && ret.r.goalTarget === 500000 && ret.r.birthday === '1969-01-01' && /Manage goals/.test(ret.manage) && /Retirement/.test(ret.manage), 'goals: the retirement goal is saved and Manage lists it', ret.r.goalTarget);
  // Manage → Savings: the top goal's monthly amount.
  await page.click('[data-action="gm.view"][data-view="savings"]');
  await page.fill('#gm-top-sav', '250');
  await page.click('[data-action="gm.saveTopSav"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.state.goals.some(g => g.monthly === 250)) && /In progress/.test(await page.textContent('#gm-body')), 'goals: Manage → Savings sets the top goal\'s monthly amount');
  // Manage → Debt payoff: the extra goes to the first debt; the order menu; a debt's details.
  await page.click('[data-action="gm.view"][data-view="manage"]');
  await page.click('[data-action="gm.view"][data-view="debtPlan"]');
  await page.click('[data-action="gm.editExtra"]');
  await page.fill('#gm-extra', '100');
  await page.click('[data-action="gm.saveExtra"]');
  await page.waitForTimeout(150);
  const ex = await page.evaluate(() => { const plan = App.buildContext().debts, first = Store.state.debts.find(d => d.id === plan.items[0].id); return { extra: first.monthly - first.minPayment, others: Store.state.debts.filter(d => d !== first && d.balance > 0).every(d => d.monthly === d.minPayment), txt: document.getElementById('gm-body').textContent }; });
  ok(Math.abs(ex.extra - 100) < 0.01 && ex.others && /\$100/.test(ex.txt) && /Pay off/.test(ex.txt) && /Projected/.test(ex.txt), 'goals: the extra goes to the top debt and the dates move', ex.extra);
  await page.selectOption('[data-change="gm.order"]', 'avalanche');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.state.debtPlan.strategy === 'avalanche' && document.querySelector('[data-change="gm.order"]').value === 'avalanche'), 'goals: debts sorted by highest interest first');
  await page.selectOption('[data-change="gm.order"]', 'snowball');
  await page.click('#gm-body [data-action="gm.open"][data-type="debt"] >> nth=0');
  const gmDet = await page.textContent('#gm-body');
  ok(/Goal details/.test(gmDet) && /Minimum payment/.test(gmDet) && /Interest/.test(gmDet) && /Payment due/.test(gmDet) && /%/.test(gmDet), 'goals: a debt\'s goal details', gmDet.slice(0, 120));
  await page.click('[data-action="gm.menu"]');
  await page.click('[data-action="gm.remove"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.state.debts.some(d => d.track === false)), 'goals: … → Stop tracking a debt');
  // Overbudget: goals asking more than the budget has left.
  await page.evaluate(() => { Store.state.retirement.aporteMensual = 99999; App.changed({ structural: true }); });
  await page.click('[data-action="gm.view"][data-view="manage"]').catch(() => page.evaluate(() => GoalMap.open('manage')));
  await page.waitForTimeout(150);
  ok(/You've overbudgeted your goals/.test(await page.textContent('#gm-body')) && await page.evaluate(() => !document.getElementById('gm-badge').classList.contains('hidden')), 'goals: overbudget warning and the ! on Manage');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // The timeline: zoom 5Y / 10Y / 20Y / All; ‹ › move exactly one year; the slider is under the road.
  await page.evaluate(() => { Store.ui.gmSpan = null; Store.ui.gmStart = 0; App.update(); });
  const z = await page.evaluate(() => [...document.querySelectorAll('[data-action="gm.zoom"]')].map(b => b.dataset.span));
  ok(z.includes('5') && z.includes('all'), 'goals timeline: zoom buttons', z);
  await page.click('[data-action="gm.zoom"][data-span="5"]');
  await page.waitForTimeout(150);
  const tl0 = await page.evaluate(() => ({ label: document.getElementById('gm-range-label').textContent, max: Number(document.querySelector('.gm-range').max), w: document.querySelector('.gm-range').getBoundingClientRect().width, step: document.querySelector('.gm-step').getBoundingClientRect().width }));
  await page.click('[data-action="gm.step"][data-dir="1"]');
  await page.waitForTimeout(450);
  const tl1 = await page.evaluate(() => ({ start: Store.ui.gmStart, label: document.getElementById('gm-range-label').textContent, rebuilt: !document.querySelector('.gm-dot') }));
  const y = new Date().getFullYear();
  ok(tl0.label === `${y} – ${y + 5}` && tl1.start === 1 && tl1.label === `${y + 1} – ${y + 6}` && tl0.max > 1 && tl0.w > 150 && tl0.step >= 40, 'goals timeline: 5 years shown, › moves one year, big slider and buttons', { tl0, tl1 });
  // Slide to far-off goals; with no goals: Welcome to Goals.
  await page.evaluate(() => { const el = document.querySelector('[data-input="gm.scroll"]'); if (!el.disabled) { el.value = el.max; el.dispatchEvent(new Event('input', { bubbles: true })); } });
  ok(await page.evaluate(() => { const el = document.querySelector('[data-input="gm.scroll"]'); return el.disabled || Store.ui.gmStart === Number(el.max); }), 'goals: the slider moves the timeline to far-off goals');
  await page.evaluate(() => { Store.reset('empty'); App.changed({ structural: true }); App.go('futuro/metas'); });
  await page.waitForTimeout(200);
  ok(/Welcome to Goals!/.test(await page.textContent('#gm-map')), 'goals: with none yet, Welcome to Goals and Get started');
  // Cash flow calendar: Chart | Calendar; tap a day for its panel; add an expected transaction; repeating list.
  await page.evaluate(() => { Store.reset('example'); Store.ui.flowView = 'chart'; Store.ui.flowDay = null; Store.ui.flowDays = 30; App.changed({ structural: true }); App.go('resumen'); document.getElementById('dash-flow-card').open = true; });
  await page.waitForTimeout(250);
  await page.click('[data-action="flow.view"][data-view="calendar"]');
  await page.waitForTimeout(200);
  const fc = await page.evaluate(() => ({ cells: document.querySelectorAll('#flow-cal .flow-cell').length, chartHidden: document.getElementById('flow-chart-box').classList.contains('hidden'), repeat: document.querySelectorAll('#flow-repeat .acd-txn').length }));
  ok(fc.cells === 30 && fc.chartHidden && fc.repeat >= 1, 'cash flow calendar: a cell per day, repeating items listed', fc);
  const busy = await page.evaluate(() => { const c = [...document.querySelectorAll('#flow-cal .flow-cell')].find(x => x.querySelector('.flow-dots i')); return c && c.dataset.date; });
  await page.click(`#flow-cal .flow-cell[data-date="${busy}"]`);
  await page.waitForTimeout(150);
  const fd = await page.evaluate(() => document.getElementById('flow-day').textContent);
  ok(/Add expected transaction/.test(fd) && /[+−]\$/.test(fd), 'cash flow calendar: a day shows what comes in and goes out', fd.slice(0, 120));
  await page.click('[data-action="flow.addOn"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate((d) => document.getElementById('flow-date').value === d && document.activeElement === document.getElementById('flow-name'), busy), 'cash flow calendar: add an expected transaction on that day');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  await page.click('[data-action="flow.view"][data-view="chart"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !document.getElementById('flow-chart-box').classList.contains('hidden') && document.getElementById('flow-cal').classList.contains('hidden')), 'cash flow calendar: back to the chart');
  // Cash Flow like the bank's: intro pages, current cash, accounts picker, the month's events with
  // paid / past due / upcoming, and Suggested events with the Occurs… / Starting… picker.
  await page.evaluate(() => { Store.reset('example'); Store.state.settings.flowIntroSeen = false; Store.ui.flowIntro = 0; Store.ui.flowView = 'chart'; App.changed({ structural: true }); App.go('resumen'); document.getElementById('dash-flow-card').open = true; });
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => /Your cash: past, present and future/.test(document.getElementById('flow-intro').textContent) && document.getElementById('flow-main').classList.contains('hidden')), 'cash flow: the first visit shows the intro');
  await page.click('[data-action="flow.introNext"]');
  ok(/Forecast your cash flow/.test(await page.textContent('#flow-intro')), 'cash flow intro: Next');
  await page.click('[data-action="flow.introNext"]');
  await page.click('[data-action="flow.introDone"]');
  await page.waitForTimeout(250);
  ok(await page.evaluate(() => Store.state.settings.flowIntroSeen && !!document.getElementById('cev-body') && !document.getElementById('flow-main').classList.contains('hidden')), 'cash flow intro: Get started opens Add a cash event');
  const cevSug = await page.evaluate(() => ({ cards: document.querySelectorAll('#cev-body .cev-card').length, txt: document.getElementById('cev-body').textContent, recurring: (Store.state.recurring || []).map(r => r.description) }));
  ok(cevSug.cards >= 2 && /Last occurred/.test(cevSug.txt) && !cevSug.recurring.some(n => cevSug.txt.includes(n + 'Video')), 'cash events: suggestions from repeating payees', cevSug.cards);
  const sugName = await page.evaluate(() => document.querySelector('#cev-body .cev-card .font-bold').textContent);
  await page.click('[data-action="cev.accept"] >> nth=0');
  const fq = await page.evaluate(() => ({ opts: [...document.querySelectorAll('[data-action="cev.freq"]')].map(b => b.textContent.trim()), start: document.getElementById('cev-start').value }));
  ok(fq.opts.length === 7 && /No repeat/.test(fq.opts[0]) && /Monthly \(on the \d+(st|nd|rd|th)\)/.test(fq.opts[3]) && /Monthly \(on the \d(st|nd|rd|th) \w+day\)/.test(fq.opts[4]) && fq.start > new Date().toISOString().slice(0, 10), 'cash events: Occurs… names the day; Starting… after today', fq);
  await page.click('[data-action="cev.freq"][data-freq="monthly"]');
  await page.click('[data-action="cev.create"]');
  await page.waitForTimeout(200);
  const made = await page.evaluate((n) => ({ ev: Store.state.cashEvents.find(e => e.name === n), created: !!document.querySelector('#cev-body .cev-card.is-created') }), sugName);
  ok(made.ev && made.ev.frequency === 'monthly' && made.created, 'cash events: Create makes a monthly event and the card says Created', made);
  await page.click('[data-action="cev.dismiss"] >> nth=0');
  ok(await page.evaluate(() => (Store.state.settings.dismissedEvents || []).length === 1), 'cash events: ✗ hides a suggestion');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  const fm = await page.evaluate(() => ({ head: document.querySelector('#flow-month .fm-head').textContent, paid: document.querySelectorAll('#flow-month .fm-row.is-paid').length, up: document.querySelectorAll('#flow-month .fm-row.is-upcoming').length, cash: document.getElementById('flow-cash').textContent, label: document.getElementById('flow-accts-label').textContent }));
  ok(/\d{4}/.test(fm.head) && fm.paid + fm.up >= 3 && /Current cash available/.test(fm.cash) && /\d+ accounts?/.test(fm.label), 'cash flow: current cash, accounts and the month\'s events with their status', fm);
  // Untick an account: current cash changes.
  const cash0 = await page.evaluate(() => Engine.cashNow(Store.state.accounts.filter(a => !a.kind || a.kind === 'corriente' || a.kind === 'efectivo'), Store.state.transactions, new Date()).total);
  await page.click('[data-action="flow.accounts"]');
  const nAcc = await page.evaluate(() => document.querySelectorAll('[data-change="flow.acct"]').length);
  await page.click('[data-change="flow.acct"] >> nth=0');
  await page.waitForTimeout(200);
  const cash1 = await page.evaluate(() => ({ ex: Store.state.settings.flowExclude.length, label: document.getElementById('flow-accts-label').textContent, txt: document.getElementById('flow-cash').textContent }));
  ok(nAcc >= 1 && cash1.ex === 1 && cash1.label.startsWith(String(nAcc - 1)), 'cash flow: unticking an account leaves it out', { nAcc, cash1, cash0 });
  await page.click('[data-change="flow.acctAll"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => Store.state.settings.flowExclude.length === 0), 'cash flow: All ticks them all again');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  // Alerts: the bell's count, the inbox, open one, dismiss one (it doesn't come back).
  await page.evaluate(() => { Store.reset('example'); const s = Store.state; s.transactions.push({ id: 990001, date: Engine.isoDate(new Date()), type: 'Gasto', parentCategory: 'Entretenimiento y Ocio', category: '', description: 'Big screen TV', amount: 1899 }); App.changed({ structural: true }); App.go('resumen'); });
  await page.waitForTimeout(300);
  const al1 = await page.evaluate(() => ({ badge: document.getElementById('alerts-badge').textContent, keys: Tools.alerts().map(a => a.key) }));
  ok(al1.keys.includes('big-990001') && al1.badge === String(al1.keys.length), 'alerts: the bell counts what needs a look', al1);
  await page.click('[data-action="tools.alerts"]');
  await page.waitForTimeout(200);
  const alertRows = await page.$$eval('.alert-row', r => r.map(x => x.textContent.trim()));
  ok(alertRows.length === al1.keys.length && alertRows.some(r => /Big screen TV/.test(r) && /your usual/.test(r)), 'alerts: the inbox explains each one', alertRows);
  const bigIdx = al1.keys.indexOf('big-990001');
  await page.click(`[data-action="tools.alertDismiss"][data-i="${bigIdx}"]`);
  await page.waitForTimeout(150);
  const al2 = await page.evaluate(() => ({ badge: document.getElementById('alerts-badge').textContent, keys: Tools.alerts().map(a => a.key), saved: !!Store.state.settings.alertsDismissed['big-990001'] }));
  ok(!al2.keys.includes('big-990001') && al2.saved && al2.keys.length === al1.keys.length - 1, 'alerts: dismissed for good', al2);
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  if (al2.keys.length) {
    await page.click('[data-action="tools.alerts"]');
    await page.click('[data-action="tools.alertGo"] >> nth=0');
    await page.waitForTimeout(250);
    ok(await page.evaluate(() => !document.querySelector('.alert-row')), 'alerts: tapping one goes to it');
    await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  }
  // Account types: Roth IRA, HSA, jewelry and a mortgage, each in its group; change a type in details.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('patrimonio'); });
  await page.waitForTimeout(250);
  const addAcct = async (type, name, bal) => { await page.click('[data-action="hub.add"]'); await page.waitForTimeout(100); await page.selectOption('#hub-new-type', type); await page.fill('#hub-new-name', name); await page.fill('#hub-new-bal', String(bal)); await page.click('[data-action="hub.save"]'); await page.waitForTimeout(200); };
  const netStart = await page.evaluate(() => AccountsHub.last.net);
  await addAcct('acct:retiro:roth-ira', 'My Roth', 7000);
  await addAcct('acct:retiro:hsa', 'Health saver', 1500);
  await page.click('[data-action="hub.add"]'); await page.waitForTimeout(100);
  await page.evaluate(() => { const el = document.getElementById('hub-new-type'); el.value = 'asset:' + Engine.ASSET_CATEGORIES[2]; el.dispatchEvent(new Event('change', { bubbles: true })); });
  await page.fill('#hub-new-name', 'Grandma ring'); await page.fill('#hub-new-bal', '2500'); await page.click('[data-action="hub.save"]'); await page.waitForTimeout(200);
  await addAcct('acct:hipoteca', 'Cabin mortgage', 90000);
  const types = await page.evaluate(() => ({ ret: document.getElementById('hub-retirement').textContent, health: document.getElementById('hub-health').textContent, val: document.getElementById('hub-valuables').textContent, mort: document.getElementById('hub-mortgage').textContent, net: AccountsHub.last.net, sections: [...document.querySelectorAll('#hub-body .hub-section')].map(x => x.textContent.replace(/\s+/g, ' ').trim().split('$')[0]) }));
  ok(/My Roth/.test(types.ret) && /Roth IRA/.test(types.ret) && /Health saver/.test(types.health) && /HSA/.test(types.health) && /Grandma ring/.test(types.val) && /Jewelry/.test(types.val) && /Cabin mortgage/.test(types.mort) && /257,303/.test(types.mort)
    && Math.round(types.net - netStart) === 7000 + 1500 + 2500 - 90000 && types.sections.join('|') === 'Cash & bank|Investments & retirement|Property|Debts', 'account types: each in its group, net worth follows', types);
  await page.evaluate(() => { const a = Store.state.accounts.find(x => x.name === 'Health saver'); AccountsHub.openDetails('account', a.id); });
  await page.click('[data-action="acd.tab"][data-tab="details"]');
  await page.selectOption('.acd-fields [data-field="kind"]', 'acct:retiro:fsa');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => { const a = Store.state.accounts.find(x => x.name === 'Health saver'); return a.kind === 'retiro' && a.subtype === 'fsa' && /FSA/.test(document.getElementById('hub-health').textContent); }), 'account types: change the type in its details');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop.sheet').forEach(m => m.remove()));
  const bsec = await page.evaluate(() => [...document.querySelectorAll('#nw-sheet-body .sheet-section')].map(x => x.textContent.replace(/\s+/g, ' ').trim().split('$')[0]));
  ok(bsec.join('|') === 'Cash & bank|Investments & retirement|Property', 'balance sheet: sections with subtotals', bsec);
  // Trends like the bank's: tap a band → its months; tap again → the category with its subcategories
  // (← back); tap a subcategory twice → its transactions that month in a sheet (← back to the chart).
  await page.evaluate(() => { Store.reset('example'); Store.ui.trends = { months: 6, category: '', account: '' }; App.changed({ structural: true }); App.go('transacciones/reportes'); });
  await page.waitForTimeout(300);
  const tapBand = async (name, i) => {
    const pt = await page.evaluate(([name, i]) => { const ch = UI.chartInstance('trends-chart'); const k = ch.data.datasets.findIndex(d => d.label === name); const top = ch.getDatasetMeta(k).data[i].y, bottom = k ? ch.getDatasetMeta(k - 1).data[i].y : ch.scales.y.getPixelForValue(0); const r = ch.canvas.getBoundingClientRect(); return { x: r.x + ch.getDatasetMeta(k).data[i].x, y: r.y + (top + bottom) / 2 }; }, [name, i]);
    await page.mouse.click(pt.x, pt.y); await page.waitForTimeout(250);
  };
  await page.evaluate(() => document.getElementById('trends-chart').scrollIntoView({ block: 'center' }));
  ok(await page.evaluate(() => getComputedStyle(document.getElementById('trends-back')).display === 'none'), 'trends: no back arrow at the top level');
  await tapBand('Food', 3);
  const tb1 = await page.evaluate(() => ({ focus: Store.ui.trends.focus, card: document.getElementById('trends-focus').textContent.replace(/\s+/g, ' '), months: document.querySelectorAll('#trends-focus .trend-months > div').length }));
  ok(tb1.focus === 'Alimentación' && /Food/.test(tb1.card) && tb1.months === 6 && /Open Food/.test(tb1.card), 'trends: tapping a band shows its months', tb1);
  await page.evaluate(() => document.getElementById('trends-chart').scrollIntoView({ block: 'center' }));
  await tapBand('Food', 3);
  const tb2 = await page.evaluate(() => ({ cat: Store.ui.trends.category, sets: UI.chartInstance('trends-chart').data.datasets.map(d => d.label), back: getComputedStyle(document.getElementById('trends-back')).display !== 'none' }));
  ok(tb2.cat === 'Alimentación' && tb2.sets.includes('Groceries') && !tb2.sets.includes('Income') && tb2.back, 'trends: tapping it again opens the category with its subcategories', tb2);
  await page.evaluate(() => document.getElementById('trends-chart').scrollIntoView({ block: 'center' }));
  await tapBand('Groceries', 3);
  await page.evaluate(() => document.getElementById('trends-chart').scrollIntoView({ block: 'center' }));
  await tapBand('Groceries', 3);
  const tb3 = await page.evaluate(() => { const m = document.querySelector('.modal-backdrop.sheet'); return m && { title: m.querySelector('.modal-title').textContent, rows: m.querySelectorAll('.acd-txn').length, head: m.querySelector('strong').textContent, end: /End of the list/.test(m.textContent) }; });
  ok(tb3 && /Transactions/.test(tb3.title) && tb3.rows >= 1 && /Groceries/.test(tb3.head) && tb3.end, 'trends: a subcategory opens its transactions that month', tb3);
  await page.click('[data-action="trends.txnsBack"]');
  await page.waitForTimeout(150);
  ok(await page.evaluate(() => !document.querySelector('.modal-backdrop.sheet') && Store.ui.trends.category === 'Alimentación'), 'trends: ← goes back to the chart');
  await page.click('#trends-back');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Store.ui.trends.category && UI.chartInstance('trends-chart').data.datasets.some(d => d.label === 'Income')), 'trends: ← back to all categories');
  await page.evaluate(() => document.getElementById('trends-chart').scrollIntoView({ block: 'center' }));
  const ip = await page.evaluate(() => { const ch = UI.chartInstance('trends-chart'), p = ch.getDatasetMeta(ch.data.datasets.length - 1).data[2], r = ch.canvas.getBoundingClientRect(); return { x: r.x + p.x, y: r.y + p.y }; });
  await page.mouse.click(ip.x, ip.y);
  await page.waitForTimeout(200);
  const tbi = await page.evaluate(() => ({ focus: Store.ui.trends.focus, card: document.getElementById('trends-focus').textContent.replace(/\s+/g, ' ') }));
  ok(tbi.focus === '__income' && /Income/.test(tbi.card) && !/Open/.test(tbi.card), 'trends: tapping the income line shows its months', tbi);
  // First-run setup guide: one sheet, five short steps, opened again from Settings.
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); });
  await go(page, 'config');
  await page.click('[data-action="setup.open"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="setup.start"]');
  await page.waitForTimeout(150);
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Store.state.settings.sample && Store.state.transactions.length === 0), 'setup: the example makes way for an empty plan');
  await page.fill('#su-names', 'Ana, Luis');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(100);
  // The pay step says whose paycheck it is (one person's, before taxes) and asks the others' take-home pay.
  const pay1 = await page.evaluate(() => ({ txt: document.querySelector('.modal-backdrop:not(.hidden) .sheet-body').innerText, who: document.getElementById('su-earner').selectedOptions[0].textContent, luis: Store.state.members.find(m => m.name === 'Luis').id, step: document.querySelector('.su-progress').textContent }));
  ok(/Main paycheck:\s*Ana/.test(pay1.txt) && pay1.who === 'Ana' && /Whose paycheck is this\?/i.test(pay1.txt) && /Luis · Pay before taxes, a month/i.test(pay1.txt) && /Step 2 of 5/.test(pay1.step), 'setup: the pay step names whose paycheck it is and asks the others\' pay before taxes', pay1);
  // Switching the person keeps what was typed; the heading and the other person's box follow.
  await page.fill('#su-gross', '5000');
  await page.selectOption('#su-earner', String(pay1.luis));
  await page.waitForTimeout(100);
  const pay2 = await page.evaluate(() => ({ txt: document.querySelector('.modal-backdrop:not(.hidden) .sheet-body').innerText, gross: document.getElementById('su-gross').value }));
  ok(/Main paycheck:\s*Luis/.test(pay2.txt) && /Ana · Pay before taxes, a month/i.test(pay2.txt) && pay2.gross === '5000', 'setup: picking another person keeps what was typed', pay2);
  await page.selectOption('#su-earner', String(await page.evaluate(() => Store.state.members.find(m => m.name === 'Ana').id)));
  await page.waitForTimeout(100);
  await page.fill(`#su-other-${pay1.luis}`, '2100');
  await page.selectOption('#su-type', 'hourly');
  await page.waitForTimeout(100);
  await page.fill('#su-rate', '25');
  await page.fill('#su-hours', '40');
  await page.selectOption('#su-freq', 'biweekly');
  await page.fill('#su-next', '2026-10-16');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(100);
  await page.fill('#su-checking', '1200');
  await page.fill('#su-card', '800');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(100);
  await page.fill('.su-bill >> nth=0', '1100');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(100);
  await page.fill('#su-d0-name', 'Visa');
  await page.fill('#su-d0-bal', '800');
  await page.fill('#su-d0-rate', '24');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(150);
  const su = await page.evaluate(() => { const s = Store.state, y = Store.active(); return { names: s.members.map(m => m.name).join(','), type: y.payType, rate: y.hourly && y.hourly.rate, sueldo: y.sueldo, sched: s.settings.paySchedule, accts: s.accounts.map(a => a.kind + ':' + a.balance + ':' + (a.debtId || '')).join(','), bill: y.budgetBase.filter(i => !i.link)[0].prep, debt: s.debts.map(d => d.name + ':' + d.kind + ':' + d.minPayment).join(','), seen: s.settings.setupSeen, other: (y.otherIncomes || []).map(l => l.name + ':' + (l.pay && l.pay.sueldo) + ':' + (l.memberId === s.members[1].id) + ':' + (l.amount > 1000 && l.amount < 2100)).join(',') }; });
  ok(su.names === 'Ana,Luis' && su.type === 'hourly' && su.rate === 25 && Math.round(su.sueldo) === 4333 && su.sched.interval === 2 && su.sched.anchor === '2026-10-16'
    && su.accts === 'corriente:1200:,tarjeta:-800:1' && su.bill === 1100 && su.debt === 'Visa:tarjeta:25' && !su.seen && su.other === 'Luis (paycheck):2100:true:true', 'setup: each step saves what it asked (Ana\'s paycheck; Luis\'s pay before taxes as his own paycheck, its take-home after taxes)', su);
  ok(/Your plan is set up/.test(await page.textContent('.modal-backdrop:not(.hidden)')), 'setup: done screen');
  await page.click('[data-action="setup.close"]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => Store.state.settings.setupSeen && Store.ui.tab === 'presupuesto' && !document.querySelector('.modal-backdrop:not(.hidden)')), 'setup: closing marks it seen and goes to the budget');
  // Walking through again keeps your data: no example offer, the checking balance is updated, not doubled.
  await page.evaluate(() => UI.run('setup.open', {}));
  await page.waitForTimeout(150);
  ok(!(await page.$('[data-action="setup.example"]')), 'setup: no example offer over your own data');
  await page.click('[data-action="setup.start"]');
  await page.waitForTimeout(150);
  await page.click('[data-action="setup.skip"]');
  await page.click('[data-action="setup.skip"]');
  await page.waitForTimeout(100);
  await page.fill('#su-checking', '1500');
  await page.click('[data-action="setup.next"]');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => Store.state.accounts.filter(a => a.kind === 'corriente').map(a => a.balance).join()) === '1500', 'setup: second walk updates the account');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  // A fresh install opens it by itself, once.
  const fresh = await page.evaluate(() => { Store.reset('empty'); Store.state.settings.welcomeDismissed = false; Setup.maybeOpen(); const a = !!document.querySelector('.modal-backdrop:not(.hidden) [data-action="setup.start"]'); Store.state.settings.setupSeen = true; return a; });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(150);
  ok(fresh && await page.evaluate(() => { const n = document.querySelectorAll('.modal-backdrop:not(.hidden)').length; Setup.maybeOpen(); return n === 0 && document.querySelectorAll('.modal-backdrop:not(.hidden)').length === 0; }), 'setup: opens on a fresh install, not after');
  // Salary schedule confirmation in English.
  await page.evaluate(() => { Store.reset('empty'); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.evaluate(() => { UI.run('pay.edit', {}); });
  await page.waitForTimeout(150);
  await page.evaluate(() => { UI.run('pay.save', {}); });
  await page.waitForTimeout(200);
  const payToast = await page.evaluate(() => [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|'));
  ok(/Saved: On the 15th and 30th, every month/.test(payToast) && /On the 15th and 30th/.test(await page.textContent('#pay-summary')), 'pay schedule saved message and summary in English', payToast);
  // PIN lock screen in English.
  await page.evaluate(() => Device.setPin('1234'));
  await lockAndWait(page, () => { Device.lockNow(); });
  const lockTxt = await page.textContent('#lock-screen');
  await page.fill('#lock-pin', '9999');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForTimeout(400);
  const wrong = await page.textContent('#lock-msg');
  ok(/Type your PIN to get in/.test(lockTxt) && /ZeroDebtPlan/.test(lockTxt) && /Wrong PIN\. Tries left before a 30-second wait: 4/.test(wrong), 'PIN screen and its messages in English', [lockTxt, wrong]);
  await page.fill('#lock-pin', '1234');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForTimeout(400);
  ok(!(await page.$('#lock-screen')) && await page.evaluate(() => I18n.lang) === 'en' && /Overview|Budget/.test(await page.textContent('#main-nav')), 'unlocking keeps the app in English');
  await page.evaluate(() => Device.removePin());
  // With a PIN the plan is saved encrypted: nothing readable on the device; after a reload the app
  // waits for the PIN, then the plan is back; removing the PIN saves it readable again.
  await page.evaluate(async () => { Store.reset('example'); App.changed({ structural: true }); Store.saveNow(); await Device.setPin('4321'); await new Promise(r => setTimeout(r, 300)); });
  const encKey = await page.evaluate(() => Store.KEY);
  const enc1 = await page.evaluate((k) => { const v = localStorage.getItem(k), p = Store.state.transactions[0].description; return { enc: v.startsWith('zdpenc1:'), leak: v.includes(p) || v.includes('"transactions"'), n: Store.state.transactions.length, wrap: !!Device.read().lock.wrap }; }, encKey);
  ok(enc1.enc && !enc1.leak && enc1.wrap, 'with a PIN the plan is encrypted on the device (nothing readable)', enc1);
  await page.reload();
  await page.waitForTimeout(600);
  const locked = await page.evaluate(() => ({ lock: !!document.getElementById('lock-screen'), started: !!(window.Store && Store.state) }));
  ok(locked.lock && !locked.started, 'after a reload the plan is not even read until the PIN', locked);
  await page.fill('#lock-pin', '4321');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForTimeout(1500);
  const opened = await page.evaluate((k) => ({ n: Store.state && Store.state.transactions.length, lock: !!document.getElementById('lock-screen'), enc: localStorage.getItem(k).startsWith('zdpenc1:') }), encKey);
  ok(opened.n === enc1.n && !opened.lock && opened.enc, 'the right PIN opens the plan; it stays encrypted on the device', opened);
  await page.evaluate(async () => { Store.state.transactions[0].memo = 'after unlock'; App.changed({ structural: true }); Store.saveNow(); await new Promise(r => setTimeout(r, 300)); });
  ok(await page.evaluate((k) => { const v = localStorage.getItem(k); return v.startsWith('zdpenc1:') && !v.includes('after unlock'); }, encKey), 'changes are saved encrypted too');
  await page.evaluate(() => Device.removePin());
  await page.waitForTimeout(200);
  ok(await page.evaluate((k) => { const v = localStorage.getItem(k); return !v.startsWith('zdpenc1:') && v.includes('after unlock'); }, encKey), 'removing the PIN saves the plan readable again');
  // A passcode (letters too) instead of a PIN; the lock screen asks for it with a normal keyboard.
  await page.evaluate(() => App.go('config'));
  await page.click('#cfg-lock [data-action="device.setPin"]');
  await page.fill('.modal input[name="pin"]', 'short');
  await page.fill('.modal input[name="again"]', 'short');
  await page.click('.modal [data-dialog-ok]');
  ok(/at least 8 characters/.test(await page.textContent('.modal .modal-error')), 'a passcode needs 8 or more characters');
  await page.fill('.modal input[name="pin"]', 'Maple-tree 77');
  await page.fill('.modal input[name="again"]', 'Maple-tree 77');
  await page.click('.modal [data-dialog-ok]');
  await page.waitForTimeout(1200);
  ok(await page.evaluate(() => Device.isPasscode() && /passcode/.test(document.getElementById('cfg-lock').textContent)), 'passcode saved (the lock says so)');
  await lockAndWait(page, () => { Device.lockNow(); });
  const pcIn = await page.evaluate(() => { const i = document.getElementById('lock-pin'); return { mode: i.getAttribute('inputmode'), label: i.getAttribute('aria-label'), sub: document.querySelector('.lock-sub').textContent }; });
  ok(!pcIn.mode && pcIn.label === 'Passcode' && /passcode/.test(pcIn.sub), 'the lock asks for the passcode with a full keyboard', pcIn);
  await page.fill('#lock-pin', 'Maple-tree 77');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForTimeout(1200);
  ok(!(await page.$('#lock-screen')), 'the passcode unlocks');
  await page.evaluate(() => Device.removePin());
  // The PIN against the browser's developer tools (someone with the device, not the PIN).
  await page.evaluate(async () => { Store.reset('example'); App.changed({ structural: true }); Store.saveNow(); await Device.setPin('2580'); await new Promise(r => setTimeout(r, 300)); });
  const devKey = await page.evaluate(() => Store.KEY);
  const secret = await page.evaluate(() => Store.state.transactions.map(t => t.description).find(d => d && d.length > 8));
  const nTx = await page.evaluate(() => Store.state.transactions.length);
  // Coming back after 5 minutes away (or "Lock now") starts the page over: the plan isn't in memory.
  await lockAndWait(page, () => { Device.lockNow(); });
  const behind = await page.evaluate((secret) => {
    document.getElementById('lock-screen').remove();
    document.documentElement.classList.remove('app-locked', 'app-covered');
    return { state: !!(window.Store && Store.state), shown: document.body.innerText.includes(secret), stored: localStorage.getItem(Store.KEY).startsWith('zdpenc1:') && !localStorage.getItem(Store.KEY).includes(secret) };
  }, secret);
  ok(!behind.state && !behind.shown && behind.stored, 'dev tools: deleting the lock screen shows nothing of the plan (it is not even open)', behind);
  const tricks = await page.evaluate(async (secret) => {
    const out = {};
    try { App.init(); } catch (e) { /* listeners twice: fine for this check */ }
    out.init = !!Store.state;                                   // the app still waits for the PIN
    out.remove = Device.removePin();                            // refused while locked
    out.setPin = await Device.setPin('1111');                   // refused while locked
    out.hasPin = Device.hasPin();
    Store.init(localStorage);                                   // the store started by hand
    Store.state.transactions = []; Store.saveNow();
    out.storeShows = JSON.stringify(Store.state).includes(secret);
    out.kept = localStorage.getItem(Store.KEY).startsWith('zdpenc1:');  // it didn't write over the encrypted plan
    return out;
  }, secret);
  ok(!tricks.init && tricks.remove === false && tricks.setPin === false && tricks.hasPin && !tricks.storeShows && tricks.kept, 'dev tools: starting the app or the store, removing or changing the PIN from the console: refused, nothing shown, nothing overwritten', tricks);
  await page.reload();
  await page.waitForSelector('#lock-screen');
  await page.fill('#lock-pin', '2580');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForFunction(() => window.Store && Store.state && !document.getElementById('lock-screen'), null, { timeout: 8000 });
  ok(await page.evaluate((n) => Store.state.transactions.length === n, nTx), 'after all that the right PIN still opens the whole plan');
  // Deleting the lock (and its key) from storage doesn't open anything: the plan stays encrypted.
  await page.evaluate(() => { const d = Device.read(); window.__lock = d.lock; delete d.lock; localStorage.setItem(Device.KEY, JSON.stringify(d)); });
  const savedLock = await page.evaluate(() => window.__lock);
  await page.reload();
  await page.waitForTimeout(600);
  const noLock = await page.evaluate((secret) => ({ lost: /Your plan is locked/.test((document.getElementById('lock-screen') || {}).textContent || ''), state: !!(window.Store && Store.state), shown: document.body.innerText.includes(secret), enc: localStorage.getItem(Store.KEY).startsWith('zdpenc1:') }), secret);
  ok(noLock.lost && !noLock.state && !noLock.shown && noLock.enc, 'dev tools: deleting the PIN from storage only shows "Your plan is locked"; the plan stays encrypted', noLock);
  await page.evaluate((lock) => { const d = Device.read(); d.lock = lock; localStorage.setItem(Device.KEY, JSON.stringify(d)); }, savedLock);
  await page.reload();
  await page.waitForSelector('#lock-screen');
  await page.fill('#lock-pin', '2580');
  await page.click('#lock-screen button[type="submit"]');
  await page.waitForFunction(() => window.Store && Store.state && !document.getElementById('lock-screen'), null, { timeout: 8000 });
  ok(await page.evaluate((n) => Store.state.transactions.length === n, nTx), 'with the lock put back, the PIN opens the plan again');
  // Away from the app: covered at once, so the plan doesn't flash when coming back.
  const cover = await page.evaluate(() => {
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => true });
    document.dispatchEvent(new Event('visibilitychange'));
    const away = document.documentElement.classList.contains('app-covered');
    Object.defineProperty(document, 'hidden', { configurable: true, get: () => false });
    document.dispatchEvent(new Event('visibilitychange'));
    return { away, back: document.documentElement.classList.contains('app-covered') };
  });
  ok(cover.away && !cover.back, 'leaving the app covers it at once; back within 5 minutes it opens as it was', cover);
  await page.evaluate(() => { delete document.hidden; Device.removePin(); });
  // Hide amounts: every amount shows as •••; the plan itself doesn't change.
  await page.evaluate(() => App.go('resumen'));
  await page.click('#privacy-toggle');
  await page.waitForTimeout(200);
  const hid = await page.evaluate(() => ({ dots: (document.querySelector('[data-tab="resumen"]').innerText.match(/\$•••/g) || []).length, digits: (document.querySelector('[data-tab="resumen"]').innerText.match(/\$[1-9][\d,.]*/g) || []).slice(0, 5), pressed: document.getElementById('privacy-toggle').getAttribute('aria-pressed'), backup: /•••/.test(Store.serialize()) }));
    ok(hid.dots > 5 && !hid.digits.length && hid.pressed === 'true' && !hid.backup, 'hide amounts: every amount shows as ••• (the data is untouched)', hid);
  await page.click('#privacy-toggle');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => /\$[1-9]/.test(document.querySelector('[data-tab="resumen"]').innerText) && !Device.hidden()), 'hide amounts: off again');
  // 10 wrong PINs erase everything this app keeps on the device (the count survives a reload).
  await page.evaluate(async () => { await Device.setPin('1234'); Store.saveNow(); });
  await lockAndWait(page, () => { Device.lockNow(); });
  const pinKey = await page.evaluate(() => Store.KEY);
  const wrongPin = async () => { await page.fill('#lock-pin', '0000'); await page.click('#lock-screen button[type="submit"]'); await page.waitForTimeout(350); };
  for (let k = 0; k < 4; k++) await wrongPin();
  ok(await page.evaluate(() => Device.read().lock.fails) === 4, 'wrong PINs are counted on the device');
  await wrongPin();
  const waitMsg = await page.textContent('#lock-msg');
  ok(/Tries left before everything on this device is erased: 5/.test(waitMsg) && /Wait 30 seconds/.test(waitMsg), 'after 5 wrong PINs: a 30-second wait and a warning', waitMsg);
  await wrongPin();
  ok(/Too many tries\. Wait \d+ seconds/.test(await page.textContent('#lock-msg')) && await page.evaluate(() => Device.read().lock.fails) === 5, 'during the wait a PIN is not even checked');
  // Skip the waits (as if 30 seconds passed each time) and use up the rest.
  for (let k = 0; k < 4; k++) { await page.evaluate(() => { const d = Device.read(); d.lock.waitUntil = 0; localStorage.setItem(Device.KEY, JSON.stringify(d)); }); await wrongPin(); }
  ok(await page.evaluate(() => Device.read().lock.fails) === 9 && !!(await page.evaluate((k) => localStorage.getItem(k), pinKey)), 'nine wrong PINs: the data is still there');
  await page.evaluate(() => { const d = Device.read(); d.lock.waitUntil = 0; localStorage.setItem(Device.KEY, JSON.stringify(d)); window.__noReloadCheck = 1; });
  await page.fill('#lock-pin', '0000');
  await Promise.all([page.waitForEvent('load', { timeout: 8000 }).catch(() => null), page.click('#lock-screen button[type="submit"]')]);
  await page.waitForTimeout(600);
  const wiped = await page.evaluate((k) => ({ data: localStorage.getItem(k), dev: localStorage.getItem(Device.KEY), pin: Device.hasPin(), lock: !!document.getElementById('lock-screen') }), pinKey);
  ok(!wiped.pin && !wiped.lock && (!wiped.data || !JSON.parse(wiped.data).transactions.length), 'the 10th wrong PIN erases the data and the PIN, and the app starts empty', wiped);
  ok(errors.length === 0, 'no console errors', errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
