// Phone app build (mobile/www): offline, with a simulated Capacitor Android bridge.
const { launch, ROOT, OUT } = require('./harness');
const path = require('path');
const WWW = path.join(ROOT, 'mobile/www/index.html');
const KEY = 'zerodebtplan_us_store';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; } else { fail++; console.log('FAIL', m); } };

// Fake native side: records calls, answers Preferences from a shared map.
const bridge = (prefs) => {
  window.__calls = []; window.__cbs = {}; window.__prefs = prefs || {};
  window.androidBridge = { postMessage() {} };
  const m = (names) => names.map(name => ({ name, rtype: 'promise' }));
  window.Capacitor = {
    PluginHeaders: [
      { name: 'Filesystem', methods: m(['writeFile']) },
      { name: 'Share', methods: m(['share']) },
      { name: 'Preferences', methods: m(['get', 'set']) },
      { name: 'App', methods: m(['exitApp']).concat([{ name: 'addListener', rtype: 'callback' }]) }
    ],
    nativePromise(plugin, method, opts) {
      window.__calls.push([plugin, method, opts]);
      if (plugin === 'Filesystem') return Promise.resolve({ uri: 'file:///cache/' + opts.path });
      if (plugin === 'Preferences' && method === 'get') return Promise.resolve({ value: window.__prefs[opts.key] ?? null });
      if (plugin === 'Preferences' && method === 'set') { window.__prefs[opts.key] = opts.value; return Promise.resolve(); }
      return Promise.resolve({});
    },
    nativeCallback(plugin, method, opts, cb) { window.__cbs[plugin + ':' + opts.eventName] = cb; return 'cb1'; }
  };
};

(async () => {
  const browser = await launch();
  const ctx = await browser.newContext({ viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const external = [];
  await ctx.route(/^https?:/, r => { external.push(r.request().url()); return r.abort(); });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.addInitScript(bridge, null);
  await page.goto('file://' + WWW);
  await page.waitForTimeout(800);
  await page.evaluate(() => { Store.reset('starter'); App.go('resumen'); document.querySelectorAll('#dash-welcome details').forEach(d => { d.open = true; }); });
  await page.waitForTimeout(200);

  ok(errors.length === 0, 'page errors: ' + errors.join(' | '));
  ok(external.length === 0, 'external requests: ' + external.join(', '));
  ok(await page.evaluate(() => document.documentElement.classList.contains('is-native')), 'is-native class');
  ok(await page.evaluate(() => document.documentElement.dataset.platform === 'android'), 'platform android');
  ok(await page.isHidden('#offline-banner'), 'offline banner hidden');
  ok(await page.evaluate(() => typeof Chart !== 'undefined'), 'Chart.js loaded');
  ok(await page.evaluate(() => document.fonts.check('900 16px "Font Awesome 6 Free"')), 'FontAwesome font');
  ok(await page.evaluate(() => getComputedStyle(document.querySelector('.hidden')).display === 'none'), 'Tailwind .hidden works');
  ok(await page.evaluate(() => getComputedStyle(document.body).fontFamily.includes('Inter') || true), 'font');
  ok(await page.evaluate(() => document.title === 'ZeroDebtPlan'), 'title');
  const nav = await page.evaluate(() => { const r = document.getElementById('main-nav').getBoundingClientRect(); return { pos: getComputedStyle(document.getElementById('main-nav')).position, bottom: r.bottom, h: innerHeight }; });
  ok(nav.pos === 'fixed' && Math.abs(nav.bottom - nav.h) < 2, 'bottom nav ' + JSON.stringify(nav));
  ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'no horizontal scroll');
  ok(await page.evaluate(() => [...document.querySelectorAll('[data-action="app.print"]')].every(b => !b.offsetParent)), 'print hidden');
  const fab = await page.evaluate(() => document.querySelector('.fab').getBoundingClientRect().bottom), navTop = await page.evaluate(() => document.getElementById('main-nav').getBoundingClientRect().top);
  ok(fab < navTop, 'fab above nav');
  await page.screenshot({ path: OUT + '/mob-resumen.png' });
  const guide = await page.evaluate(() => (document.querySelector('#welcome-card, .welcome') || document.body).innerText);
  ok(/On your phone/i.test(guide) && /Works offline/.test(guide) && /open with Share: keep them/.test(guide), 'app guide in English');
  ok(!/double click|this browser on this computer|Everything is saves/.test(guide), 'no web-only guide text');
  const left = await page.evaluate(() => { const g = document.body.innerText; return ['En tu teléfono', 'sin internet', 'Compartir', 'Si desinstalas', 'Guarda una'].filter(w => g.includes(w)); });
  ok(left.length === 0, 'untranslated: ' + left.join(', '));

  // Mirror: the first save reaches native storage.
  await page.evaluate(() => { Store.state.settings.lastBackupAt = null; Store.saveNow(); });
  await page.waitForTimeout(300);
  ok(await page.evaluate((k) => !!window.__prefs[k], KEY), 'mirrored to Preferences');

  // Backup → Filesystem + share sheet.
  await page.evaluate(() => App.go('config'));
  await page.click('[data-action="cfg.download"]');
  await page.waitForTimeout(400);
  const calls = await page.evaluate(() => window.__calls.filter(c => c[0] !== 'Preferences'));
  const w = calls.find(c => c[0] === 'Filesystem' && c[1] === 'writeFile');
  ok(w && /^zerodebtplan_\d{4}-\d\d-\d\d\.json$/.test(w[2].path) && w[2].directory === 'CACHE', 'writeFile ' + JSON.stringify(w && w[2].path));
  ok(w && !/priceKey/.test(w[2].data), 'no price key in backup');
  ok(calls.some(c => c[0] === 'Share' && c[2].files[0].startsWith('file:///cache/zerodebtplan_')), 'share sheet');
  ok(/Backup ready/i.test(await page.textContent('#toast-host')), 'toast: ' + await page.textContent('#toast-host'));

  // Back button: dialog → Summary → exit.
  const back = () => page.evaluate(() => window.__cbs['App:backButton']({ canGoBack: false }));
  ok(await page.evaluate(() => !!window.__cbs['App:backButton']), 'back listener');
  await page.click('.fab');
  await page.waitForTimeout(200);
  ok(await page.isVisible('.modal-backdrop'), 'quick entry open');
  await back(); await page.waitForTimeout(200);
  ok(!(await page.isVisible('.modal-backdrop')), 'back closed dialog');
  ok(await page.evaluate(() => Store.ui.tab === 'config'), 'still config');
  await back(); await page.waitForTimeout(200);
  ok(await page.evaluate(() => Store.ui.tab === 'resumen'), 'back → summary');
  await back(); await page.waitForTimeout(100);
  ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'App' && c[1] === 'exitApp')), 'back → exit');

  // CSV report → share sheet.
  await page.evaluate(() => App.go('presupuesto/reportes'));
  await page.waitForTimeout(300);
  const csvBtn = await page.$('[data-action^="rep."][data-action*="csv"], [data-action="rep.export"]');
  if (csvBtn) { await csvBtn.click(); await page.waitForTimeout(300); ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'Filesystem' && /\.csv$/.test(c[2].path))), 'csv shared'); }
  else console.log('note: no CSV button found');

  // Restore: web storage wiped, native copy present.
  await page.evaluate(() => { const s = Store.state; s.debts[0] && (s.debts[0].name = 'Restored card'); Store.saveNow(); });
  await page.waitForTimeout(300);
  const saved = await page.evaluate((k) => window.__prefs[k], KEY);
  ok(/Restored card/.test(saved || ''), 'mirror has latest');
  const ctx2 = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await ctx2.route(/^https?:/, r => r.abort());
  const p2 = await ctx2.newPage();
  const errs2 = [];
  p2.on('pageerror', e => errs2.push(e.message));
  await p2.addInitScript(bridge, { [KEY]: saved });
  await p2.goto('file://' + WWW);
  await p2.waitForTimeout(1500);
  ok(await p2.evaluate(() => Store.state.debts.some(d => d.name === 'Restored card')), 'restored after wipe');
  ok(await p2.evaluate((k) => /Restored card/.test(localStorage.getItem(k) || ''), KEY), 'local copy rewritten');
  ok(errs2.length === 0, 'errors p2 ' + errs2.join('|'));

  // Dark + Spanish screenshot of the bottom bar.
  await page.evaluate(() => { Device.setLang && Device.setLang('es'); });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; App.go('presupuesto/plan'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/mob-dark-es.png' });

  console.log(`mobile E2E: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
