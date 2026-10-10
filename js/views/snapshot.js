/* Reports → "Share a read-only snapshot": this month's plan as one HTML file someone else can open in
 * any browser, read-only and encrypted. The report (plain HTML, no scripts) is encrypted like every
 * file that leaves the app (js/vault.js: AES-256-GCM, PBKDF2) and put inside a small page that asks
 * for the password and shows it. That page's Content Security Policy runs only its own script (by
 * its hash): nothing in the report can run, and it can't connect anywhere. */
(function () {
    'use strict';
    const { money0, esc } = Fmt;
    const t = (x) => I18n.t(x);

    // The report: a few numbers and tables, in the app's language, every name escaped.
    function reportHTML(ctx) {
        const s = ctx.state, today = ctx.today, y = today.getFullYear(), m = today.getMonth() + 1;
        const items = Engine.monthItems(Store.effective(y), String(m));
        const r = Engine.monthReview({ items, transactions: s.transactions, year: y, month: m });
        const spend = Engine.lineSpend(items, s.transactions, y, String(m));
        const lines = items.filter(i => i.type !== 'Ingreso').map(i => ({ name: i.name, planned: Number(i.real) || 0, spent: (spend.byLine[String(i.id)] || { spent: 0 }).spent }))
            .filter(l => l.planned > 0 || l.spent > 0);
        const cats = Engine.historyGroups(s.transactions.filter(x => x.date.slice(0, 7) === `${y}-${String(m).padStart(2, '0')}`), 'month', 8)[0];
        const plan = ctx.debts, nw = ctx.netWorth;
        const kpi = (label, value, note) => `<div class="kpi"><span>${esc(t(label))}</span><b>${value}</b>${note ? `<small>${esc(note)}</small>` : ''}</div>`;
        const table = (head, rows) => rows.length ? `<table><thead><tr>${head.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(t(h))}</th>`).join('')}</tr></thead><tbody>${rows.map(r2 => `<tr>${r2.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : `<p class="muted">${esc(t('Nothing yet.'))}</p>`;
        const month = `${Fmt.MONTH_NAMES[m - 1]} ${y}`;
        const free = plan.totalBalance <= 0 ? t('No consumer debt') : plan.never ? t('Never (with this budget)') : Fmt.monthYear(Engine.addMonths(today, plan.months));
        return `<h1>${esc(t('Budget report'))} · ${esc(month)}</h1>
            <p class="muted">${esc(t('A read-only snapshot made on'))} ${esc(Fmt.dayMonth(today))} ${y}. ${esc(t('Amounts as they were that day.'))}</p>
            <div class="kpis">${kpi('Income this month', money0(r.income))}${kpi('Spent this month', money0(r.spent))}${kpi('Left over', money0(r.leftover))}
                ${kpi('Net worth', money0(nw.value))}${kpi('Consumer debt', money0(plan.totalBalance), `${t('Debt-free')}: ${free}`)}${kpi('Emergency fund', money0(ctx.ef.liquid), ctx.ef.monthsCovered ? `${Math.round(ctx.ef.monthsCovered * 10) / 10} ${t('months of expenses')}` : '')}</div>
            <h2>${esc(t('The budget this month'))}</h2>
            ${table(['Line', 'Planned', 'Spent', 'Left'], lines.map(l => [esc(l.name), money0(l.planned), money0(l.spent), money0(l.planned - l.spent)]))}
            <h2>${esc(t('Where the money went'))}</h2>
            ${table(['Category', 'Spent'], cats ? cats.cats.map(c => [esc(Views.catPath(c.cat)), money0(c.total)]) : [])}
            <h2>${esc(t('Debts'))}</h2>
            ${table(['Debt', 'Balance', 'Rate'], (s.debts || []).filter(d => Number(d.balance) > 0).map(d => [esc(d.name), money0(Number(d.balance) || 0), `${Number(d.rate) || 0}%`]))}
            <h2>${esc(t('Savings goals'))}</h2>
            ${table(['Goal', 'Saved', 'Target'], (s.goals || []).filter(g => Number(g.target) > 0).map(g => [esc(g.name), money0(Number(g.current) || 0), money0(Number(g.target) || 0)]))}`;
    }

    // The page that opens it: a password, then the report. Its one script decrypts the envelope
    // (the same format as js/vault.js) with the browser's own crypto.
    const OPEN_JS = `(function(){var f=document.getElementById('f'),m=document.getElementById('m');function b(s){var x=atob(s),o=new Uint8Array(x.length);for(var i=0;i<x.length;i++)o[i]=x.charCodeAt(i);return o}
f.addEventListener('submit',async function(e){e.preventDefault();m.textContent='';try{var o=JSON.parse(document.getElementById('d').textContent),c=crypto.subtle,te=new TextEncoder();
var k=await c.importKey('raw',te.encode(document.getElementById('p').value),'PBKDF2',false,['deriveKey']);k=await c.deriveKey({name:'PBKDF2',salt:b(o.salt),iterations:Math.max(100000,Math.min(10000000,Number(o.iter))),hash:'SHA-256'},k,{name:'AES-GCM',length:256},false,['decrypt']);
var p=await c.decrypt({name:'AES-GCM',iv:b(o.iv)},k,b(o.data)),body=JSON.parse(new TextDecoder().decode(p));document.getElementById('r').innerHTML=body.text;f.remove();}catch(err){m.textContent=f.dataset.bad;}});})();`;
    const CSS = `body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;max-width:820px;margin:0 auto;padding:24px 16px;color:#0f172a;background:#fff}h1{font-size:1.4rem;margin:0 0 4px}h2{font-size:1rem;margin:24px 0 8px}
.muted{color:#64748b;font-size:.85rem}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(150px,1fr));gap:8px;margin-top:16px}.kpi{border:1px solid #e2e8f0;border-radius:10px;padding:10px}.kpi span{display:block;font-size:.7rem;font-weight:700;text-transform:uppercase;color:#64748b}.kpi b{font-size:1.15rem}.kpi small{display:block;color:#64748b;font-size:.75rem}
table{width:100%;border-collapse:collapse;font-size:.85rem}th,td{padding:6px 8px;border-bottom:1px solid #e2e8f0;text-align:left}.n{text-align:right;font-variant-numeric:tabular-nums}
form{display:flex;flex-wrap:wrap;gap:8px;align-items:center;margin-top:16px}input{padding:8px 10px;border:1px solid #cbd5e1;border-radius:8px;font-size:1rem}button{padding:8px 14px;border:0;border-radius:8px;background:#059669;color:#fff;font-weight:700}#m{color:#b91c1c;width:100%}
@media (prefers-color-scheme:dark){body{background:#0b1220;color:#e2e8f0}.kpi,th,td{border-color:#1f2a3d}}@media print{form{display:none}}`;
    async function page(envelope) {
        const hash = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(OPEN_JS));
        const b64 = btoa(String.fromCharCode.apply(null, new Uint8Array(hash)));
        const csp = `default-src 'none'; script-src 'sha256-${b64}'; style-src 'unsafe-inline'; img-src data:; form-action 'none'; base-uri 'none'`;
        // The envelope is JSON in a non-script data block: "<" can't close it early.
        const data = envelope.replace(/</g, '\\u003c');
        return `<!doctype html><html lang="${esc(I18n.lang || 'en')}"><head><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp}"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex">
<title>${esc(t('Budget report (encrypted)'))}</title><style>${CSS}</style></head><body>
<div id="r"><h1>${esc(t('Budget report (encrypted)'))}</h1><p class="muted">${esc(t('Type the password you were given (not sent with this file) to read it. Nothing is sent anywhere: it opens on this device only.'))}</p></div>
<form id="f" data-bad="${esc(t('Wrong password, or the file was changed.'))}"><input id="p" type="password" autocomplete="off" aria-label="${esc(t('Password'))}" placeholder="${esc(t('Password'))}" required><button type="submit">${esc(t('Open'))}</button><span id="m" role="alert"></span></form>
<script type="application/json" id="d">${data}<\/script><script>${OPEN_JS}<\/script></body></html>`;
    }

    async function share(ctx) {
        const pw = await Native.askPassword({ title: 'Share a read-only snapshot', message: 'The report is encrypted (AES-256): whoever you send it to opens it in any browser with this password. Tell them the password another way, not in the same message.' });
        if (!pw) return;
        const envelope = await Vault.encrypt(reportHTML(ctx), pw, { name: 'report', type: 'text/html' });
        const html = await page(envelope);
        // Already encrypted inside: saved as is (an .html anyone can open, with the password).
        const d = ctx.today, name = `${t('budget-report')}-${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}.html`;
        await Native.saveFile(name, html, 'text/html');
        UI.toast('Snapshot saved: it opens in any browser with the password.');
    }

    UI.register({
        'snapshot.share': () => { share(App.buildContext()).catch(e => UI.toast('Couldn\'t make the snapshot: ' + (e.message || e), 'error')); }
    });

    window.Snapshot = { reportHTML, page, OPEN_JS };
})();
