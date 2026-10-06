// Ecuador edition (Spanish) end-to-end checks.
const { openApp, ROOT, OUT } = require('./harness');
const fs = require('fs');
let pass = 0, fail = 0;
const ok = (cond, name, extra) => { if (cond) { pass++; } else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); } };

async function typeInto(page, selector, text) {
  const el = page.locator(selector).first();
  await el.click();
  await el.fill('');
  for (const ch of text) await page.keyboard.type(ch, { delay: 15 });
}
const focusedMatches = (page, selector) => page.evaluate(sel => document.activeElement === document.querySelector(sel), selector);
const text = (page, id) => page.evaluate(id => document.getElementById(id).textContent.trim(), id);
// Transactions open on the history with the full form folded: tests that use the form open it.
const go = (page, k) => page.evaluate(k => { App.go(k); const f = document.getElementById('txn-form-card'); if (f && /transacciones/.test(k)) f.open = true; if (k === 'config') document.querySelectorAll('[data-tab=config] details').forEach(d => { d.open = true; }); }, k);

(async () => {
  const { browser, context, page, errors } = await openApp({ styled: true });
  await page.evaluate(() => { window.__noReload = true; });
  page.on('load', () => console.log('PAGE LOAD EVENT'));

  // ---- first visit: an empty plan, or the example family
  ok(await page.evaluate(() => Store.state.transactions.length === 0 && Store.state.debts.length === 0 && Store.state.polizas.length === 0), 'a first visit starts with an empty plan');
  ok((await text(page, 'dash-welcome')).includes('Explorar el ejemplo') && (await text(page, 'dash-welcome')).includes('Empezar con mis datos'), 'welcome offers both ways to start');
  await page.click('#dash-welcome [data-action="app.loadExample"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Store.state.settings.sample && Store.state.transactions.length > 800 && Store.state.debts.length >= 3), 'Explorar el ejemplo loads a year of the example family', await page.evaluate(() => Store.state.transactions.length));
  ok(await page.isVisible('#sample-banner') && errors.length === 0, 'a banner says it is an example', errors);
  await page.click('#sample-banner [data-action="app.startOwn"]');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => !Store.state.settings.sample && Store.state.transactions.length === 0 && Store.ui.tab === 'presupuesto') && await page.isHidden('#sample-banner'), '"Empezar con mis datos" leaves the example for an empty plan');
  // The rest of the checks use the small starter data.
  await page.evaluate(() => { Store.reset('starter'); Store.state.settings.welcomeDismissed = false; App.commitHistory(); App.go('resumen'); });

  // ---- boot & nav
  const nav = await page.$$eval('#main-nav .nav-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(nav.length === 5 && nav[0].includes('Resumen') && nav[3].includes('Futuro') && !nav.some(n => n.includes('Configuración')), 'nav has 5 tabs; settings is the gear', nav);
  ok(await page.isVisible('#cfg-gear'), 'settings gear in the header');
  ok((await text(page, 'dash-hero')).includes('Paso 2'), 'dashboard hero shows baby step 2 for sample data');
  ok(!(await page.getAttribute('#dash-welcome', 'class')).includes('hidden'), 'welcome guide shows on first use');
  ok((await text(page, 'dash-welcome')).includes('copia de respaldo'), 'welcome explains backups');
  ok((await page.getAttribute('#offline-banner', 'class')).includes('hidden'), 'no offline banner when online');
  ok((await text(page, 'dash-alerts')).includes('copia de respaldo'), 'dashboard reminds to back up');
  await page.click('#dash-welcome [data-action="app.dismissWelcome"]');
  ok(await page.evaluate(() => Store.ui.tab === 'presupuesto' && Store.state.settings.welcomeDismissed), 'starting with my data goes to the salary');
  await go(page, 'resumen');
  ok((await page.getAttribute('#dash-welcome', 'class')).includes('hidden'), 'welcome is dismissed');
  await page.click('.header-actions [data-action="app.help"]');
  ok(await page.evaluate(() => document.getElementById('cfg-guide').open && !document.querySelector('[data-tab=config]').classList.contains('hidden')), 'help button opens the guide');
  ok((await text(page, 'cfg-guide-body')).includes('doble clic'), 'guide explains how to open the file');
  await go(page, 'resumen');

  // ---- budget: focus retention while typing, footer, badge
  await go(page, 'presupuesto/plan');
  ok(!(await page.isHidden('#bud-simple')) && await page.isHidden('#bud-detailed'), 'the simple (cards) budget view is the default');
  await page.click('[data-action="budget.layout"][data-layout="detailed"]');
  const prepSel = '#bud-body tr[data-row="1"] input[data-field="prep"]';
  await typeInto(page, prepSel, '425');
  ok(await page.inputValue(prepSel) === '425', 'budget prep typed fully (no focus loss)', await page.inputValue(prepSel));
  ok(await focusedMatches(page, prepSel), 'budget prep keeps focus after typing');
  ok((await text(page, 'bud-f-exp-prep')) === '$1,433.25', 'footer total prep updates', await text(page, 'bud-f-exp-prep'));
  ok((await text(page, 'bud-f-exp-diff')) === '$75.00', 'footer diff cell is live (was dead before)', await text(page, 'bud-f-exp-diff'));
  const realSel0 = '#bud-body tr[data-row="1"] input[data-field="real"]';
  await typeInto(page, realSel0, '300');
  const balClass = await page.getAttribute('#bud-balance-box', 'class');
  ok(balClass.includes('tone-amber'), 'balance box amber when unassigned money', balClass);
  // overspend -> red
  const realSel = '#bud-body tr[data-row="1"] input[data-field="real"]';
  await typeInto(page, realSel, '900');
  ok((await page.getAttribute('#bud-balance-box', 'class')).includes('tone-red'), 'balance box red when over budget');
  await typeInto(page, realSel, '300');
  // sweep: derived, badge, balance 0, typed values untouched
  await page.check('[data-bind="year.sweepSavings"]');
  await page.waitForTimeout(50);
  ok((await text(page, 'bud-balance')) === '$0.00', 'sweep brings balance to $0', await text(page, 'bud-balance'));
  ok(!(await page.getAttribute('#bud-sweep', 'class')).includes('hidden'), 'sweep badge visible');
  ok(await page.$('#bud-body tr[data-row="sweep"]') !== null, 'the swept money is a visible line in Ahorro');
  ok((await page.textContent('#bud-body tr[data-row="sweep"] [data-cell="real"]')) === (await text(page, 'bud-sweep')).replace(/^\+| barrido a ahorro$/g, ''), 'sweep line shows the swept amount', [await page.textContent('#bud-body tr[data-row="sweep"] [data-cell="real"]'), await text(page, 'bud-sweep')]);
  ok(!(await page.getAttribute('#bud-sweep-tip', 'class')).includes('hidden'), 'with debts, the sweep suggests the snowball instead');
  ok(await page.inputValue('#bud-body tr[data-row="14"] input[data-field="real"]') === '50', 'sweep does not rewrite the typed Ahorro value');
  await typeInto(page, prepSel, '4');  // typing with sweep on must keep focus (old bug)
  await page.keyboard.type('0');
  ok(await focusedMatches(page, prepSel) && await page.inputValue(prepSel) === '40', 'typing with sweep on keeps focus', await page.inputValue(prepSel));
  await typeInto(page, prepSel, '350');
  await page.uncheck('[data-bind="year.sweepSavings"]');
  ok(await page.$('#bud-body tr[data-row="sweep"]') === null, 'sweep line disappears when the sweep is off');
  await typeInto(page, realSel, '350');
  ok((await text(page, 'bud-balance')) === '$0.00', 'sample budget is balanced');
  // debts and goals live in the budget as linked lines
  ok(await page.$('#bud-body tr[data-row="debt-1"]') !== null && await page.$('#bud-body tr[data-row="goal-1"]') !== null, 'debts and goals appear as budget lines');
  await typeInto(page, '#bud-body tr[data-row="goal-1"] input[data-field="prep"]', '20');
  ok(await page.evaluate(() => Store.state.goals[0].monthly) === 20, 'editing a goal line in the budget updates the goal');
  ok(await page.inputValue('#bud-body tr[data-row="goal-1"] input[data-field="real"]') === '20', 'twin input of a linked line stays in sync');
  ok((await text(page, 'bud-balance')) === '\u2212$20.00', 'funding a goal reduces the money left to assign');
  await typeInto(page, '#bud-body tr[data-row="goal-1"] input[data-field="prep"]', '0');

  // type change moves row into another group
  await page.selectOption('#bud-body tr[data-row="12"] select[data-field="type"]', 'Deuda');
  const groupOf12 = await page.evaluate(() => { let r = document.querySelector('#bud-body tr[data-row="12"]'); while (r && !r.classList.contains('group-row')) r = r.previousElementSibling; return r && r.dataset.group; });
  ok(groupOf12 === 'Deuda', 'changing type moves the row to its group', groupOf12);
  await page.selectOption('#bud-body tr[data-row="12"] select[data-field="type"]', 'Gasto Variable');

  // add row focuses new name; delete + undo
  await page.click('#bud-detailed [data-action="budget.addRow"]');
  const focusedName = await page.evaluate(() => document.activeElement && document.activeElement.dataset.field);
  ok(focusedName === 'name', 'new budget row name gets focus', focusedName);
  const rowsBefore = await page.$$eval('#bud-body tr[data-row]', r => r.length);
  await page.click('#bud-body tr[data-row="1"] [data-action="budget.delete"]');
  ok(await page.$$eval('#bud-body tr[data-row]', r => r.length) === rowsBefore - 1, 'row deleted');
  await page.click('.toast-action');
  ok(await page.$$eval('#bud-body tr[data-row]', r => r.length) === rowsBefore, 'undo restores deleted row');
  await page.click('#bud-body tr[data-row="2"] [data-action="budget.delete"]');
  await typeInto(page, '#bud-body tr[data-row="3"] input[data-field="prep"]', '36');
  ok(await page.$$eval('.toast-undo', t => t.length) === 0, 'a later edit cancels the pending undo (no jumping back over edits)');
  ok(await page.evaluate(() => Store.active().budgetBase.find(i => i.id === 3).prep) === 36, 'edit after delete is kept');
  await page.click('#bud-detailed [data-action="budget.addRow"]');

  // month override: first edit keeps focus, reset link appears, reset works
  await page.selectOption('#budget-month', '9');
  await typeInto(page, '#bud-body tr[data-row="7"] input[data-field="real"]', '300');
  ok(await focusedMatches(page, '#bud-body tr[data-row="7"] input[data-field="real"]'), 'first edit in a month keeps focus');
  ok(await page.evaluate(() => !!Store.active().monthOverrides['9']), 'month override created');
  ok(await page.evaluate(() => Store.active().budgetBase.find(i => i.id === 7).real) === 80, 'base budget untouched by month edit');
  await page.click('[data-action="budget.resetMonth"]');
  ok(await page.evaluate(() => !Store.active().monthOverrides['9']), 'reset month removes override');
  await page.selectOption('#budget-month', 'base');

  // ---- other income: logged income counts in its month, recurring income in every month
  const amt = s => Number(String(s).replace(/[$,]/g, ''));
  const curM = await page.evaluate(() => String(new Date().getMonth() + 1));
  const baseInc = amt(await text(page, 'bud-income'));
  const baseBal = await text(page, 'bud-balance');
  ok(await page.$('#bud-body tr[data-income="salary"]') !== null, 'salary is the first income line of the budget');
  ok((await text(page, 'bud-month-note')).includes('ingresos extra'), 'base budget points to extra income logged this month');
  await page.click('[data-action="budget.showMonth"]');
  ok(await page.inputValue('#budget-month') === curM, 'the link opens the current month');
  ok(await page.$('#bud-body tr[data-income="cat:Remesas del Exterior"]') !== null, 'logged remesa is an income line of its month');
  ok(Math.abs(amt(await text(page, 'bud-income')) - (baseInc + 200)) < 0.01, 'logged income raises the month income', await text(page, 'bud-income'));
  await page.click('#bud-body [data-action="income.fromCategory"]');
  ok(await page.evaluate(() => Store.active().otherIncomes.length === 1 && Store.active().otherIncomes[0].amount === 200), '"Es mensual" turns it into recurring income');
  ok(Math.abs(amt(await text(page, 'bud-income')) - (baseInc + 200)) < 0.01, 'recurring + logged remesa is counted once', await text(page, 'bud-income'));
  ok((await page.textContent('#bud-body tr[data-income="1"]')).includes('Recibido $200'), 'recurring income shows what was received');
  await page.evaluate(() => { const s = Store.state; s.transactions.push({ id: 900, type: 'Ingreso', description: 'Venta de helados', store: 'Parque', parentCategory: 'Ingresos Laborales', category: 'Sueldo/Salario', amount: 120, date: new Date().toISOString().slice(0, 10), paymentType: 'Efectivo' }); App.changed({ structural: true }); });
  ok((await page.textContent('#bud-body')).includes('Venta de helados'), 'income logged as salary is explained, not silently dropped');
  ok(Math.abs(amt(await text(page, 'bud-income')) - (baseInc + 200)) < 0.01, 'income logged as the salary is not added twice');
  await page.click('#bud-body [data-action="income.countExtra"]');
  ok(Math.abs(amt(await text(page, 'bud-income')) - (baseInc + 320)) < 0.01, '"Es un ingreso extra" adds it to the month', await text(page, 'bud-income'));
  await page.check('[data-bind="year.sweepSavings"]');
  await page.waitForTimeout(50);
  ok((await text(page, 'bud-balance')) === '$0.00', 'with the sweep on, extra income leaves nothing to assign by hand', await text(page, 'bud-balance'));
  await page.selectOption('#budget-month', 'base');
  ok(Math.abs(amt(await text(page, 'bud-income')) - (baseInc + 200)) < 0.01, 'recurring income counts in the base budget');
  await typeInto(page, realSel, '900');
  ok((await text(page, 'bud-balance-label')) === 'Te falta', 'a shortfall is labelled as missing money, not money to assign');
  ok((await text(page, 'bud-sweep')).includes('Nada que barrer') && (await text(page, 'bud-balance-note')).includes('no puede cubrir'), 'sweep explains it cannot cover a shortfall');
  await typeInto(page, realSel, '350');
  await page.uncheck('[data-bind="year.sweepSavings"]');
  await page.click('#bud-body tr[data-income="1"] [data-action="income.delete"]');
  ok(await page.evaluate(() => Store.active().otherIncomes.length) === 0, 'income source deleted');
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== 900); App.changed({ structural: true }); });
  await page.click('#bud-detailed [data-action="income.add"]');
  ok(await page.evaluate(() => document.activeElement && document.activeElement.dataset.field) === 'name', 'new income line name gets focus');
  await page.evaluate(() => { Store.active().otherIncomes = []; App.changed({ structural: true }); });
  ok(Math.abs(amt(await text(page, 'bud-income')) - baseInc) < 0.01 && (await text(page, 'bud-balance')) === baseBal, 'income back to the sample after cleanup', [await text(page, 'bud-income'), baseInc, await text(page, 'bud-balance')]);

  // ---- the reported bug: adding income lines must not swallow logged income; undo / redo
  await page.evaluate(() => { Store.state.transactions.push({ id: 901, type: 'Ingreso', description: 'Venta de helados', store: 'Parque', parentCategory: 'Ingresos Independientes', category: 'Ventas de Negocio Propio', amount: 120, date: new Date().toISOString().slice(0, 10), paymentType: 'Efectivo' }); App.changed({ structural: true, step: true }); });
  await page.selectOption('#budget-month', curM);
  const incWithHelados = amt(await text(page, 'bud-income'));
  await page.click('#bud-detailed [data-action="income.add"]');
  await page.click('#bud-detailed [data-action="income.add"]');
  ok(await page.$('#bud-body tr[data-income="cat:Ingresos Independientes"]') !== null, 'logged income keeps its own line after adding income lines');
  ok((await page.textContent('#bud-body tr[data-income="cat:Ingresos Independientes"]')).includes('Venta de helados'), 'logged income line names the transaction');
  ok(await page.evaluate(() => Store.active().otherIncomes.every(x => x.category === 'none')), 'new income lines start unlinked');
  ok(Math.abs(amt(await text(page, 'bud-income')) - incWithHelados) < 0.01, 'empty income lines change nothing');
  // the reported bug: giving a line the helados category must not swallow the sale
  await page.selectOption('#bud-body tr[data-income="1"] select[data-field="category"]', 'Ingresos Independientes');
  await page.selectOption('#bud-body tr[data-income="2"] select[data-field="category"]', 'Ingresos Independientes');
  ok(await page.$('#bud-body tr[data-income="cat:Ingresos Independientes"]') !== null, 'changing a line\'s category does not absorb logged income');
  ok(!(await page.textContent('#bud-body tr[data-income="1"]')).includes('Venta de helados'), 'the line does not claim the helados sale');
  ok(Math.abs(amt(await text(page, 'bud-income')) - incWithHelados) < 0.01, 'income unchanged by a category change', await text(page, 'bud-income'));
  // linking is explicit: "¿Es de un ingreso de arriba?"
  await page.selectOption('#bud-body tr[data-income="cat:Ingresos Independientes"] select[data-change="income.linkTxns"]', '1');
  ok((await page.textContent('#bud-body tr[data-income="1"]')).includes('Venta de helados') && (await page.textContent('#bud-body tr[data-income="1"]')).includes('Recibido $120'), 'an explicitly linked transaction is received by that line');
  ok(await page.$('#bud-body tr[data-income="cat:Ingresos Independientes"]') === null, 'linked income leaves the extra-income rows');
  ok(Math.abs(amt(await text(page, 'bud-income')) - incWithHelados) < 0.01, 'linking does not count logged income twice', await text(page, 'bud-income'));
  // header undo walks back one action at a time; redo goes forward
  ok(!(await page.isDisabled('#hist-undo')), 'undo button is enabled after changes');
  for (let i = 0; i < 5; i++) await page.click('#hist-undo');
  ok(await page.evaluate(() => Store.active().otherIncomes.length) === 0, 'undo removes the two added income lines (and their links)');
  ok(await page.evaluate(() => Store.state.transactions.some(t => t.id === 901)), 'undo stops before the logged transaction');
  await page.click('#hist-redo');
  ok(await page.evaluate(() => Store.active().otherIncomes.length) === 1, 'redo brings one step back');
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('Control+z');
  ok(await page.evaluate(() => Store.active().otherIncomes.length) === 0, 'Ctrl+Z undoes outside text boxes');
  // typing a number is one undo step, not one per keystroke
  const helSel = '#bud-body tr[data-row="3"] input[data-field="real"]';
  const before3 = await page.inputValue(helSel);
  await typeInto(page, helSel, '123');
  await page.waitForTimeout(900);
  await page.click('#hist-undo');
  ok(await page.inputValue(helSel) === before3, 'undo reverts a whole typed number at once', [await page.inputValue(helSel), before3]);
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== 901); delete Store.active().monthOverrides[String(new Date().getMonth() + 1)]; App.changed({ structural: true, step: true }); });
  await page.selectOption('#budget-month', 'base');

  // ---- "Ya lo recibí": planned income is marked received by logging it as a transaction
  await page.evaluate(() => { Store.active().otherIncomes = [{ id: 1, name: 'Horas Extras', amount: 50, category: 'Ingresos Laborales' }]; App.changed({ structural: true, step: true }); });
  await page.selectOption('#budget-month', curM);
  const incPlanned = amt(await text(page, 'bud-income'));
  ok((await page.textContent('#bud-body tr[data-income="1"]')).includes('Recibido $0 de $50'), 'planned but not logged income says so');
  const nTx = await page.evaluate(() => Store.state.transactions.length);
  await page.click('#bud-body tr[data-income="1"] [data-action="income.markReceived"]');
  const added = await page.evaluate(() => Store.state.transactions[Store.state.transactions.length - 1]);
  ok(added.type === 'Ingreso' && added.amount === 50 && added.parentCategory === 'Ingresos Laborales' && added.category === 'Horas Extras', '"Ya lo recibí" logs the income in its category (not as salary)', added);
  ok((await page.textContent('#bud-body tr[data-income="1"]')).includes('Recibido $50'), 'the line now shows it as received');
  ok(Math.abs(amt(await text(page, 'bud-income')) - incPlanned) < 0.01, 'marking it received does not count it twice');
  await page.click('#hist-undo');
  ok(await page.evaluate(() => Store.state.transactions.length) === nTx, 'undo removes the logged income');
  await page.evaluate(() => { Store.active().otherIncomes = []; App.changed({ structural: true, step: true }); });
  await page.selectOption('#budget-month', 'base');

  // ---- the transaction form can link an income to a budget line
  await page.evaluate(() => { Store.active().otherIncomes = [{ id: 1, name: 'Horas Extras', amount: 50, category: 'Ingresos Laborales' }]; App.changed({ structural: true, step: true }); });
  await go(page, 'presupuesto/transacciones');
  await page.selectOption('#txn-type', 'Ingreso');
  ok(!(await page.getAttribute('#txn-income-field', 'class')).includes('hidden'), 'income form asks which budget income it belongs to');
  await page.fill('#txn-description', 'Horas extra septiembre');
  await page.fill('#txn-amount', '60');
  await page.selectOption('#txn-income', '1');
  await page.click('[data-action="txn.add"]');
  ok(await page.evaluate(() => Store.state.transactions[Store.state.transactions.length - 1].incomeId) === 1, 'the new income is linked to the chosen line');
  ok((await page.textContent('#txn-body')).includes('Recibido de «Horas Extras»'), 'the transaction list shows the link');
  await page.selectOption('#txn-type', 'Gasto');
  ok((await page.getAttribute('#txn-income-field', 'class')).includes('hidden'), 'expenses do not ask for an income line');
  await go(page, 'presupuesto/plan');
  await page.selectOption('#budget-month', curM);
  ok((await page.textContent('#bud-body tr[data-income="1"]')).includes('Recibido $60'), 'the budget line shows it as received');
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.description !== 'Horas extra septiembre'); Store.active().otherIncomes = []; App.changed({ structural: true, step: true }); });
  await page.selectOption('#budget-month', 'base');

  // ---- editing a transaction: fix a typo, the amount and the category in place
  await go(page, 'presupuesto/transacciones');
  const target = await page.evaluate(() => Store.state.transactions.find(t => t.description === 'Compras de la semana').id);
  const countBefore = await page.evaluate(() => Store.state.transactions.length);
  await page.click(`#txn-body [data-action="txn.edit"][data-id="${target}"]`);
  ok((await text(page, 'txn-form-title')) === 'Editar Transacción' && await page.inputValue('#txn-description') === 'Compras de la semana', 'pencil loads the transaction into the form');
  ok(await page.inputValue('#txn-parent') === 'Alimentación' && await page.inputValue('#txn-sub') === 'Mercado/Supermercado' && await page.inputValue('#txn-amount') === '45.5', 'form shows its category, subcategory and amount');
  await page.fill('#txn-description', 'Compras de la semana (corregido)');
  await page.fill('#txn-amount', '54.50');
  await page.selectOption('#txn-parent', 'Transporte');
  await page.click('#txn-submit');
  const edited = await page.evaluate(id => Store.state.transactions.find(t => t.id === id), target);
  ok(edited.description === 'Compras de la semana (corregido)' && edited.amount === 54.5 && edited.parentCategory === 'Transporte', 'saving updates the same transaction', edited);
  ok(await page.evaluate(() => Store.state.transactions.length) === countBefore, 'editing does not create a new transaction');
  ok((await text(page, 'txn-form-title')) === 'Registrar Transacción' && await page.inputValue('#txn-description') === '', 'form goes back to "new" after saving');
  await page.click('#hist-undo');
  ok(await page.evaluate(id => Store.state.transactions.find(t => t.id === id).amount, target) === 45.5, 'undo restores the transaction before the edit');
  await page.click(`#txn-body [data-action="txn.edit"][data-id="${target}"]`);
  await page.fill('#txn-amount', '999');
  await page.click('#txn-cancel');
  ok(await page.evaluate(id => Store.state.transactions.find(t => t.id === id).amount, target) === 45.5 && await page.isHidden('#txn-cancel'), 'cancel leaves the transaction unchanged');
  // editing an income can link it to a budget income line
  await page.evaluate(() => { Store.active().otherIncomes = [{ id: 77, name: 'Remesa', amount: 200, category: 'Remesas del Exterior' }]; App.changed({ structural: true, step: true }); });
  const rem = await page.evaluate(() => Store.state.transactions.find(t => t.description.startsWith('Remesa')).id);
  await page.click(`#txn-body [data-action="txn.edit"][data-id="${rem}"]`);
  await page.selectOption('#txn-income', '77');
  await page.click('#txn-submit');
  ok(await page.evaluate(id => Store.state.transactions.find(t => t.id === id).incomeId, rem) === 77, 'editing an income can link it to a budget line');
  await page.evaluate(id => { Store.active().otherIncomes = []; delete Store.state.transactions.find(t => t.id === id).incomeId; App.changed({ structural: true, step: true }); }, rem);
  await go(page, 'presupuesto/plan');

  // ---- simple (EveryDollar-style) budget view
  await go(page, 'presupuesto/plan');
  await page.selectOption('#budget-month', 'base');
  await page.click('#bud-detailed-toggle-dummy').catch(() => {});
  await page.click('[data-action="budget.layout"][data-layout="simple"]');
  await page.click('[data-action="budget.mode"][data-mode="planned"]');
  const line1 = '#bud-simple [data-line="1"] .bs-input';
  const r1 = await page.evaluate(() => Store.active().budgetBase.find(i => i.id === 1).real);
  await typeInto(page, line1, '360');
  ok(await page.evaluate(() => { const i = Store.active().budgetBase.find(x => x.id === 1); return i.real === 360 && i.prep === 360; }), 'editing a planned amount in the cards updates the line (and keeps Presupuestado in step)');
  ok(await focusedMatches(page, line1), 'planned input keeps focus while typing');
  await typeInto(page, line1, String(r1));
  const foodId = await page.evaluate(() => String(Store.active().budgetBase.find(i => i.linkedCategory === 'Alimentación').id));
  const eduId = await page.evaluate(() => String(Store.active().budgetBase.find(i => i.linkedCategory === 'Educación').id));
  await page.evaluate(() => {
    const d = new Date(); const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    Store.state.transactions.push({ id: 950, type: 'Gasto', description: 'Farmacia XYZ', store: '', parentCategory: 'Varios XYZ', category: '', amount: 30, date: iso, paymentType: 'Efectivo' });
    Store.state.transactions.push({ id: 951, type: 'Gasto', description: 'Libro XYZ', store: '', parentCategory: 'Varios XYZ', category: '', amount: 12, date: iso, paymentType: 'Efectivo' });
    App.changed({ structural: true, step: true });
  });
  await page.click('[data-action="budget.mode"][data-mode="spent"]');
  const spentOf = (id) => page.evaluate(id => document.querySelector(`#bud-simple [data-line="${id}"] [data-v]`).textContent, id);
  const expectFood = await page.evaluate(id => { const m = String(new Date().getMonth() + 1); const it = Engine.monthItems(Store.effective(Store.state.activeYear), m); return Fmt.money(Engine.lineSpend(it, Store.state.transactions, Store.state.activeYear, m).byLine[id].spent); }, foodId);
  ok(await spentOf(foodId) === expectFood, 'Gastado shows what was spent on each line this month', [await spentOf(foodId), expectFood]);
  ok(!(await page.isHidden('#bs-unassigned')) && (await page.textContent('#bs-unassigned')).includes('Farmacia XYZ'), 'spending that matches no line is listed to be assigned');
  const foodBefore = await page.evaluate(id => Store.state.transactions.filter(t => String(t.budgetLine) === id).length, foodId);
  await page.selectOption('#bs-unassigned [data-id="950"]', foodId);
  ok(await page.evaluate(() => Store.state.transactions.find(t => t.id === 950).budgetLine) === foodId, 'choosing a line assigns the transaction to it');
  ok(!(await page.textContent('#bs-unassigned')).includes('Farmacia XYZ'), 'an assigned expense leaves the unassigned list');
  // Headless Chrome cancels a native drag if the page scrolls mid-drag: keep both on screen.
  await page.setViewportSize({ width: 1366, height: 3000 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.dragAndDrop('#bs-unassigned [data-txn="951"]', `#bud-simple [data-line="${eduId}"]`, { sourcePosition: { x: 12, y: 10 } });
  await page.setViewportSize({ width: 1366, height: 900 });
  ok(await page.evaluate(() => Store.state.transactions.find(t => t.id === 951).budgetLine) === eduId, 'dragging a transaction onto a line assigns it', await page.evaluate(() => Store.state.transactions.find(t => t.id === 951).budgetLine));
  await page.click('[data-action="budget.mode"][data-mode="remaining"]');
  ok((await page.textContent('#bud-simple .bs-card[data-group="income"] [data-col]')) === 'Por recibir', 'income card switches to "Por recibir"');
  await page.click('[data-action="budget.mode"][data-mode="all"]');
  ok(await page.evaluate(() => document.getElementById('bud-simple').classList.contains('mode-all')), 'Todo shows planned, spent and remaining together');
  ok(['Bajo', 'Medio', 'Alto', 'Sin datos'].includes(await text(page, 'bud-risk')), 'risk of overspending tile', await text(page, 'bud-risk'));
  // due dates → bills on the dashboard
  await page.click('#bud-simple [data-line="1"] [data-action="budget.dueDay"]');
  await page.fill('.modal input[name="day"]', '40');
  await page.click('[data-dialog-ok]');
  ok(await page.$('.modal-error:not(.hidden)') !== null, 'due day must be 1–31');
  await page.fill('.modal input[name="day"]', '5');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.active().budgetBase.find(i => i.id === 1).dueDay) === 5, 'due day saved on the line');
  ok((await page.textContent('#bud-simple [data-line="1"] [data-due]')) === 'día 5', 'the line shows its due day');
  await go(page, 'resumen');
  ok((await page.textContent('#dash-bills')).includes('Arriendo'), 'dashboard lists the bill');
  await page.click('#dash-bills [data-action="bill.pay"][data-line="1"]');
  ok((await page.textContent('#dash-bills')).includes('Pagado'), 'Registrar pago marks it paid');
  const paidTxn = await page.evaluate(() => Store.state.transactions.find(t => t.budgetLine === '1' && t.description.startsWith('Arriendo')));
  ok(paidTxn && paidTxn.type === 'Gasto', 'the payment is an expense on that line', paidTxn);
  await page.click('#hist-undo');
  ok(!(await page.textContent('#dash-bills')).includes('Pagado'), 'undo un-pays it');
  // currency
  await go(page, 'config');
  await page.selectOption('#cfg-currency', 'EUR');
  await go(page, 'presupuesto/plan');
  ok((await text(page, 'bud-income')).includes('€'), 'amounts use the chosen currency', await text(page, 'bud-income'));
  await go(page, 'config');
  await page.selectOption('#cfg-currency', 'USD');
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== 950 && t.id !== 951); delete Store.active().budgetBase.find(i => i.id === 1).dueDay; App.changed({ structural: true, step: true }); });
  await go(page, 'presupuesto/plan');
  await page.click('[data-action="budget.layout"][data-layout="detailed"]');

  console.log('marker before phase2', await page.evaluate(() => window.__noReload));
  // ---- phase 2: import CSV / SRI XML / photo, rules, investments
  const path = require('path');
  await go(page, 'presupuesto/importar');
  const nBefore = await page.evaluate(() => Store.state.transactions.length);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/pichincha.csv'));
  await page.waitForTimeout(200);
  ok((await page.inputValue('#imp-map input[data-change="imp.headerRow"]')) === '4', 'header row found below the bank preamble', await page.inputValue('#imp-map input[data-change="imp.headerRow"]'));
  ok((await page.textContent('#imp-summary')).includes('5 para importar'), 'CSV rows parsed (Windows-1252, ; and comma decimals)', await page.textContent('#imp-summary'));
  ok((await page.textContent('#imp-cats')).includes('Supermercado'), 'the file\'s own categories can be mapped to ours');
  await page.selectOption('#imp-cats select[data-value="Efectivo"]', 'Otros');
  await page.click('#imp-rows input[data-i="4"]');
  ok((await page.textContent('#imp-summary')).includes('4 para importar'), 'rows can be left out');
  const acctsBefore = await page.evaluate(() => (Store.state.accounts || []).length);
  await page.selectOption('select[data-change="imp.account"]', 'new:ahorros');
  await page.click('#imp-commit');
  const newAcct = await page.evaluate(() => Store.state.accounts[Store.state.accounts.length - 1]);
  ok(await page.evaluate(() => Store.state.accounts.length) === acctsBefore + 1 && newAcct.balance === 1337.1 && newAcct.updatedAt.endsWith('-09-07'), 'the Saldo column updates an account with the latest balance', newAcct);
  ok(await page.evaluate(() => Store.state.transactions.length) === nBefore + 4, 'import adds the selected rows');
  const sm = await page.evaluate(() => Store.state.transactions.find(t => t.description === 'Supermaxi'));
  ok(sm && sm.parentCategory === 'Alimentación' && sm.amount === 45.5 && sm.type === 'Gasto' && sm.date.endsWith('-09-01'), 'imported expense categorized by merchant', sm);
  ok(await page.evaluate(() => Object.keys(Store.state.settings.importProfiles).length) === 1, 'the column mapping is remembered (not the file)');
  ok(await page.evaluate(() => !JSON.stringify(Store.state).includes('ESTADO DE CUENTA')), 'the file itself is not stored');
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/pichincha.csv'));
  await page.waitForTimeout(200);
  ok((await page.textContent('#imp-profile-note')).includes('guardaste'), 'same kind of file reuses the saved mapping');
  // The file goes to the same account (remembered); the row left out last time is older than that
  // import, so it also starts unchecked ("before last import").
  ok((await page.textContent('#imp-summary')).includes('0 para importar') && (await page.textContent('#imp-rows')).includes('Ya existe') && (await page.textContent('#imp-rows')).includes('Antes de la última importación'), 'already-imported rows are flagged and unchecked; older ones too', await page.textContent('#imp-summary'));
  await page.click('[data-action="imp.cancel"]');
  ok(await page.isHidden('#imp-preview-card'), 'cancel discards the file');
  await page.click('#hist-undo');
  ok(await page.evaluate(() => Store.state.transactions.length) === nBefore, 'undo removes an import');
  await page.setInputFiles('#imp-xml', path.join(ROOT, 'tests/fixtures/factura.xml'));
  await page.waitForTimeout(200);
  ok(await page.inputValue('#imp-rows input.imp-desc') === 'SUPERMAXI' && (await page.textContent('#imp-rows')).includes('IVA $6.00'), 'SRI invoice XML read exactly');
  await page.click('#imp-commit');
  const inv = await page.evaluate(() => Store.state.transactions.find(t => t.invoice));
  ok(inv && inv.amount === 46 && inv.paymentType === 'Tarjeta de Crédito' && inv.invoice.ruc === '1790016919001', 'invoice becomes a transaction with its SRI data', inv);
  await page.setInputFiles('#imp-xml', path.join(ROOT, 'tests/fixtures/factura.xml'));
  await page.waitForTimeout(200);
  ok((await page.textContent('#imp-rows')).includes('Ya existe'), 'the same invoice twice is flagged (access key)');
  await page.click('[data-action="imp.cancel"]');
  // rules
  await page.click('#imp-rules-card [data-action="rule.add"]');
  await page.fill('.modal input[name="contains"]', 'pasaje');
  await page.selectOption('.modal select[name="cat"]', 'G|Transporte');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(150);
  if (await page.isVisible('.modal-backdrop:not(.hidden) [data-dialog-cancel]')) await page.click('.modal-backdrop:not(.hidden) [data-dialog-cancel]');
  ok((await page.textContent('#rule-body')).includes('pasaje'), 'rule created');
  await go(page, 'presupuesto/transacciones');
  await page.selectOption('#txn-type', 'Gasto');
  await page.fill('#txn-description', 'Pasaje Quito');
  await page.dispatchEvent('#txn-description', 'change');
  ok(await page.inputValue('#txn-parent') === 'Transporte', 'a rule picks the category while typing a new transaction');
  await page.fill('#txn-description', '');
  // photo (OCR engine replaced by a stand-in: the test browser has no internet)
  await go(page, 'presupuesto/importar');
  await page.evaluate(() => { window.Tesseract = { createWorker: async () => ({ recognize: async () => ({ data: { text: 'FARMACIAS FYBECA\nRUC 1790710319001\nFecha 12/09/2026\nSUBTOTAL 20,00\nTOTAL 23,00' } }), terminate: async () => {} }) }; });
  await page.setInputFiles('#imp-photo', path.join(ROOT, 'tests/fixtures/receipt.png'));
  await page.waitForTimeout(300);
  ok(await page.inputValue('#txn-amount') === '23' && await page.inputValue('#txn-description') === 'FARMACIAS FYBECA' && await page.inputValue('#txn-parent') === 'Salud', 'receipt photo prefills the form for review', [await page.inputValue('#txn-amount'), await page.inputValue('#txn-description'), await page.inputValue('#txn-parent')]);
  await page.fill('#txn-description', ''); await page.fill('#txn-amount', '');
  // investments (price API replaced by a stand-in)
  await page.route(/finnhub\.io\/api\/v1\/quote/, r => { const sym = new URL(r.request().url()).searchParams.get('symbol'); r.fulfill({ contentType: 'application/json', body: JSON.stringify(sym === 'VOO' ? { c: 500.25 } : { c: 0 }) }); });
  await go(page, 'patrimonio');
  await page.click('[data-action="hold.add"]');
  await page.fill('#hold-body tr:last-child input[data-field="ticker"]', 'voo');
  await page.dispatchEvent('#hold-body tr:last-child input[data-field="ticker"]', 'change');
  await typeInto(page, '#hold-body tr:last-child input[data-field="shares"]', '10');
  await page.click('[data-action="hold.refresh"]');
  ok((await page.textContent('.toast-error:last-of-type, .toast:last-of-type')).includes('clave'), 'refreshing without an API key explains what to do');
  await page.evaluate(() => { Store.state.settings.priceKey = 'TESTKEY'; App.go('patrimonio'); });
  await page.click('[data-action="hold.add"]');
  await page.fill('#hold-body tr:last-child input[data-field="ticker"]', 'NOPE');
  await page.dispatchEvent('#hold-body tr:last-child input[data-field="ticker"]', 'change');
  await page.click('[data-action="hold.refresh"]');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => Store.state.holdings.find(h => h.ticker === 'VOO').price) === 500.25, 'market price fetched with the person\'s key');
  ok((await text(page, 'hold-total')) === '$5,003', 'holding value = units × price', await text(page, 'hold-total'));
  await typeInto(page, '#hold-body tr:last-child input[data-field="price"]', '12');
  ok(await page.evaluate(() => Store.state.holdings.find(h => h.ticker === 'NOPE').priceSource) === 'manual', 'a price can be typed by hand when the symbol is not found');
  const invField = await page.evaluate(() => Store.active().netWorth.investments);
  const expectInv = await page.evaluate(() => Engine.polizasCapital(Store.state.polizas) + Engine.holdingsValue(Store.state.holdings));
  ok(Math.abs(invField - expectInv) < 0.01, 'investments flow into net worth on their own', [invField, expectInv]);
  const [dlBackup] = await Promise.all([page.waitForEvent('download'), page.evaluate(() => { App.go('config'); document.querySelector('[data-action="cfg.download"]').click(); })]);
  const savedBackup = JSON.parse(require('fs').readFileSync(await dlBackup.path(), 'utf8'));
  ok(savedBackup.holdings.length === 2 && !savedBackup.settings.priceKey, 'backup has the investments but never the API key');
  await page.evaluate(() => { Store.state.holdings = []; Store.state.rules = []; Store.state.settings.priceKey = ''; Store.state.transactions = Store.state.transactions.filter(t => !t.invoice); App.changed({ structural: true, step: true }); });
  await page.unroute(/finnhub\.io\/api\/v1\/quote/);
  console.log('marker after phase2', await page.evaluate(() => window.__noReload), await page.evaluate(() => document.styleSheets.length));

  // ---- phase 3a: household members, paydays, this-month dashboard
  await go(page, 'config');
  for (const n of ['Allen', 'Emma']) {
    await page.click('[data-action="member.add"]');
    await page.fill('.modal input[name="name"]', n);
    await page.click('[data-dialog-ok]');
  }
  ok(await page.evaluate(() => Store.state.members.map(p => p.name).join()) === 'Allen,Emma', 'household members added');
  ok(await page.evaluate(() => new Set(Store.state.members.map(p => p.color)).size) === 2, 'each person gets their own color');
  await go(page, 'presupuesto/transacciones');
  ok(!(await page.isHidden('#txn-member-field')), 'the form asks who when there is a household');
  await page.selectOption('#txn-type', 'Gasto');
  await page.fill('#txn-description', 'Cine con amigos');
  await page.fill('#txn-amount', '18');
  const emmaId = await page.evaluate(() => String(Store.state.members.find(p => p.name === 'Emma').id));
  await page.selectOption('#txn-member', emmaId);
  await page.click('#txn-submit');
  ok(await page.evaluate(() => Store.state.transactions[Store.state.transactions.length - 1].memberId) === Number(emmaId), 'transaction records who spent');
  await page.selectOption('#txn-f-member', emmaId);
  ok((await page.$$eval('#txn-body .txn-item', r => r.length)) === 1 && (await page.textContent('#txn-body')).includes('Cine con amigos'), 'history can be filtered by person');
  await page.selectOption('#txn-f-member', 'all');
  await go(page, 'presupuesto/ingresos');
  await page.click('#pay-edit');
  await page.waitForSelector('#ps-days');
  await page.fill('#ps-days', '30, 15 y 15');
  await page.dispatchEvent('#ps-days', 'change');
  await page.click('#pay-save');
  ok(await page.evaluate(() => Store.state.settings.paydays.join() + '|' + Store.state.settings.paySchedule.days.join()) === '15,30|15,30', 'paydays parsed and sorted');
  ok((await text(page, 'pay-summary')).startsWith('Los días 15 y 30, cada mes'), 'summary in words', await text(page, 'pay-summary'));
  await go(page, 'resumen');
  ok((await page.textContent('#dash-today')).includes('Próximo día de pago') && !(await page.textContent('#dash-today')).includes('Dinos cómo te pagan'), 'dashboard shows the next payday');
  ok(await page.evaluate(() => UI.chartInstance('dash-curve-chart').data.datasets.length) === 3, 'spent-this-month curve vs last month and plan');
  ok(!(await page.isHidden('#dash-members-card')) && (await page.textContent('#dash-members')).includes('Emma'), 'household contributions card');
  ok((await page.textContent('#dash-top')).length > 0 && (await page.textContent('#dash-cash')).includes('Saldo'), 'top expenses and cash flow cards');
  await go(page, 'config');
  await page.click(`#cfg-members [data-action="member.delete"][data-id="${emmaId}"]`);
  ok(await page.evaluate(id => !Store.state.transactions.some(t => t.memberId === Number(id)), emmaId), 'removing a person keeps their transactions, without the name');
  await page.evaluate(() => { Store.state.members = []; Store.state.settings.paydays = []; Store.state.settings.paySchedule = null; Store.state.transactions = Store.state.transactions.filter(t => t.description !== 'Cine con amigos'); App.changed({ structural: true, step: true }); });

  // ---- phase 3b: repeating/scheduled transactions, bin, goals by date, reports
  await go(page, 'presupuesto/transacciones');
  const isoOff = (days) => page.evaluate(d => { const x = new Date(); x.setDate(x.getDate() + d); return Engine.isoDate(x); }, days);
  const nTx0 = await page.evaluate(() => Store.state.transactions.length);
  await page.selectOption('#txn-type', 'Gasto');
  await page.fill('#txn-description', 'Netflix');
  await page.fill('#txn-amount', '10.99');
  await page.fill('#txn-date', await isoOff(-65));
  await page.selectOption('#txn-repeat', 'monthly');
  await page.click('#txn-submit');
  const rec1 = await page.evaluate(() => Store.state.recurring.find(r => r.description === 'Netflix'));
  ok(rec1 && rec1.frequency === 'monthly' && rec1.lastPosted === rec1.startDate, 'Repetir creates a monthly repeating movement', rec1);
  // Reopening the app posts what came due since (2 more months here).
  await page.evaluate(() => Recurring.maintain());
  const netflix = await page.evaluate(() => Store.state.transactions.filter(t => t.description === 'Netflix').length);
  ok(netflix === 3, 'due repetitions are registered automatically', netflix);
  ok((await page.textContent('#rec-body')).includes('Suscripción') && (await page.textContent('#rec-kpis')).includes('$10.99'), 'subscriptions are listed with their monthly cost');
  await page.click('#hist-undo');
  ok(await page.evaluate(() => Store.state.transactions.filter(t => t.description === 'Netflix').length) === 1, 'automatic posting can be undone');
  // Future date → scheduled, nothing posted yet.
  await page.fill('#txn-description', 'Arriendo octubre');
  await page.fill('#txn-amount', '350');
  await page.fill('#txn-date', await isoOff(5));
  await page.selectOption('#txn-repeat', 'monthly');
  await page.click('#txn-submit');
  ok(await page.evaluate(() => !Store.state.transactions.some(t => t.description === 'Arriendo octubre') && Store.state.recurring.some(r => r.description === 'Arriendo octubre' && !r.lastPosted)), 'a future date schedules it without registering it yet');
  // Repeat an existing transaction from the list.
  const pasaje = await page.evaluate(() => Store.state.transactions.find(t => t.description === 'Pasaje bus').id);
  await page.click(`#txn-body [data-action="txn.repeat"][data-id="${pasaje}"]`);
  await page.selectOption('.modal select[name="freq"]', 'weekly');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(id => Store.state.transactions.find(t => t.id === id).recurringId > 0, pasaje), 'an existing transaction can be set to repeat');
  // Deleted bin
  await page.click(`#txn-body [data-action="txn.delete"][data-id="${pasaje}"]`);
  ok(await page.evaluate(id => Store.state.trash.some(t => t.id === id) && !Store.state.transactions.some(t => t.id === id), pasaje), 'deleted transactions go to the bin');
  await page.click('#trash-panel summary');
  await page.click(`#trash-body [data-action="trash.restore"][data-id="${pasaje}"]`);
  ok(await page.evaluate(id => Store.state.transactions.some(t => t.id === id) && !Store.state.trash.length, pasaje), 'restored from the bin');
  // Select several: change category / payment at once, shift-click ranges, delete and undo.
  await page.click('#txn-select-toggle');
  ok(await page.isVisible('#txn-bulk') && await page.$$eval('#txn-body .txn-check input', a => a.length) > 0, 'select mode shows checkboxes and the action bar');
  const exp2 = await page.evaluate(() => [...document.querySelectorAll('#txn-body .txn-check input')].map(i => Number(i.dataset.id)).filter(id => (Store.state.transactions.find(t => t.id === id).type || 'Gasto') === 'Gasto').slice(0, 2));
  for (const id of exp2) await page.click(`#txn-body .txn-check input[data-id="${id}"]`);
  ok(/2/.test(await page.textContent('#txn-bulk-count')), 'the bar counts the selection');
  await page.click('[data-action="txn.bulkCategory"]');
  await page.selectOption('.modal select[name="cat"]', 'Transporte|');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(ids => ids.every(id => Store.state.transactions.find(t => t.id === id).parentCategory === 'Transporte'), exp2), 'bulk category change');
  await page.click('[data-action="txn.bulkPayment"]');
  await page.selectOption('.modal select[name="pay"]', 'Efectivo');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(ids => ids.every(id => Store.state.transactions.find(t => t.id === id).paymentType === 'Efectivo'), exp2), 'bulk payment method change');
  await page.click('#txn-bulk-all');
  await page.click('#txn-bulk-all');
  ok(/Toca/.test(await page.textContent('#txn-bulk-count')), 'select all, then clear');
  const rows3 = await page.$$eval('#txn-body .txn-check input', a => a.slice(0, 3).map(i => Number(i.dataset.id)));
  await page.click(`#txn-body .txn-check input[data-id="${rows3[0]}"]`);
  await page.click(`#txn-body .txn-check input[data-id="${rows3[2]}"]`, { modifiers: ['Shift'] });
  ok(/3/.test(await page.textContent('#txn-bulk-count')), 'shift-click selects a range', await page.textContent('#txn-bulk-count'));
  const nSel = await page.evaluate(() => Store.state.transactions.length);
  await page.click('[data-action="txn.bulkDelete"]');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(([n, ids]) => Store.state.transactions.length === n - 3 && ids.every(id => Store.state.trash.some(t => t.id === id)), [nSel, rows3]), 'bulk delete sends them to the bin');
  await page.evaluate(() => App.undo());
  ok(await page.evaluate(([n]) => Store.state.transactions.length === n && !Store.state.trash.length, [nSel]), 'one undo brings them all back');
  await page.click('#txn-bulk .bulk-close');
  ok(!(await page.isVisible('#txn-bulk')) && await page.$$eval('#txn-body .txn-check', a => a.length) === 0, 'Listo leaves select mode');
  // Tags: typed in the form, shown as chips, a chip filters, bulk add, report by tag.
  await go(page, 'transacciones/lista');
  await page.selectOption('#txn-type', 'Gasto');
  await page.fill('#txn-description', 'Almuerzo en Montañita');
  await page.fill('#txn-amount', '18');
  await page.fill('#txn-tags', 'Playa, #Boda  Ana; playa');
  await page.click('#txn-submit');
  const tagged = await page.evaluate(() => Store.state.transactions.find(t => t.description === 'Almuerzo en Montañita'));
  ok(JSON.stringify(tagged.tags) === '["playa","boda-ana"]', 'tags are cleaned up from the form', tagged.tags);
  await page.click(`#txn-body [data-row="${tagged.id}"] .tag-chip[data-tag="playa"]`);
  await page.waitForTimeout(300);
  ok(await page.$$eval('#txn-body [data-row]', r => r.length) === 1 && await page.inputValue('#txn-search') === '#playa', 'a tag chip shows everything with that tag');
  await page.evaluate(() => { Store.ui.txnSearch = ''; App.update(); });
  await page.click('#txn-select-toggle');
  const two = await page.$$eval('#txn-body .txn-check input', a => a.slice(0, 2).map(i => Number(i.dataset.id)));
  for (const id of two) await page.click(`#txn-body .txn-check input[data-id="${id}"]`);
  await page.click('[data-action="txn.bulkTag"]');
  await page.fill('.modal input[name="tag"]', 'Viaje Galápagos');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(ids => ids.every(id => (Store.state.transactions.find(t => t.id === id).tags || []).includes('viaje-galápagos')), two), 'bulk add a tag');
  await page.click('#txn-bulk .bulk-close');
  await go(page, 'transacciones/reportes');
  await page.evaluate(() => { Store.ui.report = Object.assign({}, Store.ui.report, { by: 'tag', range: 'all', type: 'Gasto' }); App.update(); });
  await page.waitForTimeout(200);
  const repTxt = await page.evaluate(() => document.querySelector('[data-view="reportes"]').textContent);
  ok(/#viaje-galápagos/.test(repTxt) && /#playa/.test(repTxt) && /Sin etiqueta/.test(repTxt), 'reports group by tag', repTxt.slice(0, 100));
  await page.evaluate(() => { const s = Store.state; s.transactions = s.transactions.filter(t => t.description !== 'Almuerzo en Montañita'); s.transactions.forEach(t => { delete t.tags; }); Store.ui.report = Object.assign({}, Store.ui.report, { by: 'category', range: 'this-month' }); App.changed({ structural: true, step: true }); });
  // Transfers: not income or spending; they move cash between accounts.
  const trSetup = await page.evaluate(() => {
    const s = Store.state, d = new Date(); d.setDate(d.getDate() - 3);
    s.accounts = [{ id: 1, name: 'Corriente Pichincha', kind: 'corriente', balance: 1000, updatedAt: Engine.isoDate(d) }, { id: 2, name: 'Ahorros', kind: 'ahorros', balance: 0, updatedAt: Engine.isoDate(d) }];
    App.changed({ structural: true, step: true });
    const t = new Date();
    return { flow: Engine.cashFlow(s.transactions, t.getFullYear(), t.getMonth() + 1), cash: Engine.cashNow(s.accounts, s.transactions, t).total };
  });
  await go(page, 'transacciones/lista');
  await page.selectOption('#txn-type', 'Transferencia');
  ok(!(await page.isVisible('#txn-parent-field')) && await page.isVisible('#txn-from') && !(await page.isVisible('#txn-line-field')), 'a transfer asks from/to instead of a category');
  await page.selectOption('#txn-from', 'acc-1');
  await page.selectOption('#txn-to', 'acc-2');
  await page.fill('#txn-amount', '200');
  await page.fill('#txn-date', await page.evaluate(() => Engine.isoDate(new Date())));
  await page.click('#txn-submit');
  const trAfter = await page.evaluate(() => { const s = Store.state, t = new Date(); return { tx: s.transactions.find(x => x.type === 'Transferencia'), flow: Engine.cashFlow(s.transactions, t.getFullYear(), t.getMonth() + 1), cash: Engine.cashNow(s.accounts, s.transactions, t).total }; });
  ok(trAfter.tx && trAfter.tx.from === 'acc-1' && trAfter.tx.to === 'acc-2' && /Corriente Pichincha → Ahorros/.test(trAfter.tx.description), 'transfer saved with its accounts and a description', trAfter.tx);
  ok(trAfter.flow.expense === trSetup.flow.expense && trAfter.flow.income === trSetup.flow.income, 'a transfer is neither income nor spending');
  ok(Math.abs(trAfter.cash - (trSetup.cash - 200)) < 0.01, 'moving money to savings lowers cash on hand', [trSetup.cash, trAfter.cash]);
  ok(/→/.test(await page.textContent(`#txn-body [data-row="${trAfter.tx.id}"]`)), 'the list shows the transfer route');
  // Refund of a purchase: lowers what was spent in its category.
  const buy = await page.evaluate(() => Store.state.transactions.filter(t => (t.type || 'Gasto') === 'Gasto' && !t.refund && Number(t.amount) >= 20).sort((a, b) => b.date.localeCompare(a.date))[0]);
  const spentBefore = await page.evaluate(b => { const d = new Date(); return Engine.categorySpend(Store.state.transactions, b.parentCategory, d.getFullYear(), String(d.getMonth() + 1)); }, buy);
  await page.click(`#txn-body [data-action="txn.refund"][data-id="${buy.id}"]`);
  await page.fill('.modal input[name="amount"]', '15');
  await page.click('[data-dialog-ok]');
  const refundRes = await page.evaluate(b => { const d = new Date(); const r = Store.state.transactions.find(t => t.refundOf === b.id); return { r, spent: Engine.categorySpend(Store.state.transactions, b.parentCategory, d.getFullYear(), String(d.getMonth() + 1)) }; }, buy);
  ok(refundRes.r && refundRes.r.refund && refundRes.r.parentCategory === buy.parentCategory, 'refund copies the category of the purchase');
  ok(Math.abs(refundRes.spent - (spentBefore - 15)) < 0.01, 'a refund lowers what was spent this month', [spentBefore, refundRes.spent]);
  await page.selectOption('#txn-type', 'Gasto');
  ok(await page.isVisible('#txn-refund-field'), 'the form offers the refund checkbox for expenses');
  await page.evaluate(() => { const s = Store.state; s.transactions = s.transactions.filter(t => t.type !== 'Transferencia' && !t.refund); s.accounts = []; App.changed({ structural: true, step: true }); });
  await page.evaluate(n => { const s = Store.state; s.recurring = []; s.transactions = s.transactions.filter(t => t.description !== 'Netflix').map(t => { delete t.recurringId; return t; }); App.changed({ structural: true, step: true }); }, nTx0);
  // Goals with a target date + deposit
  await go(page, 'metas');
  const goal2 = '#goal-body tr[data-row="2"]';
  await page.fill(`${goal2} input[data-field="targetDate"]`, await page.evaluate(() => { const d = new Date(); return `${d.getFullYear() + 2}-${String(d.getMonth() + 1).padStart(2, '0')}`; }));
  await page.dispatchEvent(`${goal2} input[data-field="targetDate"]`, 'change');
  ok((await page.textContent(`${goal2} [data-cell="time"]`)).includes('Atrasada'), 'a goal with a date and no budget shows it is behind, with the monthly needed');
  await page.click(`${goal2} [data-action="goal.deposit"]`);
  await page.fill('.modal input[name="amount"]', '500');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.state.goals.find(g => g.id === 2).current) === 500, 'deposit adds to what is saved');
  ok(await page.evaluate(() => Store.state.transactions.some(t => t.budgetLine === 'goal-2' && t.amount === 500)), 'deposit is also logged on the goal line');
  ok((await page.textContent(`${goal2} [data-cell="time"]`)).includes('3%'), 'goal progress bar', await page.textContent(`${goal2} [data-cell="time"]`));
  await page.click('#hist-undo');
  await page.evaluate(() => { delete Store.state.goals.find(g => g.id === 2).targetDate; App.changed({ structural: true, step: true }); });
  // Reports
  await go(page, 'presupuesto/reportes');
  ok((await page.$$eval('#rep-body tr', r => r.length)) >= 2, 'report by category for this month');
  await page.selectOption('#rep-by', 'payment');
  ok((await text(page, 'rep-group-head')) === 'Forma de pago', 'report can group by payment method');
  await page.selectOption('#rep-range', 'custom');
  ok(!(await page.isHidden('#rep-from-field')), 'custom range shows the dates');
  const [dlRep] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="rep.csv"]')]);
  const repCsv = require('fs').readFileSync(await dlRep.path(), 'utf8');
  ok(repCsv.startsWith('﻿') && repCsv.includes('Forma de pago,Transacciones,Total'), 'report downloads as CSV');
  const [dlTx] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="rep.txns"]')]);
  const txCsv = require('fs').readFileSync(await dlTx.path(), 'utf8');
  ok(txCsv.includes('Fecha,Tipo,Descripción') && txCsv.split('\r\n').length > 2, 'transactions of the period download as CSV (re-importable)');
  await page.selectOption('#rep-range', 'this-month');

  // ---- phase 3c: roadmap, debt paid, custom groups, line detail, split
  await go(page, 'metas');
  ok((await page.textContent('#road-kpis')).includes('Libre de deudas') && await page.evaluate(() => UI.chartInstance('road-chart').data.datasets[0].data.length > 10), 'roadmap: net worth today → projected, debt-free date');
  ok((await page.textContent('#road-next')).includes('Paso'), 'roadmap says the next concrete step');
  const bal0 = await page.evaluate(() => Store.state.debts[0].balance);
  await typeInto(page, '#debt-body tr[data-row="1"] input[data-field="balance"]', String(bal0 - 300));
  ok((await page.textContent('#debt-body tr[data-row="1"] [data-cell="payoff"]')).includes('Pagado $300'), 'paying down a debt shows how much is paid', await page.textContent('#debt-body tr[data-row="1"] [data-cell="payoff"]'));
  await typeInto(page, '#debt-body tr[data-row="1"] input[data-field="balance"]', String(bal0));
  // Pagar: interest first, the rest lowers the balance, logged on the debt's line, one undo.
  const payBefore = await page.evaluate(() => ({ d: Object.assign({}, Store.state.debts[0]), n: Store.state.transactions.length }));
  await page.click('#debt-body tr[data-row="1"] [data-action="debt.pay"]');
  await page.fill('.modal input[name="amount"]', '200');
  await page.fill('.modal input[name="interest"]', '20');
  await page.click('[data-dialog-ok]');
  const payAfter = await page.evaluate(() => { const d = Store.state.debts[0]; return { bal: d.balance, hist: d.payments, t: Store.state.transactions[Store.state.transactions.length - 1], n: Store.state.transactions.length, input: document.querySelector('#debt-body tr[data-row="1"] input[data-field="balance"]').value }; });
  ok(Math.abs(payAfter.bal - (payBefore.d.balance - 180)) < 0.01 && Number(payAfter.input) === payAfter.bal, 'a payment lowers the balance by what is left after interest', [payBefore.d.balance, payAfter.bal]);
  ok(payAfter.n === payBefore.n + 1 && payAfter.t.budgetLine === 'debt-1' && payAfter.t.amount === 200 && payAfter.t.parentCategory === 'Deudas', 'the payment is logged on the debt line', payAfter.t);
  ok(payAfter.hist && payAfter.hist.length === 1 && payAfter.hist[0].principal === 180 && payAfter.hist[0].interest === 20, 'the debt keeps its payment history');
  await page.evaluate(() => App.undo());
  ok(await page.evaluate(b => Store.state.debts[0].balance === b.d.balance && Store.state.transactions.length === b.n && !(Store.state.debts[0].payments || []).length, payBefore), 'one undo reverts the payment');
  // Job-loss runway: months it lasts; cutting a line or adding the IESS benefit stretches it.
  await go(page, 'futuro/metas');
  await page.evaluate(() => { document.getElementById('metas-runway').open = true; });
  const months = async () => page.evaluate(() => { const v = document.querySelector('#runway-kpis .kpi-value').textContent; return v.includes('∞') ? Infinity : parseFloat(v); });
  const m0 = await months();
  ok(Number.isFinite(m0) && m0 >= 0 && (await page.textContent('#runway-kpis')).includes('meses'), 'the runway says how many months', m0);
  const firstOn = await page.$eval('#runway-lines input:checked', i => i.dataset.id);
  await page.click(`#runway-lines input[data-id="${firstOn}"]`);
  const m1 = await months();
  ok(m1 > m0, 'cutting a line stretches the runway', [m0, m1]);
  await page.click('#runway-inputs [data-action="runway.iess"]');
  const m2 = await months();
  ok(await page.evaluate(() => Store.state.runway.benefits.length === 5) && m2 > m1, 'the IESS unemployment estimate adds 5 months of benefit', [m1, m2]);
  await page.evaluate(() => { Store.state.runway = { keep: {}, other: null, benefit: 0, benefitMonths: 0, lump: 0 }; App.changed({ structural: true }); });
  // Calculators: a loan's payment, a card that never ends at a too-small payment; nothing saved.
  const calcSnap = await page.evaluate(() => JSON.stringify(Store.state).length);
  await go(page, 'futuro/calculadoras');
  await typeInto(page, '#calc-loan-in [data-key="amount"]', '20000');
  await typeInto(page, '#calc-loan-in [data-key="rate"]', '6');
  await typeInto(page, '#calc-loan-in [data-key="years"]', '5');
  ok((await page.textContent('#calc-loan-out')).includes('$386.66'), 'loan calculator: $20,000 at 6% for 5 years is $386.66/month', await page.textContent('#calc-loan-out'));
  await typeInto(page, '#calc-card-in [data-key="balance"]', '5000');
  await typeInto(page, '#calc-card-in [data-key="rate"]', '24');
  await typeInto(page, '#calc-card-in [data-key="payment"]', '90');
  ok((await page.textContent('#calc-card-out')).includes('Nunca'), 'a card payment below the interest never ends');
  ok(await page.evaluate(() => JSON.stringify(Store.state).length) === calcSnap, 'calculators do not change the plan');
  // Annual bills planner → a monthly set-aside goal → paying a bill from it.
  await go(page, 'presupuesto/plan');
  await page.evaluate(() => { document.getElementById('bud-annual-card').open = true; });
  await page.click('#annual-ideas [data-action="annual.idea"][data-i="0"]');
  await page.click('#annual-ideas [data-action="annual.idea"]');
  const ab = await page.evaluate(() => Store.state.annualBills.map(b => ({ id: b.id, amount: b.amount, every: b.every })));
  ok(ab.length === 2 && (await page.textContent('#annual-summary')).includes('Aparta cada mes'), 'ideas add annual bills and the set-aside appears', ab);
  const need = await page.evaluate(() => Engine.annualSetAside(Store.state.annualBills));
  ok(Math.abs(need - ab.reduce((t, b) => t + b.amount / b.every, 0)) < 0.01, 'set-aside = yearly cost ÷ 12');
  await page.click('#annual-summary [data-action="annual.fund"]');
  const fundGoal = await page.evaluate(() => Store.state.goals.find(g => g.annualFund));
  ok(fundGoal && Math.abs(fundGoal.monthly - need) < 0.01 && await page.$(`#bud-body tr[data-row="goal-${fundGoal.id}"]`) !== null, 'the set-aside becomes a goal line in the budget', fundGoal);
  ok((await page.textContent('#annual-summary')).includes('te faltarían') || (await page.textContent('#annual-summary')).includes('Alcanza'), 'the planner says whether each bill is covered in time');
  // Pay a purchase from the fund: logged, not counted in this month's budget, fund goes down.
  await page.evaluate(id => { Store.state.goals.find(g => g.id === id).current = 500; App.changed({ structural: true }); }, fundGoal.id);
  const spentCat = await page.evaluate(() => { const d = new Date(); return Engine.categorySpend(Store.state.transactions, 'Transporte', d.getFullYear(), String(d.getMonth() + 1)); });
  await page.evaluate(id => { UI.run('goal.spend', { id: String(id), amount: '180', desc: 'Matrícula vehicular', cat: 'Transporte' }); }, fundGoal.id);
  await page.waitForSelector('.modal input[name="amount"]');
  await page.click('[data-dialog-ok]');
  const spent = await page.evaluate(id => { const d = new Date(); return { g: Store.state.goals.find(g => g.id === id).current, t: Store.state.transactions.find(t => t.fromGoal === id), cat: Engine.categorySpend(Store.state.transactions, 'Transporte', d.getFullYear(), String(d.getMonth() + 1)) }; }, fundGoal.id);
  ok(spent.g === 320 && spent.t && spent.t.amount === 180 && spent.t.parentCategory === 'Transporte', 'paying from the fund logs it and lowers the fund', spent);
  ok(Math.abs(spent.cat - spentCat) < 0.01, 'a purchase paid from the fund does not count in this month\'s budget again', [spentCat, spent.cat]);
  await page.evaluate(() => { const s = Store.state; s.goals = s.goals.filter(g => !g.annualFund); s.annualBills = []; s.transactions = s.transactions.filter(t => !t.fromGoal); App.changed({ structural: true, step: true }); });
  // Month close: Overview reminds about last month; the review shows it; closing saves it.
  const lastM = await page.evaluate(() => {
    const t = new Date(), d = new Date(t.getFullYear(), t.getMonth() - 1, 10), iso = Engine.isoDate(d), s = Store.state;
    s.monthCloses = {};
    s.transactions.push({ id: Store.nextId(s.transactions), type: 'Ingreso', description: 'Venta de queso', parentCategory: Object.keys(s.taxonomy.income)[0], category: '', amount: 300, date: iso, paymentType: 'Efectivo' });
    s.transactions.push({ id: Store.nextId(s.transactions), type: 'Gasto', description: 'Cena', parentCategory: 'Alimentación', category: '', amount: 40, date: iso, paymentType: 'Efectivo' });
    App.changed({ structural: true, step: true });
    return { y: d.getFullYear(), m: d.getMonth() + 1, key: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` };
  });
  await go(page, 'resumen');
  ok(await page.$(`#dash-moves [data-action="close.open"][data-m="${lastM.m}"]`) !== null, 'Overview reminds to close last month');
  await page.click(`#dash-moves [data-action="close.open"][data-m="${lastM.m}"]`);
  await page.waitForSelector('.modal-backdrop.sheet');
  const closeTxt = await page.textContent('.modal-backdrop.sheet');
  ok(/Entró/.test(closeTxt) && /Salió/.test(closeTxt) && /Te pasaste en/.test(closeTxt), 'the review shows what came in, went out and the lines', closeTxt.slice(0, 160));
  await page.fill('#close-note', 'Mes tranquilo');
  await page.click('.modal-backdrop.sheet [data-action="close.save"]');
  const closed = await page.evaluate(k => Store.state.monthCloses[k], lastM.key);
  ok(closed && closed.note === 'Mes tranquilo' && typeof closed.leftover === 'number', 'closing saves the month with its note', closed);
  ok(await page.$(`#dash-moves [data-action="close.open"][data-m="${lastM.m}"]`) === null, 'a closed month is not reminded again');
  await page.evaluate(() => App.undo());
  ok(await page.evaluate(k => !Store.state.monthCloses[k], lastM.key), 'closing can be undone');
  await page.evaluate(() => { const s = Store.state; s.transactions = s.transactions.filter(t => t.description !== 'Venta de queso' && t.description !== 'Cena'); s.monthCloses = {}; App.changed({ structural: true, step: true }); });
  await go(page, 'presupuesto/plan');
  await page.selectOption('#budget-month', 'base');
  await page.click('[data-action="budget.layout"][data-layout="simple"]');
  await page.click('[data-action="budget.mode"][data-mode="planned"]');
  await page.click('[data-action="group.add"]');
  await page.fill('.modal input[name="name"]', 'Dar');
  await page.click('[data-dialog-ok]');
  ok(await page.$('#bud-simple [data-group="g:Dar"]') !== null, 'custom group card appears');
  await page.click('#bud-simple [data-group="g:Dar"] [data-action="budget.addRow"]');
  ok(await page.evaluate(() => Store.active().budgetBase.some(i => i.group === 'Dar')), 'lines can be added to the custom group');
  const foodLine = await page.evaluate(() => String(Store.active().budgetBase.find(i => i.linkedCategory === 'Alimentación').id));
  await page.click(`#bud-simple [data-line="${foodLine}"] [data-action="line.detail"]`);
  ok(await page.evaluate(() => !!UI.chartInstance('line-detail-chart') && UI.chartInstance('line-detail-chart').data.labels.length === 12), 'line detail shows its last 12 months');
  await page.selectOption('.sheet select[data-change="line.setGroup"]', 'Dar');
  ok(await page.evaluate(id => Store.active().budgetBase.find(i => String(i.id) === id).group, foodLine) === 'Dar' && await page.$(`#bud-simple [data-group="g:Dar"] [data-line="${foodLine}"]`) !== null, 'a line can be moved to a custom group');
  await page.click('.sheet [data-dialog-cancel]');
  // split an expense across two lines
  await go(page, 'presupuesto/transacciones');
  const comp = await page.evaluate(() => Store.state.transactions.find(t => t.description === 'Compras de la semana').id);
  await page.selectOption(`#txn-body select[data-id="${comp}"]`, '__split');
  await page.selectOption('.modal select[name="line0"]', foodLine);
  await page.fill('.modal input[name="amt0"]', '30');
  const otherLine = await page.evaluate(() => String(Store.active().budgetBase.find(i => i.linkedCategory === 'Transporte').id));
  await page.selectOption('.modal select[name="line1"]', otherLine);
  await page.fill('.modal input[name="amt1"]', '99');
  await page.click('[data-dialog-ok]');
  ok(await page.$('.modal-error:not(.hidden)') !== null, 'a split cannot exceed the amount');
  await page.fill('.modal input[name="amt1"]', '15.5');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(id => JSON.stringify(Store.state.transactions.find(t => t.id === id).splits), comp) === JSON.stringify([{ line: foodLine, amount: 30 }, { line: otherLine, amount: 15.5 }]), 'split saved');
  ok((await page.textContent(`#txn-body [data-row="${comp}"]`)).includes('Dividida en 2'), 'the chip shows the split');
  const sp = await page.evaluate(([a, b]) => { const m = String(new Date().getMonth() + 1); const it = Engine.monthItems(Store.effective(Store.state.activeYear), m); const r = Engine.lineSpend(it, Store.state.transactions, Store.state.activeYear, m); return [r.byLine[a].spent, r.byLine[b].spent]; }, [foodLine, otherLine]);
  ok(sp[0] >= 30 && sp[1] >= 15.5, 'each line counts its part', sp);
  await page.evaluate(id => { const s = Store.state; delete s.transactions.find(t => t.id === id).splits; s.active = undefined; const yd = Store.active(); yd.budgetBase.forEach(i => { delete i.group; }); yd.budgetBase = yd.budgetBase.filter(i => i.name !== 'Nuevo rubro'); yd.groups = []; App.changed({ structural: true, step: true }); }, comp);
  await go(page, 'presupuesto/plan');
  await page.click('[data-action="budget.layout"][data-layout="detailed"]');

  // ---- ingresos: sueldo drives neto; décimo tercero in December
  await go(page, 'presupuesto/ingresos');
  await typeInto(page, '[data-bind="year.sueldo"]', '2500');
  ok((await text(page, 'inc-neto')) === '$2,226.56', 'net salary for $2,500 (2026 SRI table, 18% rebate)', await text(page, 'inc-neto'));
  await page.check('[data-bind="year.d3"]');
  await go(page, 'presupuesto/plan');
  await page.selectOption('#budget-month', '12');
  ok((await text(page, 'bud-income')) === '$4,726.56', 'December income includes décimo tercero', await text(page, 'bud-income'));
  await page.selectOption('#budget-month', 'base');

  // ---- transactions: validation, XSS escaping, undo, custom category dialog
  await go(page, 'presupuesto/transacciones');
  await page.click('[data-action="txn.add"]');
  ok(await page.$('.toast-error') !== null, 'empty transaction shows an error toast (no alert)');
  await page.fill('#txn-description', '<img src=x onerror="window.__xss=1"> Cena "especial"');
  await page.fill('#txn-amount', '32.10');
  await page.click('[data-action="txn.add"]');
  await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__xss) === undefined, 'user text is escaped (no script execution)');
  ok((await page.textContent('#txn-body')).includes('<img src=x'), 'escaped text is shown literally');
  const txnCount = await page.evaluate(() => Store.state.transactions.length);
  await page.click('#txn-body [data-action="txn.delete"]');
  ok(await page.evaluate(() => Store.state.transactions.length) === txnCount - 1, 'transaction deleted');
  await page.click('.toast-action');
  ok(await page.evaluate(() => Store.state.transactions.length) === txnCount, 'transaction undo');
  await page.click('[data-action="txn.addParent"]');
  await page.fill('.modal input[name="name"]', 'Deportes');
  await page.click('[data-dialog-ok]');
  ok(await page.inputValue('#txn-parent') === 'Deportes', 'new category created via dialog and selected');
  // The trend and projected balances moved to Reportes.
  await go(page, 'transacciones/reportes');
  const tchart = () => page.evaluate(() => { const c = UI.chartInstance('txn-trend-chart'); return { type: c.config.type, n: c.data.datasets.length, labels: c.data.labels.length }; });
  ok((await tchart()).type === 'line' && (await tchart()).n === 4 && (await tchart()).labels === 24, 'trend is a line chart of the last 12 months + 12 ahead, income and expenses (actual + projected)', await tchart());
  await page.selectOption('#trend-show', 'expense');
  ok((await tchart()).n === 2, 'trend can show only expenses (actual + projected)');
  await page.click('[data-action="trend.period"][data-period="week"]');
  ok((await tchart()).labels === 20 && (await page.inputValue('#trend-count')) === '12', 'weekly trend: last 12 weeks + 8 ahead', await tchart());
  await page.selectOption('#trend-count', '26');
  ok((await tchart()).labels === 34, 'trend window can be changed');
  await page.click('[data-action="trend.period"][data-period="year"]');
  ok((await tchart()).labels === 7, 'yearly trend: last 5 years + 2 ahead', await tchart());
  ok((await page.$$eval('#trend-table tr', r => r.length)) === 7, 'trend numbers are also in a table');
  await page.click('[data-action="trend.period"][data-period="month"]');
  await page.selectOption('#trend-show', 'both');
  await go(page, 'transacciones/lista');
  // search and budget-line chips (search waits for a pause in typing)
  await page.fill('#txn-search', 'supermaxi');
  await page.dispatchEvent('#txn-search', 'input');
  await page.waitForTimeout(350);
  ok((await page.$$eval('#txn-body .txn-item', r => r.length)) === 1, 'search finds transactions by place', await page.$$eval('#txn-body .txn-item', r => r.length));
  await page.fill('#txn-search', '');
  await page.dispatchEvent('#txn-search', 'input');
  await page.waitForTimeout(350);
  await page.selectOption('#txn-f-type', 'all');

  // ---- metas: goals typing keeps focus (old bug), NPER edge cases, debts
  await go(page, 'metas');
  const goalSel = '#goal-body tr[data-row="1"] input[data-field="monthly"]';
  await typeInto(page, goalSel, '450');
  ok(await page.inputValue(goalSel) === '450' && await focusedMatches(page, goalSel), 'goal field keeps focus while typing (was broken)');
  await typeInto(page, '#goal-body tr[data-row="1"] input[data-field="current"]', '6000');
  ok((await page.textContent('#goal-body tr[data-row="1"] [data-cell="time"]')).includes('alcanzada'), 'reached goal shows "alcanzada" (was negative months)');
  await typeInto(page, '#goal-body tr[data-row="2"] input[data-field="rate"]', '0');
  await typeInto(page, '#goal-body tr[data-row="2"] input[data-field="monthly"]', '250');
  const in80 = await page.evaluate(() => Fmt.monthYear(Engine.addMonths(new Date(), 80)));
  ok((await page.textContent('#goal-body tr[data-row="2"] [data-cell="time"]')).includes(in80), '0% goal rate works (20000/250 = 80 months)', [await page.textContent('#goal-body tr[data-row="2"] [data-cell="time"]'), in80]);
  const freeBefore = await text(page, 'debt-free-date');
  await typeInto(page, '#debt-body tr[data-row="1"] input[data-field="monthly"]', '383');
  ok((await text(page, 'debt-free-date')) !== freeBefore, 'budgeting more for a debt moves the debt-free date', [freeBefore, await text(page, 'debt-free-date')]);
  ok((await text(page, 'debt-pool')).startsWith('$563'), 'plan shows the money the budget sends to debts', await text(page, 'debt-pool'));
  ok(!(await page.getAttribute('#debt-warning', 'class')).includes('hidden') && (await text(page, 'debt-warning')).includes('no está financiado'), 'over-budget plan is flagged as not funded');
  await typeInto(page, '#debt-body tr[data-row="2"] input[data-field="monthly"]', '100');
  ok((await text(page, 'debt-warning')).includes('Préstamo Vehicular') && (await text(page, 'debt-warning')).includes('no cubre el pago mínimo'), 'a debt line below its own minimum is flagged by name');
  await typeInto(page, '#debt-body tr[data-row="2"] input[data-field="monthly"]', '180');
  await page.selectOption('[data-bind="debtPlan.strategy"]', 'avalanche');
  await page.selectOption('[data-bind="debtPlan.strategy"]', 'snowball');
  await page.click('[data-action="goal.add"]');
  ok(await page.evaluate(() => Store.state.goals.at(-1).rate) === 8.5, 'new goal uses the active year DPF rate');

  // ---- ahorro: pólizas drive the projection, COSEDE, coop rename cascade
  await go(page, 'ahorro/polizas');
  await typeInto(page, '#pol-body tr[data-row="1"] input[data-field="amount"]', '40000');
  ok((await page.getAttribute('#cosede-banner', 'class')).includes('tone-red'), 'COSEDE banner turns red over the limit');
  await page.fill('#coop-body tr[data-row="1"] input[data-field="name"]', 'JEP');
  await page.press('#coop-body tr[data-row="1"] input[data-field="name"]', 'Tab');
  ok(await page.evaluate(() => Store.state.polizas[0].coopName) === 'JEP', 'renaming a cooperativa renames its pólizas');
  await go(page, 'ahorro/proyeccion');
  ok((await text(page, 'proj-opening')) === '$43,000', 'projection opening = pólizas capital', await text(page, 'proj-opening'));
  await typeInto(page, '[data-bind="year.tasa"]', '10');
  ok(await page.evaluate(() => Store.active().tasa) === 10, 'DPF rate editable in Ahorro DPF');
  await go(page, 'resumen');
  ok((await text(page, 'dash-alerts')).includes('COSEDE'), 'dashboard alerts COSEDE overage');
  ok(!(await text(page, 'dash-alerts')).includes('no refleja') && await page.evaluate(() => Store.year(new Date().getFullYear()).netWorth.investments) === 43000, 'net worth follows the pólizas with no reminder needed');

  // ---- hipoteca: slider syncs input, extra dataset, system from config
  await go(page, 'hipoteca');
  await page.evaluate(() => { const s = document.getElementById('mort-extra-slider'); s.value = 300; s.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(await page.inputValue('[data-bind="mortgage.extraPayment"]') === '300', 'slider updates the extra payment field');
  ok(await page.evaluate(() => UI.chartInstance('mort-balance-chart').data.datasets.length) === 2, 'balance chart shows the extra-payment line');
  ok((await text(page, 'mort-summary')).includes('Terminas en'), 'summary shows early payoff');
  await go(page, 'config');
  await page.evaluate(() => document.getElementById('cfg-prefs').open = true);
  await page.selectOption('[data-bind="settings.mortgageSystem"]', 'aleman');
  await go(page, 'hipoteca');
  ok((await text(page, 'mort-system')).includes('Alemán'), 'mortgage system set in Configuración applies');

  // ---- jubilación: override + relink, what-if
  await go(page, 'jubilacion');
  ok((await text(page, 'ret-ahorro')) === '$43,000.00', 'retirement savings = pólizas capital', await text(page, 'ret-ahorro'));
  await typeInto(page, '#ret-tasa', '7');
  ok((await text(page, 'ret-tasa-note')).includes('Personalizado'), 'typing sets an override');
  await page.click('[data-action="ret.relink"][data-field="tasaRetorno"]');
  ok(await page.inputValue('#ret-tasa') === '10' && (await text(page, 'ret-tasa-note')).includes('Enlazado'), 'relink restores the linked DPF rate', await page.inputValue('#ret-tasa'));
  await page.evaluate(() => { const s = document.getElementById('ret-whatif'); s.value = 200; s.dispatchEvent(new Event('input', { bubbles: true })); });
  ok(!(await page.getAttribute('#ret-total-delta', 'class')).includes('hidden'), 'what-if shows the income delta');

  // ---- patrimonio: carry-forward, prefill by kind, sell asset via dialog
  await go(page, 'patrimonio');
  await typeInto(page, '[data-input="nw.set"][data-field="checking"]', '1200');
  const nwf = await page.evaluate(() => Engine.netWorthSnapshot(Store.state.years, 2026));
  ok(nwf.creditCards === 1500 && nwf.autoLoans === 6000 && nwf.investments === 43000, 'this year follows the debts by kind (card vs car loan) on its own', nwf);
  ok(await page.evaluate(() => document.querySelector('[data-input="nw.set"][data-field="investments"]').readOnly && !document.querySelector('[data-input="nw.set"][data-field="checking"]').readOnly), 'automatic fields are read-only; the rest stay editable');
  await page.selectOption('#global-year-select', '2027');
  ok(await page.inputValue('[data-input="nw.set"][data-field="checking"]') === '1200', 'balance carries forward to next year');
  ok((await page.textContent('[data-src="checking"]')).includes('Heredado de 2026'), 'inherited value is labeled');
  await page.selectOption('#global-year-select', '2026');
  await page.click('[data-action="asset.sell"]');
  await page.fill('.modal input[name="value"]', '130000');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.state.assets[0].status) === 'Vendido', 'asset sold via dialog (no prompt)');
  await page.click('[data-action="asset.proceeds"]');
  ok(await page.evaluate(() => Engine.netWorthField(Store.state.years, 2026, 'checking')) === 131200, 'sale proceeds added on top of carried balance');

  // ---- config: copy year keeps net worth, baselines, range validation
  await go(page, 'config');
  await page.selectOption('#global-year-select', '2027');
  await go(page, 'config');
  await page.selectOption('#cfg-copy-from', '2026');
  await page.click('[data-action="cfg.copyYear"]');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.state.years[2027].sueldo) === 2500, 'copy year copies sueldo');
  ok(await page.evaluate(() => Store.state.years[2027].netWorthTouched.checking) !== true, 'copy year does not overwrite target net worth');
  await page.selectOption('#global-year-select', '2026');
  await page.click('[data-action="cfg.baseline"]');
  await page.fill('.modal input[name="name"]', 'Antes de cambios');
  await page.click('[data-dialog-ok]');
  await page.evaluate(() => { Store.state.goals = []; App.changed({ structural: true }); });
  await page.click('[data-action="cfg.restoreBaseline"]');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.state.goals.length) > 0, 'baseline restores goals (full snapshot)');
  await page.evaluate(() => document.getElementById('cfg-prefs').open = true);
  await page.fill('#cfg-start', '2060');
  await page.press('#cfg-start', 'Tab');
  ok(await page.evaluate(() => Store.state.configStartYear) === 2020, 'invalid range rejected');

  // ---- autosave + reload keeps everything
  await page.waitForTimeout(600);
  ok((await page.textContent('#save-status')).includes('Guardado'), 'save status shows saved');
  await page.reload();
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => Store.state.years[2026].sueldo) === 2500, 'sueldo persisted across reload');
  ok(await page.evaluate(() => Store.state.debts[0].monthly) === 383, 'debt budget persisted');
  ok(await page.evaluate(() => Store.state.retirement.whatIfExtra) === 200, 'retirement inputs persisted (was lost before)');
  ok(await page.evaluate(() => Store.state.settings.mortgageSystem) === 'aleman', 'settings persisted');

  // ---- hash routing
  await page.goto('file://' + ROOT + '/index.html#ahorro/polizas');
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.querySelector('[data-view="polizas"]').classList.contains('hidden')), 'hash opens the sub-view directly');

  // ---- phase 3d: quick entry, streak, accounts, dark mode, PIN lock
  await go(page, 'resumen');
  const nq = await page.evaluate(() => Store.state.transactions.length);
  await page.click('.fab');
  await page.waitForSelector('#quick-amount');
  for (const k of ['1', '2', '.', '5', '0', '7']) await page.click(`.quick-keys button[data-k="${k}"]`);
  ok(await page.inputValue('#quick-amount') === '12.50', 'quick keypad builds the amount (max 2 decimals)', await page.inputValue('#quick-amount'));
  await page.click('.quick-keys button[data-k="⌫"]');
  await page.click('.quick-keys button[data-k="5"]');
  const chip = await page.evaluate(() => document.querySelectorAll('.quick-chip')[1].dataset.cat);
  await page.click('.quick-chip >> nth=1');
  await page.fill('#quick-note', 'Café de prueba');
  await page.click('#quick-save');
  const qt = await page.evaluate(() => Store.state.transactions[Store.state.transactions.length - 1]);
  ok(await page.evaluate(() => Store.state.transactions.length) === nq + 1 && qt.amount === 12.55 && qt.parentCategory === chip && qt.description === 'Café de prueba' && qt.createdAt, 'quick entry saves a transaction', qt);
  ok(await page.isHidden('#quick-amount'), 'quick entry sheet closes after saving');
  if (await page.$('#dash-today')) ok((await text(page, 'dash-today')).includes('Ya registraste hoy'), 'logging streak counts today', await text(page, 'dash-today'));
  await page.click('.fab');
  await page.waitForSelector('#quick-amount');
  await page.click('#quick-save');
  ok(await page.isVisible('#quick-amount') && await page.evaluate(() => Store.state.transactions.length) === nq + 1, 'quick entry refuses an empty amount');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.querySelector('.modal-backdrop:not(.hidden) [data-dialog-cancel], .modal-backdrop:not(.hidden) .modal-close'); if (b) b.click(); });
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.description !== 'Café de prueba'); App.changed({ structural: true, step: true }); });

  await go(page, 'patrimonio');
  const na = await page.evaluate(() => Store.state.accounts.length);
  await page.click('[data-action="acct.add"]');
  const aid = await page.evaluate(() => Store.state.accounts[Store.state.accounts.length - 1].id);
  await page.fill(`#acct-body tr[data-row="${aid}"] input[data-field="balance"]`, '500');
  await page.dispatchEvent(`#acct-body tr[data-row="${aid}"] input[data-field="balance"]`, 'input');
  ok(await page.evaluate(() => Store.state.accounts.length) === na + 1 && await page.evaluate(id => Store.state.accounts.find(a => a.id === id).balance, aid) === 500, 'an account with a balance can be added by hand');
  const acctSum = await page.evaluate(() => Fmt.money(Store.state.accounts.reduce((t, a) => t + a.balance, 0)));
  ok((await text(page, 'acct-total')) === acctSum && await page.evaluate(() => Store.state.accounts.length) >= 1, 'accounts total adds every balance', [await text(page, 'acct-total'), acctSum]);
  await page.evaluate(id => { Store.state.accounts = Store.state.accounts.filter(a => a.id !== id); App.changed({ structural: true, step: true }); }, aid);

  await go(page, 'config');
  await page.selectOption('#cfg-theme', 'dark');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'dark', 'dark theme applies');
  const bodyBg = await page.evaluate(() => getComputedStyle(document.body).backgroundColor);
  ok(bodyBg === 'rgb(11, 18, 32)', 'dark theme repaints the page', bodyBg);
  ok(await page.evaluate(() => Chart.defaults.color) === '#94a3b8', 'charts use light axis text on dark');
  ok(await page.evaluate(() => !Store.serialize().includes('"theme"')), 'theme is a device setting, not part of the budget/backup');
  await go(page, 'resumen');
  await page.screenshot({ path: OUT + '/dark-resumen.png', fullPage: false });
  await go(page, 'presupuesto/plan');
  await page.click('[data-action="budget.layout"][data-layout="simple"]');
  await page.screenshot({ path: OUT + '/dark-budget.png', fullPage: false });
  await page.click('[data-action="budget.layout"][data-layout="detailed"]');
  await go(page, 'config');
  await page.click('#theme-toggle');
  ok(await page.evaluate(() => document.documentElement.dataset.theme) === 'light' && await page.inputValue('#cfg-theme') === 'light', 'header button switches back to light');

  // PIN lock
  await page.click('#cfg-lock [data-action="device.setPin"]');
  await page.fill('.modal input[name="pin"]', '12');
  await page.fill('.modal input[name="again"]', '12');
  await page.click('[data-dialog-ok]');
  ok(await page.$('.modal-error:not(.hidden)') !== null, 'PIN must be 4 to 8 digits');
  await page.fill('.modal input[name="pin"]', '2468');
  await page.fill('.modal input[name="again"]', '2468');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(400);
  const dev = await page.evaluate(() => JSON.parse(localStorage.getItem('plan_financiero_ec_device')));
  ok(dev.lock && dev.lock.hash.startsWith('pbkdf2:') && !JSON.stringify(dev).includes('2468'), 'PIN stored only as a salted hash', dev);
  ok(await page.evaluate(() => !Store.serialize().includes('pbkdf2')), 'PIN is never in the backup');
  ok((await text(page, 'cfg-lock')).includes('Activado'), 'config shows the lock is on');
  await page.click('[data-action="device.lockNow"]');
  ok(await page.isVisible('#lock-screen') && await page.evaluate(() => getComputedStyle(document.querySelector('.app-header')).visibility) === 'hidden', 'lock screen hides the app');
  await page.fill('#lock-pin', '1111');
  await page.press('#lock-pin', 'Enter');
  await page.waitForTimeout(400);
  ok(await page.isVisible('#lock-screen') && (await page.textContent('#lock-msg')).includes('incorrecto'), 'wrong PIN keeps it locked', await page.textContent('#lock-msg'));
  await page.fill('#lock-pin', '2468');
  await page.press('#lock-pin', 'Enter');
  await page.waitForTimeout(400);
  ok(!(await page.$('#lock-screen')) && await page.evaluate(() => getComputedStyle(document.querySelector('.app-header')).visibility) === 'visible', 'right PIN unlocks');
  await page.click('#cfg-lock [data-action="device.removePin"]');
  await page.fill('.modal input[name="pin"]', '2468');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(400);
  ok(await page.evaluate(() => !Device.hasPin()) && (await text(page, 'cfg-lock')).includes('Desactivado'), 'PIN can be removed with the current PIN');

  // ---- import: column-wide decimal detection, bulk edit, own descriptions, remembered defaults
  await go(page, 'presupuesto/importar');
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/electric.csv'));
  await page.waitForTimeout(200);
  await page.selectOption('#imp-map select[data-key="date"]', '1');
  await page.selectOption('#imp-map select[data-key="amount"]', '3');
  await page.selectOption('#imp-map select[data-key="expensesAre"]', 'positive');
  ok((await page.textContent('#imp-map select[data-key="decimal"] option[value="auto"]')).includes('punto'), 'decimal separator detected from the whole column');
  const amts = await page.$$eval('#imp-rows td.num', els => els.map(e => e.textContent.trim()));
  ok(amts[4] === '−$263.52' && amts[0] === '−$195.27' && !amts.some(a => a.includes(',')), '"263.519" is read as 263.52, not 263,519', amts.slice(0, 6));
  const cat = await page.evaluate(() => Object.keys(Store.state.taxonomy.expense).find(c => Store.state.taxonomy.expense[c].length > 1));
  const sub2 = await page.evaluate(c => Store.state.taxonomy.expense[c][1], cat);
  const line = await page.evaluate(() => Engine.monthItems(Store.effective(Store.state.activeYear), 'base').find(i => i.type !== 'Ingreso'));
  await page.fill('#imp-bulk-desc', 'Luz eléctrica');
  await page.selectOption('#imp-bulk-cat', 'G|' + cat);
  await page.selectOption('#imp-bulk-sub', sub2);
  await page.selectOption('#imp-bulk-line', String(line.id));
  ok((await page.textContent('#imp-bulk-apply')).includes('12 filas'), 'bulk button says how many rows it changes', await page.textContent('#imp-bulk-apply'));
  await page.click('#imp-bulk-apply');
  const descs = await page.$$eval('#imp-rows input.imp-desc', els => els.map(e => e.value));
  const cats = await page.$$eval('#imp-rows select[data-change="imp.cat"]', els => els.map(e => e.value));
  ok(descs.length === 12 && descs.every(d => d === 'Luz eléctrica') && cats.every(c => c === cat), 'one click sets description and category on every row', [descs[0], cats[0]]);
  await page.fill('#imp-rows input.imp-desc[data-i="1"]', 'Luz — mes con visitas');
  await page.dispatchEvent('#imp-rows input.imp-desc[data-i="1"]', 'change');
  ok(await page.inputValue('#imp-rows input.imp-desc[data-i="1"]') === 'Luz — mes con visitas' && await page.inputValue('#imp-rows input.imp-desc[data-i="2"]') === 'Luz eléctrica', 'a single row can still be changed on its own');
  const nE = await page.evaluate(() => Store.state.transactions.length);
  await page.click('#imp-commit');
  const imported = await page.evaluate(() => Store.state.transactions.filter(t => (t.description || '').startsWith('Luz')));
  ok(imported.length === 12 && await page.evaluate(() => Store.state.transactions.length) === nE + 12, 'all rows imported', imported.length);
  ok(imported.every(t => t.parentCategory === cat && t.category === sub2 && t.budgetLine === String(line.id)) && imported.some(t => t.description === 'Luz — mes con visitas') && imported.some(t => t.amount === 263.52), 'imported rows carry the bulk category, subcategory, budget line and own descriptions', imported[1]);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/electric.csv'));
  await page.waitForTimeout(200);
  ok((await page.textContent('#imp-profile-note')).includes('Luz eléctrica'), 'the same kind of file reuses the description/category given to all rows', await page.textContent('#imp-profile-note'));
  ok((await page.textContent('#imp-summary')).includes('0 para importar'), 'and recognizes the rows as already imported', await page.textContent('#imp-summary'));
  await page.click('[data-action="imp.cancel"]');
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => !(t.description || '').startsWith('Luz')); App.changed({ structural: true, step: true }); });

  // ---- manual entry + later bank import: matched, not counted twice
  await page.evaluate(() => {
    const s = Store.state;
    s.transactions = s.transactions.filter(t => !['Supermaxi', 'Cnt Internet', 'Fybeca', 'Juan', 'Retiro de efectivo'].includes(t.description));
    const y = s.activeYear;
    s.transactions.push({ id: 9901, type: 'Gasto', description: 'Súper del mes', parentCategory: 'Alimentación', category: '', amount: 45.5, date: '2026-08-30', paymentType: 'Tarjeta de Débito' });
    s.transactions.push({ id: 9902, type: 'Gasto', description: 'Internet', parentCategory: 'Otros', category: '', amount: 35, date: '2026-09-15', paymentType: 'Efectivo' });
    App.changed({ structural: true, step: true });
  });
  await go(page, 'presupuesto/importar');
  const n0 = await page.evaluate(() => Store.state.transactions.length);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/pichincha.csv'));
  await page.waitForTimeout(250);
  const rowsTxt = await page.textContent('#imp-rows');
  ok(rowsTxt.includes('¿Ya la anotaste?') && rowsTxt.includes('Súper del mes'), 'bank row matched with the hand-typed purchase 2 days earlier', rowsTxt.slice(0, 200));
  ok(!rowsTxt.includes('«Internet»'), 'a hand-typed amount 10 days away is not matched');
  ok((await page.textContent('#imp-summary')).includes('1 parece ser lo que ya anotaste'), 'summary counts the likely matches', await page.textContent('#imp-summary'));
  const matchedIdx = await page.evaluate(() => [...document.querySelectorAll('#imp-rows [data-action="imp.other"]')].map(b => b.dataset.i));
  ok(matchedIdx.length === 1 && !(await page.isChecked(`#imp-rows input[data-change="imp.toggle"][data-i="${matchedIdx[0]}"]`)), 'the matched row starts unchecked');
  await page.click(`#imp-rows [data-action="imp.other"][data-i="${matchedIdx[0]}"]`);
  ok(await page.isChecked(`#imp-rows input[data-change="imp.toggle"][data-i="${matchedIdx[0]}"]`), '"Es otro gasto" includes it');
  await page.click(`#imp-rows [data-action="imp.same"][data-i="${matchedIdx[0]}"]`);
  ok((await page.textContent('#imp-commit')).includes('vincular 1'), 'commit button says it links the match', await page.textContent('#imp-commit'));
  const toImport = await page.evaluate(() => document.querySelectorAll('#imp-rows input[data-change="imp.toggle"]:checked').length);
  await page.click('#imp-commit');
  const after = await page.evaluate(() => ({ n: Store.state.transactions.length, sup: Store.state.transactions.filter(t => t.amount === 45.5 && t.type === 'Gasto' && t.date >= '2026-08-28' && t.date <= '2026-09-03'), manual: Store.state.transactions.find(t => t.id === 9901) }));
  ok(after.n === n0 + toImport && after.sup.length === 1, 'the purchase is not duplicated', [after.n, n0, toImport, after.sup.length]);
  ok(after.manual.importRef && after.manual.description === 'Súper del mes', 'the hand-typed one keeps its text and remembers the bank row', after.manual);
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/pichincha.csv'));
  await page.waitForTimeout(250);
  ok((await page.textContent('#imp-summary')).includes('0 para importar') && !(await page.textContent('#imp-rows')).includes('¿Ya la anotaste?'), 'the next statement treats it as already imported', await page.textContent('#imp-summary'));
  await page.click('[data-action="imp.cancel"]');
  // The other way round: typing something the bank file already brought in.
  await go(page, 'resumen');
  await page.click('.fab');
  await page.waitForSelector('#quick-amount');
  await page.fill('#quick-amount', '22.40');
  await page.dispatchEvent('#quick-amount', 'input');
  const nq2 = await page.evaluate(() => Store.state.transactions.length);
  await page.fill('#quick-date', '2026-09-08');
  await page.click('#quick-save');
  await page.waitForTimeout(150);
  const toastTxt = await page.evaluate(() => [...document.querySelectorAll('#toast-host .toast')].map(t => t.textContent).join(' | '));
  ok(toastTxt.includes('ya importaste') && toastTxt.includes('Fybeca'), 'typing a purchase already imported warns, with undo', toastTxt);
  await page.click('#toast-host .toast-warn .toast-action >> nth=-1');
  ok(await page.evaluate(() => Store.state.transactions.length) === nq2, 'undo from the warning removes the typed one');
  await page.evaluate(() => { const bad = ['Supermaxi', 'Cnt Internet', 'Fybeca', 'Juan', 'Retiro de efectivo']; Store.state.transactions = Store.state.transactions.filter(t => !bad.includes(t.description) && t.id !== 9901 && t.id !== 9902); App.changed({ structural: true, step: true }); });

  // ---- merchant alias rules: rename + category, also for what you already have
  await page.evaluate(() => { Store.state.transactions.push({ id: 9950, type: 'Gasto', description: 'SQ *SQ *COZY COF', parentCategory: 'Otros', category: '', amount: 3.75, date: '2026-09-02', paymentType: 'Tarjeta de Débito', importRef: 'x' }); App.changed({ structural: true, step: true }); });
  await go(page, 'presupuesto/importar');
  await page.click('#imp-rules-card [data-action="rule.add"]');
  await page.fill('.modal input[name="contains"]', 'SQ *COZ');
  await page.fill('.modal input[name="rename"]', 'Cozy Coffee');
  await page.selectOption('.modal select[name="cat"]', 'G|Alimentación');
  await page.click('[data-dialog-ok]');
  await page.waitForSelector('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  ok((await page.textContent('.modal-backdrop:not(.hidden)')).includes('1 transacción que ya tienes'), 'offers to apply the new rule to existing transactions', await page.textContent('.modal-backdrop:not(.hidden) .modal-message'));
  await page.click('.modal-backdrop:not(.hidden) [data-dialog-ok]');
  await page.waitForTimeout(150);
  const cozy = await page.evaluate(() => Store.state.transactions.find(t => t.id === 9950));
  ok(cozy.description === 'Cozy Coffee' && cozy.parentCategory === 'Alimentación', 'existing cryptic transaction renamed and categorized', cozy);
  ok((await page.textContent('#rule-body')).includes('Cozy Coffee'), 'rules table shows the new name');
  await page.setInputFiles('#imp-file', path.join(ROOT, 'tests/fixtures/cafe.csv'));
  await page.waitForTimeout(250);
  ok(await page.inputValue('#imp-rows input.imp-desc[data-i="0"]') === 'Cozy Coffee' && (await page.textContent('#imp-rows')).includes('En el archivo: SQ *SQ *COZY COF') && await page.inputValue('#imp-rows select[data-change="imp.cat"][data-i="0"]') === 'Alimentación', 'imported row renamed and categorized by the rule, original text visible');
  await page.click('#imp-rows [data-action="rule.add"][data-contains="Uber"]');
  ok(await page.inputValue('.modal input[name="contains"]') === 'Uber', 'rule from a row starts with the clean name');
  await page.fill('.modal input[name="contains"]', 'UBER *TRIP');
  await page.fill('.modal input[name="rename"]', 'Uber');
  await page.selectOption('.modal select[name="cat"]', 'G|Transporte');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  if (await page.isVisible('.modal-backdrop:not(.hidden) [data-dialog-cancel]')) await page.click('.modal-backdrop:not(.hidden) [data-dialog-cancel]');
  ok(await page.inputValue('#imp-rows input.imp-desc[data-i="1"]') === 'Uber' && await page.inputValue('#imp-rows select[data-change="imp.cat"][data-i="1"]') === 'Transporte', 'a rule made from a row applies to the preview right away');
  await page.click('[data-action="imp.cancel"]');
  await page.click('.fab');
  await page.waitForSelector('#quick-amount');
  await page.waitForTimeout(120);
  await page.fill('#quick-amount', '2.10'); await page.dispatchEvent('#quick-amount', 'input');
  await page.fill('#quick-note', 'sq *cozy');
  await page.waitForTimeout(50);
  await page.click('#quick-save');
  const qc = await page.evaluate(() => Store.state.transactions[Store.state.transactions.length - 1]);
  ok(qc.description === 'Cozy Coffee' && qc.parentCategory === 'Alimentación', 'quick entry uses the rule name too', qc);
  await page.evaluate(() => { Store.state.transactions = Store.state.transactions.filter(t => t.id !== 9950 && t.description !== 'Cozy Coffee'); Store.state.rules = Store.state.rules.filter(r => !r.rename); App.changed({ structural: true, step: true }); });

  // ---- safe to spend + money calendar
  await go(page, 'resumen');
  const accSnap = await page.evaluate(() => JSON.stringify({ a: Store.state.accounts, p: Store.state.settings.paydays, r: Store.state.recurring, b: Store.state.settings.cashBuffer }));
  await page.evaluate(() => { Store.state.accounts = []; App.changed({ structural: true }); });
  ok((await text(page, 'dash-safe')).includes('Agregar mi saldo'), 'without an account balance the card asks for it');
  await page.evaluate(() => {
    const s = Store.state, t = new Date(), iso = Engine.isoDate;
    s.accounts = [{ id: 1, name: 'Corriente', kind: 'corriente', balance: 1000, updatedAt: iso(t) }, { id: 2, name: 'Ahorros', kind: 'ahorros', balance: 9000, updatedAt: iso(t) }];
    s.settings.paydays = [];
    s.settings.cashBuffer = 0;
    s.recurring = [];
    App.changed({ structural: true });
  });
  const ctx0 = await page.evaluate(() => { const c = Cash.safeContext(new Date()); return { cash: c.res.cash, safe: c.res.safe, bills: c.res.bills, sched: c.res.scheduled, aside: c.res.setAside }; });
  ok(ctx0.cash === 1000 && Math.abs(ctx0.safe - (1000 - ctx0.bills - ctx0.sched - ctx0.aside)) < 0.01, 'safe to spend = checking cash − bills − scheduled − set-aside (savings excluded)', ctx0);
  ok((await text(page, 'safe-amount')).replace(/[^\d−-]/g, '') === String(Math.round(Math.abs(ctx0.safe))).replace(/\B(?=(\d{3})+(?!\d))/g, ''), 'the card shows it', [await text(page, 'safe-amount'), ctx0.safe]);
  await page.fill('.safe-buffer', '200');
  await page.dispatchEvent('.safe-buffer', 'change');
  const ctx1 = await page.evaluate(() => Cash.safeContext(new Date()).res.safe);
  ok(Math.abs(ctx1 - (ctx0.safe - 200)) < 0.01 && await page.evaluate(() => Store.state.settings.cashBuffer) === 200, 'the cushion is editable on the card and lowers it', [ctx1, ctx0.safe]);
  await page.evaluate(() => { Store.state.recurring.push({ id: 77, description: 'Gimnasio', type: 'Gasto', amount: 40, frequency: 'monthly', startDate: Engine.isoDate(new Date(Date.now() + 86400000 * 2)), auto: true, parentCategory: 'Otros' }); Store.state.settings.paydays = [new Date(Date.now() + 86400000 * 10).getDate()]; App.changed({ structural: true }); });
  const ctx2 = await page.evaluate(() => { const c = Cash.safeContext(new Date()); return { sched: c.res.scheduled, until: Engine.isoDate(c.until), names: c.res.items.map(e => e.name) }; });
  ok(ctx2.sched >= 40 && ctx2.names.includes('Gimnasio'), 'a scheduled payment before payday counts', ctx2);
  ok(await page.evaluate(() => !document.getElementById('dash-cal-card').open), 'the money calendar starts folded (shorter Overview)');
  await page.evaluate(() => { document.getElementById('dash-cal-card').open = true; });
  ok(await page.$$eval('#dash-cal .cal-cell:not(.cal-empty)', els => els.length) >= 28, 'calendar shows every day of the month');
  ok(await page.$$eval('#dash-cal .cal-ev.in', els => els.length) >= 1 || await page.evaluate(() => { const d = new Date(Date.now() + 86400000 * 10); return d.getMonth() !== new Date().getMonth(); }), 'payday appears on the calendar');
  ok(await page.$('#dash-cal .cal-cell.today .cal-bal') !== null, 'today has a projected balance');
  await page.evaluate(() => { Store.state.accounts[0].balance = 50; App.changed({ structural: true }); });
  ok(await page.$$eval('#dash-cal .cal-cell.short, #dash-cal .cal-cell.low', els => els.length) > 0 && (await text(page, 'cal-note')).includes('El más ajustado'), 'low-cash days are highlighted with the tightest day named', await text(page, 'cal-note'));
  await page.click('[data-action="cal.move"][data-step="1"]');
  const nextMonth = await page.evaluate(() => { const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + 1); return Fmt.MONTH_NAMES[d.getMonth()]; });
  ok((await text(page, 'dash-cal-month')).startsWith(nextMonth), 'calendar moves to next month', await text(page, 'dash-cal-month'));
  await page.click('[data-action="cal.move"][data-step="-1"]');
  await page.evaluate((snap) => { const o = JSON.parse(snap); Store.state.accounts = o.a; Store.state.settings.paydays = o.p; Store.state.recurring = o.r; Store.state.settings.cashBuffer = o.b || 0; App.changed({ structural: true }); }, accSnap);

  // ---- what-if sandbox
  await go(page, 'resumen');
  const nWi = await page.evaluate(() => JSON.stringify(Store.state).length);
  await page.click('#wi-open');
  await page.waitForSelector('#wi-amount');
  ok((await page.textContent('#wi-results')).includes('Escribe el monto'), 'sandbox asks for an amount first');
  await page.fill('#wi-desc', 'Pasaje'); await page.dispatchEvent('#wi-desc', 'input');
  await page.fill('#wi-amount', '5000'); await page.dispatchEvent('#wi-amount', 'input');
  const wiTxt = await page.textContent('#wi-results');
  ok(await page.$('#wi-budget') && await page.$('#wi-savings') && await page.$('#wi-card'), 'three ways to pay side by side');
  ok((await page.textContent('#wi-budget')).includes('No alcanza') && (await page.textContent('#wi-budget')).includes('Faltan'), 'a purchase bigger than the month says it does not fit', (await page.textContent('#wi-budget')).slice(0, 120));
  ok((await page.textContent('#wi-card')).includes('Cuota mensual') && (await page.textContent('#wi-card')).includes('Libre de deudas'), 'card option shows the installment and the new debt-free date');
  await page.fill('#wi-amount', '20'); await page.dispatchEvent('#wi-amount', 'input');
  ok((await page.textContent('#wi-budget')).includes('Cabe'), 'a small purchase fits the month', (await page.textContent('#wi-budget')).slice(0, 100));
  await page.fill('#wi-rate', '0'); await page.dispatchEvent('#wi-rate', 'input');
  ok((await page.textContent('#wi-card')).includes('sin intereses'), 'rate 0 is a no-interest installment plan');
  ok(await page.evaluate(() => JSON.stringify(Store.state).length) === nWi, 'the sandbox changes nothing');
  await page.click('[data-action="wi.record"]');
  await page.waitForTimeout(100);
  ok(await page.inputValue('#txn-amount') === '20' && await page.inputValue('#txn-description') === 'Pasaje', '"Registrar la compra" only prefills the form', [await page.inputValue('#txn-amount'), await page.inputValue('#txn-description'), await page.evaluate(() => location.hash)]);
  await page.fill('#txn-description', ''); await page.fill('#txn-amount', '');

  // ---- quick entry from a link and the N key
  await go(page, 'resumen');
  await page.evaluate(() => { location.hash = '#rapido'; });
  await page.waitForSelector('#quick-amount', { timeout: 2000 }).catch(() => {});
  ok(await page.isVisible('#quick-amount') && await page.evaluate(() => location.hash) === '#resumen', '#rapido opens quick entry');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.querySelector('.modal-backdrop:not(.hidden) .modal-close, .modal-backdrop:not(.hidden) [data-dialog-cancel]'); if (b) b.click(); });
  await page.waitForTimeout(150);
  await page.evaluate(() => document.activeElement && document.activeElement.blur());
  await page.keyboard.press('n');
  await page.waitForTimeout(150);
  ok(await page.isVisible('#quick-amount'), 'the N key opens quick entry');
  await page.keyboard.type('7');
  ok(await page.inputValue('#quick-amount') === '7', 'and typing goes straight to the amount');
  await page.keyboard.press('Escape');
  await page.evaluate(() => { const b = document.querySelector('.modal-backdrop:not(.hidden) .modal-close, .modal-backdrop:not(.hidden) [data-dialog-cancel]'); if (b) b.click(); });
  await page.waitForTimeout(150);
  await go(page, 'config');
  ok((await page.inputValue('#cfg-quick-link')).endsWith('#rapido'), 'config shows the quick-entry link to save');

  // ---- how you get paid: any rhythm
  const paySnap = await page.evaluate(() => JSON.stringify({ s: Store.state.settings.paySchedule || null, d: Store.state.settings.paydays }));
  await go(page, 'presupuesto/ingresos');
  await page.click('#pay-edit');
  await page.waitForSelector('#ps-freq');
  await page.selectOption('#ps-freq', 'weekly');
  await page.selectOption('#ps-weekday', '5');
  ok((await page.textContent('#pay-describe')).includes('Cada viernes') && (await page.textContent('#pay-per-year')).trim() >= '52', 'weekly on Friday: 52 or 53 paychecks a year', await page.textContent('#pay-per-year'));
  const fridays = await page.$$eval('#pay-next li span', els => els.map(e => e.textContent.trim()));
  ok(fridays.length >= 6 && fridays.filter(f => !f.includes('Décimo')).every(f => f.startsWith('vie')), 'preview lists the next Fridays', fridays.slice(0, 3));
  await page.selectOption('#ps-freq', 'nth');
  await page.click('.ps-nth[data-n="1"]');
  ok((await page.textContent('#pay-describe')).includes('1.º, 2.º y 4.º viernes'), 'choose which weeks of the month', await page.textContent('#pay-describe'));
  await page.click('.ps-nth[data-n="1"]');
  await page.selectOption('#ps-freq', 'biweekly');
  await page.selectOption('#ps-weekday', '4');
  ok((await page.textContent('#pay-describe')).includes('Cada 2 semanas, los jueves') && ['26', '27'].includes((await page.textContent('#pay-per-year')).trim()), 'every 2 weeks on Thursday', await page.textContent('#pay-per-year'));
  await page.selectOption('#ps-freq', 'daily');
  ok((await page.textContent('#pay-describe')).includes('lunes a viernes'), 'daily, working days only');
  await page.fill('#ps-amount', '45'); await page.dispatchEvent('#ps-amount', 'change');
  ok((await page.textContent('#pay-next')).includes('+$45.00'), 'a fixed amount per payment can be given');
  await page.selectOption('#ps-freq', 'monthly');
  await page.fill('#ps-days', '10'); await page.dispatchEvent('#ps-days', 'change');
  await page.selectOption('#ps-interval', '3');
  ok((await page.textContent('#pay-describe')).includes('El día 10, cada 3 meses') && (await page.textContent('#pay-per-year')).trim() === '4', 'quarterly', await page.textContent('#pay-describe'));
  await page.fill('#ps-amount', ''); await page.dispatchEvent('#ps-amount', 'change');
  await page.selectOption('#ps-freq', 'weekly');
  await page.selectOption('#ps-weekday', '5');
  await page.click('#pay-save');
  await page.waitForTimeout(150);
  const saved = await page.evaluate(() => Store.state.settings.paySchedule);
  ok(saved && saved.freq === 'weekly' && saved.weekday === 5 && saved.interval === 1, 'schedule saved', saved);
  ok((await text(page, 'pay-summary')).startsWith('Cada viernes') && (await text(page, 'pay-summary')).includes('Próximo: vie'), 'summary shows the rhythm and the next payday', await text(page, 'pay-summary'));
  await go(page, 'resumen');
  const calPays = await page.$$eval('#dash-cal .cal-ev.in', els => els.map(e => e.closest('.cal-cell').dataset.date));
  ok(calPays.length >= 4 && calPays.every(d => new Date(d + 'T12:00').getDay() === 5), 'the calendar shows paydays every Friday', calPays);
  const nextFri = await page.evaluate(() => { const c = Cash.safeContext(new Date()); return [c.until.getDay(), c.hasPaydays]; });
  ok(nextFri[0] === 5 && nextFri[1], 'safe to spend counts until next Friday', nextFri);
  await page.click('#hist-undo');
  ok(await page.evaluate(() => !Store.state.settings.paySchedule || Store.state.settings.paySchedule.freq !== 'weekly'), 'undo restores the previous schedule');
  await go(page, 'presupuesto/transacciones');
  ok(await page.$('#txn-repeat option[value="quarterly"]') !== null && await page.$('#txn-repeat option[value="semiannual"]') !== null, 'other incomes and bills can repeat every 3 or 6 months');
  await page.evaluate((snap) => { const o = JSON.parse(snap); Store.state.settings.paySchedule = o.s; Store.state.settings.paydays = o.d; App.changed({ structural: true }); }, paySnap);

  // ---- forecast: trend lines ahead + projected balances
  const fcSnap = await page.evaluate(() => JSON.stringify({ s: Store.state.settings.paySchedule || null, a: Store.state.accounts }));
  await page.evaluate(() => { Store.state.settings.paySchedule = { freq: 'weekly', weekday: 5, interval: 2, anchor: '2026-10-09' }; Store.state.accounts = [{ id: 1, name: 'C', kind: 'corriente', balance: 900, updatedAt: Engine.isoDate(new Date()) }]; App.changed({ structural: true }); });
  await go(page, 'transacciones/reportes');
  await page.click('[data-action="trend.period"][data-period="month"]');
  ok(await page.inputValue('#trend-ahead') === '12', 'trend looks 12 months ahead by default');
  const ds = await page.evaluate(() => UI.chartInstance('txn-trend-chart').data.datasets.map(d => [d.label, d.data.filter(v => v !== null).length, !!d.borderDash]));
  ok(ds.some(d => d[0] === 'Ingresos (proyección)' && d[1] === 13 && d[2]) && ds.some(d => d[0] === 'Gastos (proyección)'), 'projected income and expenses drawn dashed for the next 12 months', ds);
  const fIncome = await page.evaluate(() => UI.chartInstance('txn-trend-chart').data.datasets.find(d => d.label === 'Ingresos (proyección)').data.filter(v => v !== null).slice(1).reduce((a, b) => a + b, 0));
  const yearly = await page.evaluate(() => Engine.payroll(Store.effective(Store.state.activeYear)).netoM * 12);
  ok(Math.abs(fIncome - yearly) < yearly * 0.1, 'a year of projected salary ≈ 12 months of net pay (+ other planned income)', [fIncome, yearly]);
  ok((await text(page, 'trend-future-kpi')).includes('Entran'), 'projection summary');
  ok((await page.textContent('#trend-table')).includes('proyección'), 'table marks projected rows');
  await page.selectOption('#trend-ahead', '24');
  ok(await page.evaluate(() => UI.chartInstance('txn-trend-chart').data.labels.length) === 12 + 24, 'the horizon can be changed (24 months)');
  await page.selectOption('#trend-basis', 'history');
  ok((await text(page, 'trend-note')).includes('historial'), 'expenses can follow history instead of the plan');
  await page.selectOption('#trend-basis', 'plan');
  await page.click('[data-action="trend.period"][data-period="week"]');
  ok(await page.evaluate(() => UI.chartInstance('txn-trend-chart').data.datasets.find(d => d.label === 'Ingresos (proyección)').data.filter(v => v > 0).length) >= 3, 'weekly view shows paydays in their weeks');
  await page.click('[data-action="trend.period"][data-period="month"]');
  ok(await page.evaluate(() => UI.chartInstance('bal-forecast-chart').data.datasets.length) === 3 && (await text(page, 'bal-forecast-kpis')).includes('Deudas'), 'projected balances: cash, savings, debts');
  const debtsEnd = await page.evaluate(() => { const d = UI.chartInstance('bal-forecast-chart').data.datasets[2].data; return [d[0], d[d.length - 1]]; });
  ok(debtsEnd[1] < debtsEnd[0], 'debts go down along the payoff plan', debtsEnd);
  await page.selectOption('#trend-ahead', '0');
  ok(await page.isVisible('#bal-forecast-empty'), 'no projection when "Sin proyección"');
  await page.selectOption('#trend-ahead', '12');
  await page.evaluate((snap) => { const o = JSON.parse(snap); Store.state.settings.paySchedule = o.s; Store.state.accounts = o.a; App.changed({ structural: true }); }, fcSnap);

  // ---- paycheck deductions: scan, review, link to debts, retirement
  const dedSnap = await page.evaluate(() => JSON.stringify({ y: Store.active().payDeductions, s: Store.active().sueldo, l: Store.active().lastPaystub || null, d: Store.state.debts }));
  await go(page, 'presupuesto/ingresos');
  await page.evaluate(() => { Store.active().sueldo = 1500; Store.active().payDeductions = []; App.changed({ structural: true }); });
  const net0 = await page.evaluate(() => App.buildContext().pay.netoM);
  await page.evaluate(() => PayScan.fromText(`ROL DE PAGOS - SEPTIEMBRE 2026\nPeriodo: 01/09/2026 - 30/09/2026\nSueldo  1.500,00\nTotal ingresos  1.500,00\nAporte personal IESS 9,45%  141,75\nPréstamo quirografario IESS  85,20\nPensión alimenticia  200,00\nSeguro de vida  12,00\nAhorro voluntario jubilación  50,00\nTotal egresos  488,95\nLíquido a recibir  1.011,05`));
  await page.waitForSelector('#scan-save');
  ok(!(await page.isChecked('.scan-inc[data-i="0"]')) && (await page.textContent('.modal-backdrop:not(.hidden)')).includes('Ya lo calcula la app'), 'IESS on the stub is recognized as already computed');
  ok((await text(page, 'scan-check')).includes('Coinciden'), 'stub net matches what the app computes with these deductions', await text(page, 'scan-check'));
  await page.click('#scan-save');
  const ded = await page.evaluate(() => Store.active().payDeductions.map(d => [d.name, d.group, d.monthly]));
  ok(ded.length === 4 && ded.some(d => d[1] === 'garnishment' && d[2] === 200) && ded.some(d => d[1] === 'retirement' && d[2] === 50), 'deductions saved by type, per month', ded);
  const net1 = await page.evaluate(() => App.buildContext().pay.netoM);
  ok(Math.abs(net0 - net1 - 347.2) < 0.01, 'net salary of the budget goes down by the deductions', [net0, net1]);
  ok((await text(page, 'ded-kpis')).includes('$50.00') && (await page.evaluate(() => App.buildContext().retirementMonthly)) >= 50, 'voluntary retirement savings count for retirement');
  ok((await text(page, 'ded-last')).includes('Coincide'), 'last stub is compared with the computed net');
  const loanId = await page.evaluate(() => Store.active().payDeductions.find(d => d.group === 'loan').id);
  const debtId = await page.evaluate(() => { Store.state.debts.push({ id: 77, name: 'Préstamo IESS', kind: 'personal', balance: 2000, rate: 9, minPayment: 85.2, monthly: 85.2, createdYear: 2020 }); App.changed({ structural: true }); return 77; });
  ok(await page.evaluate(() => Engine.monthItems(Store.effective(Store.state.activeYear), 'base').some(i => i.id === 'debt-77')), 'a debt is a budget line before linking');
  await page.selectOption(`select[data-change="ded.debt"][data-id="${loanId}"]`, String(debtId));
  ok(await page.evaluate(() => !Engine.monthItems(Store.effective(Store.state.activeYear), 'base').some(i => i.id === 'debt-77')), 'a loan paid by payroll is no longer a budget line (no double counting)');
  ok(await page.evaluate(() => Store.state.debts.find(d => d.id === 77).monthly) === 85.2, 'the debt plan uses the payroll amount');
  await page.click('[data-action="ded.add"]');
  await page.fill('.modal input[name="name"]', 'Cuota sindical');
  await page.fill('.modal input[name="monthly"]', '8');
  await page.click('[data-dialog-ok]');
  ok(await page.evaluate(() => Store.active().payDeductions.some(d => d.name === 'Cuota sindical' && d.monthly === 8)), 'a deduction can be added by hand');
  // A US stub, read the same way.
  await page.evaluate(() => PayScan.fromText(`Pay Period: 09/14/2026 - 09/27/2026  Pay Date: 10/02/2026\nGross Pay  2,000.00  38,000.00\nFederal Income Tax  182.40\nSocial Security  117.80\nMedicare  27.55\nMI State Income Tax  73.10\n401(k) Pre-Tax  120.00\nMedical PPO  85.00\nER 401K Match  60.00\nNet Pay  1,394.15`));
  await page.waitForSelector('#scan-ppy');
  ok(await page.inputValue('#scan-ppy') === '26', 'a 14-day pay period means every 2 weeks');
  ok((await page.$$('.scan-inc')).length === 7, 'US stub: taxes, 401k, medical and the employer match are read', (await page.$$('.scan-inc')).length);
  await page.click('[data-action="scan.cancel"]');
  await page.evaluate((snap) => { const o = JSON.parse(snap); const y = Store.active(); y.payDeductions = o.y; y.sueldo = o.s; if (o.l) y.lastPaystub = o.l; else delete y.lastPaystub; Store.state.debts = o.d; App.changed({ structural: true }); }, dedSnap);

  // ---- SRI personal expenses: spent vs. invoiced by SRI category, the rebate earned, "con factura"
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  const sriTxt = await page.textContent('#inc-sri-tracker');
  // Late in the year the example family's invoices pass the cap: then there's nothing missing to ask for.
  ok(/Alimentación/.test(sriTxt) && /Salud/.test(sriTxt) && /Rebaja ganada hasta hoy/.test(sriTxt) && (/sin factura a tu nombre/.test(sriTxt) || /100%/.test(sriTxt)), 'the tracker shows SRI categories, the rebate and the invoices missing (or the cap reached)', sriTxt.slice(0, 200));
  const sriInv = () => page.evaluate(() => { const c = App.buildContext(); return Engine.sriPersonalExpenses(Store.state.transactions, Store.state.activeYear, { cap: c.pay.sriCap }).invoiced; });
  const inv0 = await sriInv();
  await go(page, 'transacciones/lista');
  await page.click('#txn-select-toggle');
  await page.click('#txn-bulk-all');
  await page.click('[data-action="txn.bulkFactura"]');
  await page.waitForTimeout(150);
  ok(await sriInv() > inv0, 'bulk «Con factura» raises the invoiced total', [inv0, await sriInv()]);
  await page.click('#txn-bulk .bulk-close');
  await page.evaluate(() => { document.getElementById('txn-form-card').open = true; });
  ok(await page.isVisible('#txn-factura-field'), 'the transaction form has a «con factura» box in Ecuador');

  // ---- prepay the mortgage or invest (Ecuador: a DPF rate as the return, no gains tax field)
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/hipoteca'); });
  await page.waitForTimeout(200);
  const ppEc = (await page.textContent('#mort-prepay')).replace(/\s+/g, ' ');
  ok(/Abonando \$[\d,]+ al mes/.test(ppEc) && /Invirtiendo/.test(ppEc) && /(Abonar a la casa deja|invertir dejaría)/.test(ppEc) && await page.$$eval('#mort-prepay-in input', a => a.length) === 3, 'prepay or invest in Ecuador', ppEc.slice(0, 300));

  // ---- rate sensitivity (Ecuador): the mortgage at ±1 point, pólizas renewing 1 point lower
  await page.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); App.go('futuro/hipoteca'); });
  await page.waitForTimeout(200);
  ok(/1 punto menos · 5%/.test(await page.textContent('#mort-rates')) && /BIESS/.test(await page.textContent('#mort-rates')), 'mortgage at ±1 point (Ecuador)');
  await go(page, 'ahorro/polizas');
  await page.waitForTimeout(150);
  ok(/Si al renovarlas la tasa baja 1 punto/.test(await page.textContent('#pol-rate-risk')), 'pólizas renewing 1 point lower');

  // ---- English / Spanish
  await go(page, 'config');
  await page.selectOption('#cfg-lang', 'en');
  await page.waitForTimeout(150);
  const navEn = await page.$$eval('#main-nav .nav-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(navEn[0].includes('Overview') && navEn[3].includes('Future') && navEn[4].includes('Net Worth'), 'English: navigation translated', navEn);
  ok((await page.textContent('#cfg-device')).includes('This device') && await page.evaluate(() => document.documentElement.lang) === 'en', 'English: page text and lang attribute');
  await go(page, 'transacciones/reportes');
  ok(await page.evaluate(() => UI.chartInstance('txn-trend-chart').data.datasets.some(d => d.label === 'Income (projection)')), 'English: chart labels translated');
  ok(await page.evaluate(() => Fmt.MONTH_NAMES[0]) === 'January', 'English: month names');
  await page.evaluate(() => UI.toast('Transacción eliminada (está en "Eliminadas recientemente")'));
  await page.waitForTimeout(80);
  ok((await page.textContent('#toast-host')).includes('Transaction deleted'), 'English: toasts translated as they appear');
  ok(await page.evaluate(() => !Store.serialize().includes('"lang"')), 'language is a device setting, not in the backup');
  await go(page, 'config');
  await page.selectOption('#cfg-lang', 'es');
  await page.waitForTimeout(150);
  const navEs = await page.$$eval('#main-nav .nav-tab', els => els.map(e => e.textContent.replace(/\s+/g, ' ').trim()));
  ok(navEs[0].includes('Resumen') && (await page.textContent('#cfg-device')).includes('Este dispositivo') && await page.evaluate(() => Fmt.MONTH_NAMES[0]) === 'Enero', 'back to Spanish restores everything', navEs);

  // ---- legacy backup import
  await go(page, 'config');
  await page.setInputFiles('#cfg-file', ROOT + '/tests/fixtures/v7-backup.json');
  await page.waitForSelector('[data-dialog-ok]');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(200);
  ok(await page.evaluate(() => Store.state.years[2026].sueldo) === 2200, 'old-format backup restores sueldo');
  ok(await page.evaluate(() => Store.state.assets.some(a => a.name === 'Carro')), 'old-format backup restores assets');
  ok(await page.evaluate(() => window.__xss) === undefined, 'malicious text inside a backup is not executed');
  await go(page, 'presupuesto/transacciones');
  ok(await page.evaluate(() => window.__xss) === undefined, 'backup transactions render escaped');

  // ---- backup download is valid JSON of the current state
  await go(page, 'config');
  const [dl] = await Promise.all([page.waitForEvent('download'), page.click('[data-action="cfg.download"]')]);
  const dlPath = await dl.path();
  const backup = JSON.parse(fs.readFileSync(dlPath, 'utf8'));
  ok(backup.version === 8 && backup.years && backup.retirement, 'downloaded backup is complete v8 JSON');
  await go(page, 'resumen');
  ok(!(await text(page, 'dash-alerts')).includes('copia de respaldo'), 'backup reminder clears after downloading');
  ok(await page.evaluate(() => Store.state.settings.welcomeDismissed) === true, 'welcome dismissal is saved');
  await go(page, 'config');

  // ---- purge
  await page.evaluate(() => localStorage.setItem('other-app', 'keep'));
  await page.click('[data-action="cfg.purge"]');
  await page.fill('.modal input[name="word"]', 'borrar');
  await page.click('[data-dialog-ok]');
  ok(await page.$('.modal-error:not(.hidden)') !== null, 'purge requires the exact word');
  await page.fill('.modal input[name="word"]', 'eliminar');
  await page.click('[data-dialog-ok]');
  await page.waitForTimeout(150);
  const doneBox = await page.textContent('.modal');
  ok(/Tus datos fueron borrados/.test(doneBox) && await page.$$eval('.modal [data-dialog-cancel]', a => a.length) === 0, 'after erasing, a box confirms the data is gone (OK only)', doneBox);
  await page.click('[data-dialog-ok]');
  ok(await page.$('.modal') === null, 'the confirmation box closes');
  const counts = await page.evaluate(() => ['polizas', 'goals', 'debts', 'assets', 'transactions', 'baselines'].map(k => Store.state[k].length));
  ok(counts.every(c => c === 0), 'purge clears every personal list', counts);
  ok(await page.evaluate(() => localStorage.getItem('other-app')) === 'keep', 'purge leaves other sites/apps data alone');
  ok((await text(page, 'dash-hero')).includes('Paso 1'), 'empty model starts at baby step 1');

  // ---- every view renders on an empty model without errors
  for (const k of ['presupuesto/plan', 'presupuesto/ingresos', 'presupuesto/transacciones', 'metas', 'ahorro/proyeccion', 'ahorro/polizas', 'hipoteca', 'jubilacion', 'patrimonio', 'config', 'resumen']) await go(page, k);

  // ---- mobile: no horizontal overflow, compact header
  await page.setViewportSize({ width: 390, height: 844 });
  for (const k of ['resumen', 'presupuesto/plan', 'metas', 'patrimonio', 'config']) {
    await go(page, k);
    await page.waitForTimeout(250);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const culprits = overflow > 0 ? await page.evaluate(() => [...document.querySelectorAll('body *')].filter(e => e.getBoundingClientRect().right > innerWidth + 1 && e.offsetParent !== null && !e.closest('.table-wrap, #main-nav, .segmented, .bs-card')).slice(0, 4).map(e => e.tagName + '#' + e.id + '.' + String(e.className).slice(0, 50) + ' ' + (e.textContent || '').trim().slice(0, 40))) : [];
    const diag = overflow > 0 ? await page.evaluate(() => { const l = document.querySelector('#imp-csv-card label.btn'); const sec = l.closest('section'); return [sec && sec.dataset.tab, sec && sec.className, l.closest('[data-view]').className, JSON.stringify(l.getBoundingClientRect()), scrollX]; }) : null;
    ok(overflow <= 0, `no horizontal page scroll on mobile (${k})`, [overflow, culprits, diag]);
  }
  const headerH = await page.evaluate(() => document.querySelector('.app-header').getBoundingClientRect().height);
  ok(headerH < 130, 'mobile header is compact', headerH);

  ok(errors.length === 0, 'no console/page errors', errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
