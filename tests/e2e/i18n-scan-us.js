// Leftover-Spanish scan: every view in English, listing visible Spanish text. A few names stay
// Spanish on purpose (institutions, the button that switches to Spanish).
const { openApp, OUT } = require('./harness');
const ALLOWED = ["@title: Cambiar a español"];
(async () => {
  const { browser, page, errors } = await openApp({ file: 'index.html?edition=us', viewport: { width: 1366, height: 900 } });
  await page.evaluate(() => { Store.state.settings.welcomeDismissed = false; Store.state.accounts.push({ id: 1, name: 'Main', kind: 'corriente', balance: 900, updatedAt: Engine.isoDate(new Date()) }); Store.state.settings.paySchedule = { freq: 'weekly', weekday: 5, interval: 2, anchor: '2026-10-09' }; App.changed({ structural: true }); });
  const views = ['resumen', 'presupuesto/plan', 'presupuesto/ingresos', 'presupuesto/transacciones', 'presupuesto/importar', 'presupuesto/reportes', 'metas', 'ahorro/proyeccion', 'ahorro/polizas', 'hipoteca', 'jubilacion', 'patrimonio', 'config'];
  const found = new Map();
  const collect = async (where) => {
    const items = await page.evaluate(() => {
      // Words that only exist on the Spanish side of the dictionary.
      const words = (arr) => new Set(arr.join(' ').toLowerCase().split(/[^a-záéíóúñü]+/).filter(w => w.length >= 4));
      const es = words(I18n.keys('en')), en = words(I18n.keys('en').map(k => I18n.t(k)));
      const only = [...es].filter(w => !en.has(w));
      const ONLY = new Set(only);
      const SP = { test: (t) => /[áéíóúñ¿¡]/.test(t) || t.toLowerCase().split(/[^a-záéíóúñü]+/).some(w => ONLY.has(w)) };
      const out = [];
      const vis = (el) => { const r = el.getBoundingClientRect(); const st = getComputedStyle(el); return st.display !== 'none' && st.visibility !== 'hidden' && (r.width > 0 || r.height > 0); };
      const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
      let n;
      while ((n = w.nextNode())) {
        const t = n.nodeValue.replace(/\s+/g, ' ').trim();
        const el = n.parentElement;
        if (!t || !el || el.closest('[data-i18n-skip], script, style, select option:not(:checked)') || !/[a-zA-Z]{2}/.test(t)) continue;
        if (!vis(el) && el.tagName !== 'OPTION') continue;
        if (SP.test(t)) out.push(t.slice(0, 140));
      }
      document.querySelectorAll('[placeholder], [title], [aria-label]').forEach(el => ['placeholder', 'title', 'aria-label'].forEach(a => { const v = el.getAttribute(a); if (v && SP.test(v)) out.push('@' + a + ': ' + v.slice(0, 120)); }));
      return out;
    });
    items.forEach(t => { if (!found.has(t)) found.set(t, where); });
  };
  for (const v of views) { await page.evaluate(v => App.go(v), v); await page.waitForTimeout(250); await collect(v); }
  // sheets / dialogs
  const opens = [['resumen', '.fab'], ['resumen', '#wi-open'], ['presupuesto/ingresos', '#pay-edit'], ['presupuesto/ingresos', '[data-action="ded.add"]']];
  for (const [v, sel] of opens) { await page.evaluate(v => App.go(v), v); await page.waitForTimeout(150); await page.click(sel); await page.waitForTimeout(200); if (sel === '#wi-open') { await page.fill('#wi-amount', '500'); await page.dispatchEvent('#wi-amount', 'input'); } await collect(v + ' ' + sel); await page.keyboard.press('Escape'); await page.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach(b => b.remove())); }
  await page.evaluate(() => PayScan.fromText(`Pay Period: 09/14/2026 - 09/27/2026\nGross Pay 2,000.00\nFederal Income Tax 182.40\nNet Pay 1,817.60`)); await page.waitForTimeout(150); await collect('payscan');
  await page.evaluate(() => document.querySelectorAll('.modal-backdrop').forEach(b => b.remove()));
  await page.evaluate(() => App.go('resumen'));
  await page.screenshot({ path: OUT + '/us-en-resumen.png' });
  const list = [...found.entries()].map(([t, w]) => `${w}\t${t}`);
  require('fs').writeFileSync(OUT + '/i18n-left-us.txt', list.join('\n'));
  const unexpected = [...found.keys()].filter(t => !ALLOWED.includes(t));
  console.log(`${list.length} left (${unexpected.length} unexpected)`);
  if (unexpected.length) console.log([...found.entries()].filter(([t]) => !ALLOWED.includes(t)).map(([t, w]) => `${w}\t${t}`).slice(0, 120).join('\n'));
  if (errors.length) console.log(errors);
  await browser.close();
  process.exit(unexpected.length || errors.length ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
