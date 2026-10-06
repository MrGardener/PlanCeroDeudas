// Smart CSV import (US): engine guesses, per-row edits, income streams, rules, re-import.
// Runs inside e2e-us.js (shared page); `node tests/e2e/e2e-imp.js` runs it alone.
// Fixtures are invented: tests/fixtures/us-bank.csv and us-card.csv.
const path = require('path');
const { openApp, ROOT } = require('./harness');
const BANK = path.join(ROOT, 'tests/fixtures/us-bank.csv'), CARD = path.join(ROOT, 'tests/fixtures/us-card.csv');

module.exports = async function run(page, ok) {
  await page.setViewportSize({ width: 1366, height: 900 });
  await page.evaluate(() => { Store.reset('empty'); Store.state.members = [{ id: 1, name: 'Ana', color: '#2a78d6' }, { id: 2, name: 'Luis', color: '#eb6834' }]; App.changed({ structural: true }); App.go('transacciones/importar'); });
  await page.waitForTimeout(150);
  await page.setInputFiles('#imp-file', BANK);
  await page.waitForTimeout(700);
  const S = () => page.evaluate(() => { const s = ImportSession.get(); return { rows: s.rows.map(r => ({ date: r.date, type: r.type, d: r.description, c: r.category, sub: r.sub, m: r.memberId, inc: r.incomeId, nl: r.newLine, x: r.countAsExtra, conf: r.conf, why: r.why })), streams: s.streamList.map(x => [x.name, x.cfg.mode]), sugg: s.suggest.map(g => g.key) }; });
  let s = await S();
  const n = s.rows.length;
  ok(n > 100 && s.rows.every(r => r.date) && s.rows.some(r => r.date === '2025-07-11' && r.d === 'Acme Tools') && s.rows.some(r => r.date === '2025-07-31'), 'US file: month-first dates', s.rows.slice(0, 3));
  const fid = s.rows.find(r => r.d === 'Fidelity');
  ok(fid && fid.c === 'Ahorro e Inversión' && fid.sub === 'Inversiones (bolsa)' && s.rows.some(r => r.d === 'First Bank Mortgage' && r.sub === 'Hipoteca'), 'clean names; Fidelity → investing; mortgage', fid);
  ok(s.rows.filter(r => /Credit Card Payment|Rent share|new couch/i.test(r.d)).every(r => r.type === 'Transferencia'), 'card payments and transfers are transfers');
  ok(s.rows.filter(r => r.d === 'Acme Tools' || r.d === 'Globex').every(r => r.type === 'Ingreso' && r.sub === 'Sueldo/Salario'), 'both paychecks recognized as salary (Globex by its later PAYROLL rows)');
  ok(JSON.stringify(s.streams.map(x => x[0]).sort()) === JSON.stringify(['Acme Tools', 'Globex', 'Initech']), 'income streams: one per payer', s.streams);
  // Row edits: subcategory, person, type.
  const vi = s.rows.findIndex(r => r.d === 'Fidelity');
  await page.selectOption(`#imp-rows select[data-change="imp.sub"][data-i="${vi}"]`, '401(k) / IRA');
  await page.waitForTimeout(150);
  const ci = s.rows.findIndex(r => r.d === 'City Power');
  await page.selectOption(`#imp-rows select[data-change="imp.who"][data-i="${ci}"]`, '2');
  await page.waitForTimeout(150);
  const wi = s.rows.findIndex(r => r.d === 'Withdrawal' && r.type === 'Gasto');
  await page.selectOption(`#imp-rows select[data-change="imp.type"][data-i="${wi}"]`, 'Transferencia');
  await page.waitForTimeout(150);
  s = await S();
  ok(s.rows[vi].sub === '401(k) / IRA' && s.rows[ci].m === 2 && s.rows[wi].type === 'Transferencia', 'each row can be changed on its own: subcategory, person, type', [s.rows[vi].sub, s.rows[ci].m, s.rows[wi].type]);
  // Streams: Globex is Luis's paycheck (a new budget income), Acme is Ana's main paycheck.
  await page.selectOption('#imp-streams select[data-change="imp.streamWho"][data-k="globex"]', '2');
  await page.waitForTimeout(150);
  await page.selectOption('#imp-streams select[data-change="imp.streamWho"][data-k="acme tools"]', '1');
  await page.waitForTimeout(150);
  s = await S();
  const gx = s.rows.filter(r => r.d === 'Globex'), ac = s.rows.filter(r => r.d === 'Acme Tools');
  ok(gx.every(r => r.m === 2 && r.nl === 'Globex' && r.x) && ac.every(r => r.m === 1 && !r.x && !r.nl), 'streams: whose paycheck, main vs. a new budget income', [gx[0], ac[0]]);
  ok(s.sugg.includes('Globex') && s.sugg.includes('Acme Tools'), 'rules suggested for the payers', s.sugg);
  // Which account the file is from (step 6): a new checking account.
  await page.selectOption('#imp-ofx-account select', 'new:corriente');
  await page.waitForTimeout(150);
  await page.click('[data-action="imp.commit"]');
  await page.waitForTimeout(400);
  const acct = await page.evaluate(() => { const a = Store.state.accounts.find(x => x.kind === 'corriente'); return { a, n: Store.state.transactions.filter(t => t.accountId === a.id).length, rows: ImportSession.get() }; });
  ok(acct.a && acct.n > 100 && Number.isFinite(acct.a.balance), 'imported into a new checking account: every transaction remembers it, the account has a balance', acct.a);
  const after = await page.evaluate(() => ({ n: Store.state.transactions.length, rules: Store.state.rules.map(r => ({ c: r.contains, m: r.memberId, mode: r.incomeMode, inc: r.incomeId })), lines: Store.active().otherIncomes.map(l => [l.id, l.name, l.amount]), y: String(Store.state.activeYear),
    gx: Store.state.transactions.filter(t => t.description === 'Globex').map(t => [t.date.slice(0, 4), t.incomeId, t.countAsExtra, t.memberId]), fid: Store.state.transactions.find(t => t.description === 'Fidelity' && t.category === '401(k) / IRA'), sub: Store.state.taxonomy.expense['Ahorro e Inversión'].includes('Inversiones (bolsa)'), toast: [...document.querySelectorAll('.toast')].map(t => t.textContent).join('|') }));
  const line = after.lines.find(l => l[1] === 'Globex');
  ok(after.n === n && line && line[2] > 0, 'imported, and Globex became an income line in the budget', [after.n, after.lines]);
  ok(after.gx.every(([y, inc, x, m]) => x && m === 2 && (y === after.y ? inc === line[0] : !inc)), "this year's Globex deposits are linked to that line (earlier ones count as extra)", after.gx.slice(-2));
  const rg = after.rules.find(r => r.c === 'Globex'), ra = after.rules.find(r => r.c === 'Acme Tools');
  ok(rg && rg.m === 2 && rg.mode === 'line' && rg.inc === line[0] && ra && ra.m === 1 && ra.mode === 'main', 'rules remember whose paycheck and where it goes', after.rules);
  ok(!!after.fid && after.sub, 'row edits are kept; new subcategory added to the list');
  ok(/rule/.test(after.toast) && /new income line/.test(after.toast), 'the message says rules and income lines were added', after.toast);
  // Same file again: everything is already there; the rules categorize.
  await page.setInputFiles('#imp-file', BANK);
  await page.waitForTimeout(700);
  const again = await page.evaluate(() => { const s = ImportSession.get(); return { dup: s.rows.filter(r => r.dup).length, include: s.rows.filter(r => r.include).length, gx: s.rows.find(r => r.description === 'Globex'), streams: s.streamList.map(x => [x.name, x.cfg.mode, x.cfg.lineId, x.cfg.memberId]) }; });
  ok(again.dup === n && again.include === 0, 'importing the same file again: all already there', [again.dup, again.include]);
  // The account remembers its last import (step 7): the same file again is all "before last import".
  const lastImp = await page.evaluate(() => { const a = Store.state.accounts.find(x => x.kind === 'corriente'), s = ImportSession.get(); return { last: a.lastImport, account: s.account, before: s.rows.filter(r => r.before).length, n: s.rows.length, max: s.rows.reduce((d, r) => (r.date > d ? r.date : d), ''), banner: document.getElementById('imp-ofx-account').textContent }; });
  ok(lastImp.last === lastImp.max && lastImp.account && lastImp.before === lastImp.n && /Last import into this account/.test(lastImp.banner), 'the account remembers the last imported date; the same file again is all before it', [lastImp.last, lastImp.before, lastImp.n]);
  ok(/rule/.test(again.gx.why) && again.gx.memberId === 2 && again.streams.find(x => x[0] === 'Globex')[1] === 'line', 'next time the rules do it: Globex → Luis, budget line', again.streams);
  await page.click('[data-action="imp.cancel"]');
  // Phone: the review list is cards, no sideways scroll; card file by category code.
  await page.setViewportSize({ width: 390, height: 844 });
  await page.setInputFiles('#imp-file', CARD);
  await page.waitForTimeout(900);
  const ph = await page.evaluate(() => { const rs = ImportSession.get().rows; return { over: document.documentElement.scrollWidth - innerWidth, row: getComputedStyle(document.querySelector('#imp-rows tr')).display,
    amazon: rs.filter(r => r.description === 'Amazon' && r.sub !== 'Streaming de Video').every(r => r.conf === 'low'), prime: rs.some(r => r.description === 'Amazon' && r.sub === 'Streaming de Video'),
    meijer: rs.filter(r => r.description === 'Meijer').map(r => r.sub), payments: rs.filter(r => /Credit Card Payment/.test(r.description)).every(r => r.type === 'Transferencia') }; });
  ok(ph.over <= 0 && ph.row === 'grid', 'phone: review rows are cards, no sideways scroll', ph.over);
  ok(ph.amazon && ph.prime && ph.meijer.includes('Mercado/Supermercado') && ph.meijer.includes('Gasolina/Diesel') && ph.payments, 'card file: Amazon asks (Prime Video is streaming), Meijer groceries vs. gas by category code, payments are transfers', ph);
  // The card file goes into a new credit card: what you owe is below $0, purchases are card payments.
  await page.selectOption('#imp-ofx-account select', 'new:tarjeta');
  await page.waitForTimeout(150);
  await page.click('[data-action="imp.commit"]');
  await page.waitForTimeout(400);
  const card = await page.evaluate(() => { const a = Store.state.accounts.find(x => x.kind === 'tarjeta'); const ts = Store.state.transactions.filter(t => t.accountId === a.id); return { bal: a.balance, n: ts.length, pay: ts.filter(t => t.type === 'Gasto').every(t => t.paymentType === 'Tarjeta de Crédito') }; });
  ok(card.bal < 0 && card.n > 10 && card.pay, 'card statement into a new credit card: balance owed below $0, its purchases paid by card', card);
  await page.setViewportSize({ width: 1366, height: 900 });
};

if (require.main === module) (async () => {
  let pass = 0, fail = 0;
  const ok = (c, name, extra) => { if (c) pass++; else { fail++; console.log('FAIL:', name, extra !== undefined ? JSON.stringify(extra) : ''); } };
  const { browser, page, errors } = await openApp({ file: 'index.html?edition=us' });
  await module.exports(page, ok);
  ok(errors.length === 0, 'no console errors', errors);
  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
