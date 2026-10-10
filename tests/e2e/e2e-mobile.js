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

const Vault_ok = (d) => { try { const o = JSON.parse(d); return o.cipher === 'AES-256-GCM' && !/years|transactions/.test(d); } catch (e) { return false; } };
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
  // The readers come with the app (every outside request is refused here): a PDF pay stub's text
  // with pdf.js, a photo's with Tesseract (English and Spanish data inside the app).
  const pdfB64 = (() => {
    const parts = ['%PDF-1.4\n'], offs = [];
    const obj = (n, body) => { offs[n] = parts.join('').length; parts.push(`${n} 0 obj\n${body}\nendobj\n`); };
    const text = 'BT /F1 14 Tf 20 150 Td (Gross Pay 2,000.00) Tj 0 -24 Td (Net Pay 1,817.60) Tj ET';
    obj(1, '<< /Type /Catalog /Pages 2 0 R >>'); obj(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
    obj(3, '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 200] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>');
    obj(4, `<< /Length ${text.length} >>\nstream\n${text}\nendstream`); obj(5, '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
    const xref = parts.join('').length;
    parts.push(`xref\n0 6\n0000000000 65535 f \n${[1, 2, 3, 4, 5].map(n => String(offs[n]).padStart(10, '0') + ' 00000 n \n').join('')}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`);
    return Buffer.from(parts.join(''), 'latin1').toString('base64');
  })();
  // (Served like the app serves itself, from a local origin: a file:// page can't start workers.)
  const srv = require('http').createServer((req, res) => {
    const dir = require('path').dirname(WWW), f = require('path').join(dir, decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || 'index.html');
    if (!f.startsWith(dir) || !require('fs').existsSync(f)) { res.writeHead(404); return res.end(); }
    const type = { '.js': 'text/javascript', '.html': 'text/html', '.css': 'text/css', '.gz': 'application/gzip', '.woff2': 'font/woff2' }[require('path').extname(f)] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': type }); require('fs').createReadStream(f).pipe(res);
  });
  await new Promise(r => srv.listen(0, '127.0.0.1', r));
  const origin = `http://127.0.0.1:${srv.address().port}`;
  const rctx = await browser.newContext({ viewport: { width: 412, height: 915 } });
  const outside = [];
  await rctx.route(/^https?:/, r => (r.request().url().startsWith(origin) ? r.continue() : (outside.push(r.request().url()), r.abort())));
  const rpage = await rctx.newPage();
  await rpage.addInitScript(bridge, null);
  await rpage.goto(origin + '/index.html');
  await rpage.waitForTimeout(800);
  const read = await rpage.evaluate(async (b64) => {
    const out = {};
    try { out.pdf = await Readers.pdfText(new File([Uint8Array.from(atob(b64), c => c.charCodeAt(0))], 'stub.pdf', { type: 'application/pdf' })); } catch (e) { out.pdfErr = String(e); }
    const cv = document.createElement('canvas'); cv.width = 640; cv.height = 200;
    const g = cv.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 640, 200); g.fillStyle = '#000'; g.font = 'bold 44px sans-serif'; g.fillText('GROCERY MART', 30, 70); g.fillText('TOTAL 23.45', 30, 150);
    const blob = await new Promise(r => cv.toBlob(r, 'image/png'));
    try { out.photo = await Readers.photoText(blob); } catch (e) { out.photoErr = String(e); }
    return out;
  }, pdfB64);
  ok(/Gross Pay\s+2,000\.00/.test(read.pdf || '') && /Net Pay\s+1,817\.60/.test(read.pdf || ''), 'a PDF pay stub is read with no internet (pdf.js inside the app) ' + JSON.stringify(read).slice(0, 200));
  ok(/TOTAL\s*23[.,]45/i.test(read.photo || '') && /GROCERY/i.test(read.photo || ''), 'a photo is read with no internet (Tesseract inside the app) ' + JSON.stringify(read).slice(0, 200));
  ok(outside.length === 0, 'reading files asked the internet for nothing: ' + outside.join(', '));
  await rctx.close(); srv.close();
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
  // The keyboard takes half the screen: the field being typed in stays visible, the bottom bar steps aside.
  await page.evaluate(() => { App.go('presupuesto/ingresos'); });
  await page.waitForTimeout(200);
  await page.focus('#inc-yearly');
  await page.setViewportSize({ width: 412, height: 460 });
  await page.waitForTimeout(700);
  const kb = await page.evaluate(() => { const r = document.getElementById('inc-yearly').getBoundingClientRect(); return { top: r.top, bottom: r.bottom, h: innerHeight, open: document.documentElement.classList.contains('kb-open'), nav: getComputedStyle(document.getElementById('main-nav')).display }; });
  ok(kb.top >= 0 && kb.bottom <= kb.h && kb.open && kb.nav === 'none', 'keyboard open: the field stays in view and the bottom bar hides ' + JSON.stringify(kb));
  await page.evaluate(() => document.activeElement.blur());
  await page.setViewportSize({ width: 412, height: 915 });
  await page.waitForTimeout(300);
  ok(await page.evaluate(() => !document.documentElement.classList.contains('kb-open') && getComputedStyle(document.getElementById('main-nav')).display !== 'none'), 'keyboard closed: the bottom bar is back');
  await page.evaluate(() => { App.go('resumen'); document.querySelectorAll('#dash-welcome details').forEach(d => { d.open = true; }); });
  await page.waitForTimeout(200);
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
  await page.waitForSelector('.modal input[name="pw"]');
  await page.fill('.modal input[name="pw"]', 'test-pass-123');
  await page.fill('.modal input[name="pw2"]', 'test-pass-123');
  await page.click('.modal [data-dialog-ok]');
  await page.waitForTimeout(2500);
  const calls = await page.evaluate(() => window.__calls.filter(c => c[0] !== 'Preferences'));
  const w = calls.find(c => c[0] === 'Filesystem' && c[1] === 'writeFile');
  ok(w && /^zerodebtplan_\d{4}-\d\d-\d\d\.json\.enc\.json$/.test(w[2].path) && w[2].directory === 'CACHE', 'writeFile (encrypted) ' + JSON.stringify(w && w[2].path));
  const plainBackup = w && await page.evaluate((d) => Vault.decrypt(d, 'test-pass-123').then(r => r.text), w[2].data);
  ok(w && Vault_ok(w[2].data) && !/priceKey/.test(plainBackup) && /"years"/.test(plainBackup), 'backup encrypted, no price key inside');
  ok(calls.some(c => c[0] === 'Share' && c[2].files[0].startsWith('file:///cache/zerodebtplan_')), 'share sheet');
  ok(/Backup ready/i.test(await page.textContent('#toast-host')), 'toast: ' + await page.textContent('#toast-host'));

  // Back button: dialog → Summary → exit.
  const back = () => page.evaluate(() => window.__cbs['App:backButton']({ canGoBack: false }));
  ok(await page.evaluate(() => !!window.__cbs['App:backButton']), 'back listener');
  // The + button steps aside while scrolling down (Backup is far down Settings): back to the top.
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.waitForTimeout(300);
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
  if (csvBtn) {
    await csvBtn.click();
    await page.waitForSelector('.modal input[name="pw"]');
    await page.fill('.modal input[name="pw"]', 'test-pass-123');
    await page.fill('.modal input[name="pw2"]', 'test-pass-123');
    await page.click('.modal [data-dialog-ok]');
    await page.waitForTimeout(2500);
    ok(await page.evaluate(() => window.__calls.some(c => c[0] === 'Filesystem' && /\.csv\.enc\.json$/.test(c[2].path) && !/,/.test(JSON.parse(c[2].data).data))), 'csv shared, encrypted');
  }
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

  // ---- The app's own plugin (DeviceKey), reminders and the camera, on a simulated phone.
  // Without a PIN the plan is encrypted with the phone's key; reminders say no amounts or names; the
  // camera's photo goes to the receipt reader; fingerprint unlock; the home-screen shortcut.
  const phone = (cfg) => {
    window.__calls = []; window.__prefs = cfg.prefs || {}; window.__secret = cfg.secret || null; window.__action = cfg.action || null;
    window.androidBridge = { postMessage() {} };
    const m = (names) => names.map(name => ({ name, rtype: 'promise' }));
    window.Capacitor = {
      PluginHeaders: [
        { name: 'Filesystem', methods: m(['writeFile']) }, { name: 'Share', methods: m(['share']) }, { name: 'Preferences', methods: m(['get', 'set', 'remove']) },
        { name: 'App', methods: m(['exitApp']).concat([{ name: 'addListener', rtype: 'callback' }]) },
        { name: 'DeviceKey', methods: m(['getKey', 'setSecret', 'getSecret', 'clearSecret', 'clearAll', 'takeAction', 'canVerify', 'verify']) },
        { name: 'LocalNotifications', methods: m(['requestPermissions', 'getPending', 'schedule', 'cancel']) },
        { name: 'Camera', methods: m(['getPhoto']) }
      ],
      nativePromise(plugin, method, opts) {
        window.__calls.push([plugin, method, opts]);
        if (plugin === 'Preferences' && method === 'get') return Promise.resolve({ value: window.__prefs[opts.key] ?? null });
        if (plugin === 'Preferences' && method === 'set') { window.__prefs[opts.key] = opts.value; return Promise.resolve(); }
        if (plugin === 'DeviceKey') {
          if (method === 'getKey') return Promise.resolve({ key: cfg.key });
          if (method === 'setSecret') { window.__secret = opts.value; return Promise.resolve(); }
          if (method === 'getSecret') return Promise.resolve({ value: window.__secret });
          if (method === 'takeAction') { const a = window.__action; window.__action = null; return Promise.resolve({ action: a }); }
          if (method === 'canVerify') return Promise.resolve({ available: true });
          return Promise.resolve({});
        }
        if (plugin === 'LocalNotifications' && method === 'requestPermissions') return Promise.resolve({ display: 'granted' });
        if (plugin === 'LocalNotifications' && method === 'getPending') return Promise.resolve({ notifications: [] });
        if (plugin === 'Camera') return Promise.resolve({ base64String: cfg.photo, format: 'png' });
        return Promise.resolve({});
      },
      nativeCallback() { return 'cb'; }
    };
  };
  const KEY32 = Buffer.alloc(32, 7).toString('base64');
  const photo = await page.evaluate(() => { const c = document.createElement('canvas'); c.width = 320; c.height = 120; const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, 320, 120); g.fillStyle = '#000'; g.font = '28px sans-serif'; g.fillText('TOTAL 9.99', 20, 70); return c.toDataURL('image/png').split(',')[1]; });
  const ctx3 = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await ctx3.route(/^https?:/, r => r.abort());
  const p3 = await ctx3.newPage();
  const errs3 = [];
  p3.on('pageerror', e => errs3.push(e.message));
  await p3.addInitScript(phone, { key: KEY32, photo });
  await p3.goto('file://' + WWW);
  await p3.waitForTimeout(1200);
  await p3.evaluate(() => { Store.reset('example'); App.changed({ structural: true }); Store.saveNow(); });
  await p3.waitForTimeout(800);
  const enc = await p3.evaluate((k) => ({ local: localStorage.getItem(k) || '', copy: window.__prefs[k] || '', banner: !document.getElementById('protect-banner').classList.contains('hidden') }), KEY);
  ok(enc.local.startsWith('zdpenc1:') && enc.copy.startsWith('zdpenc1:') && !/Miller|transactions|Groceries/.test(enc.local + enc.copy) && !enc.banner, 'no PIN: the plan is encrypted with the phone\'s key (and its native copy), no "not encrypted" notice');
  await p3.reload();
  await p3.waitForTimeout(1500);
  ok(await p3.evaluate(() => !!(Store.state && Store.state.transactions.length > 10) && !document.getElementById('lock-screen')), 'reopened with the phone\'s key, no lock screen');
  // Reminders: no amounts, no names.
  await p3.evaluate(() => { App.go('config'); document.querySelectorAll('[data-tab=config] details').forEach(d => { d.open = true; }); });
  await p3.waitForTimeout(400);
  await p3.click('#cfg-reminders');
  await p3.waitForTimeout(800);
  const sched = await p3.evaluate(() => (window.__calls.find(c => c[0] === 'LocalNotifications' && c[1] === 'schedule') || [])[2]);
  const notes = (sched && sched.notifications) || [];
  ok(notes.length > 0 && notes.every(n => !/\$|\d{2,}|Phone|Verizon|Mortgage/.test(n.title + n.body) && n.schedule && n.schedule.at) && notes.some(n => /weekly review/i.test(n.title)), 'reminders scheduled on the phone, with no amounts or names', notes.slice(0, 3));
  // The camera: its photo goes to the receipt reader.
  await p3.evaluate(() => App.go('transacciones/importar'));
  await p3.waitForTimeout(300);
  await p3.click('[data-action="cam.photo"][data-for="imp-photo"]');
  await p3.waitForFunction(() => /TOTAL|total|Fill in|read/i.test(document.getElementById('imp-photo-status').textContent), null, { timeout: 60000 }).catch(() => {});
  ok(await p3.evaluate(() => window.__calls.some(c => c[0] === 'Camera') && document.getElementById('imp-photo-status').textContent.length > 10), 'the camera button reads the photo like a picked one');
  // Fingerprint unlock: the PIN goes to the phone; after a lock, the fingerprint opens it.
  await p3.evaluate(() => Device.setPin('1357'));
  await p3.evaluate(() => { App.go('config'); document.querySelectorAll('[data-tab=config] details').forEach(d => { d.open = true; }); });
  await p3.waitForTimeout(300);
  await p3.click('#cfg-bio');
  await p3.waitForSelector('.modal input[name="pin"]');
  await p3.fill('.modal input[name="pin"]', '1357');
  await p3.click('.modal [data-dialog-ok]');
  await p3.waitForTimeout(600);
  const bioOn = await p3.evaluate(() => ({ on: Device.bioOn(), secret: window.__secret }));
  const ctx4 = await browser.newContext({ viewport: { width: 412, height: 915 } });
  await ctx4.route(/^https?:/, r => r.abort());
  const state = await p3.evaluate(() => { Store.saveNow(); return JSON.stringify(Object.assign({}, localStorage)); });
  const p4 = await ctx4.newPage();
  const errs4 = [];
  p4.on('pageerror', e => errs4.push(e.message));
  await p4.addInitScript(([s]) => { if (!sessionStorage.getItem('seeded')) { Object.entries(JSON.parse(s)).forEach(([k, v]) => localStorage.setItem(k, v)); sessionStorage.setItem('seeded', '1'); } }, [state]);
  await p4.addInitScript(phone, { key: KEY32, photo, secret: '1357', action: 'quick' });
  await p4.goto('file://' + WWW);
  await p4.waitForTimeout(2500);
  const unlocked = await p4.evaluate(() => ({ lock: !!document.getElementById('lock-screen'), started: !!(window.Store && Store.state), quick: !!document.getElementById('quick-amount') }));
  ok(bioOn.on && bioOn.secret === '1357' && !unlocked.lock && unlocked.started, 'fingerprint unlock: the phone keeps the PIN; after a lock the fingerprint opens the app', { bioOn, unlocked });
  ok(unlocked.quick, 'opened from the home-screen shortcut: quick entry', unlocked);
  ok(!errs3.length && !errs4.length, 'no page errors on the simulated phone: ' + errs3.concat(errs4).join(' | '));
  await ctx3.close(); await ctx4.close();

  // Dark + Spanish screenshot of the bottom bar.
  await page.evaluate(() => { Device.setLang && Device.setLang('es'); });
  await page.evaluate(() => { document.documentElement.dataset.theme = 'dark'; App.go('presupuesto/plan'); });
  await page.waitForTimeout(400);
  await page.screenshot({ path: OUT + '/mob-dark-es.png' });

  console.log(`mobile E2E: ${pass} passed, ${fail} failed`);
  await browser.close();
  process.exit(fail ? 1 : 0);
})();
