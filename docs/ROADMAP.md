# Roadmap and feature log

Every idea requested for the app, where it stands, and — for anything that can't be built
yet — why, and what it would take. Nothing is dropped: if it can't be done now it is logged
here to be analyzed later.

**Today's constraint:** the app is one HTML file that opens from the computer (`file://`),
with no server. Data lives only in that browser (localStorage) and moves between devices
through the backup `.json`. Anything that needs a server, an account, or a secure web
origin (`https://`) waits for hosting (see [Hosting plan](#hosting-plan)).

Status: ✅ done · 🔨 building now · 📋 planned (possible today) · 🌐 needs hosting · 🔍 to investigate · ⛔ not planned

---

## Done

| Feature | Notes |
|---|---|
| ✅ Zero-based budget, base + per-month budgets | Presupuesto del Mes |
| ✅ Debts and goals linked to the budget | Each debt/goal is a budget line; payoff plan only uses budgeted money |
| ✅ Multiple incomes | Salary (IESS/SRI) + other recurring income + income logged as transactions, linked explicitly |
| ✅ Auto-sweep of leftover money to savings | Shown as its own line "Sobrante del mes" |
| ✅ Undo / redo for every change | Header buttons, Ctrl+Z / Ctrl+Y |
| ✅ Manual transactions, edit in place, search | Transacciones |
| ✅ Simple budget view: Planeado / Gastado / Restante / Todo | EveryDollar / Monarch style cards with progress bars |
| ✅ Transactions assigned to budget lines | Chip, form field, drag & drop; unassigned list; no double counting |
| ✅ Bill due dates + "Próximos pagos" | Overdue / due soon / paid, one-click "Registrar pago" |
| ✅ Risk of overspending | Spending pace vs. days elapsed |
| ✅ Trend lines by week / month / year | Selectable window, category and type, data table |
| ✅ Display currency | Symbol + number style only (no conversion) |
| ✅ Savings goals, net worth, DPF projection, mortgage, retirement | Existing tabs |
| ✅ Unlimited custom categories / subcategories | Transacciones → Gestionar categorías |
| ✅ CSV import from any bank/app ("connect your bank") | Presupuesto → Importar. Column mapping, the file's categories → yours, preview, duplicates skipped, mapping remembered per file layout; the file is never stored |
| ✅ Automatic categorization rules | "Contains X → name / category / budget line"; applied on import and while typing a new transaction |
| ✅ SRI electronic invoice import (XML) | Supplier, RUC, number, date, total, IVA, items, payment type; the same invoice twice is detected by its access key |
| ✅ Invoice / receipt photo (OCR) | Best effort in the browser (Tesseract.js, needs internet the first time); prefills the form for review |
| ✅ Household members | Configuración → Tu hogar; "¿Quién?" on each transaction, filter by person, "Aportes del hogar" (income/expense share per person). Real-time sharing between phones still needs hosting (below) |
| ✅ This-month dashboard | Spent vs. last month (daily curve + plan), cash flow with ▲▼ vs. last month, top expenses, "Puedes gastar hoy" (daily limit from flexible lines), next payday (Ingresos → Días de pago), insights: projected month-end spend, where most money goes, biggest jump / drop |
| ✅ Repeating / scheduled transactions, subscriptions list | "Repetir" when registering (future date = scheduled) or the repeat button on a transaction; posted automatically when due (on opening the app), undoable; monthly cost of subscriptions and scheduled income |
| ✅ Deleted transactions bin | Kept 60 days; restore or delete for good |
| ✅ Goals with a target date (sinking funds) | Monthly needed to arrive on time (with DPF interest), "A tiempo" / "Atrasada", progress bar, "Depositar" (optionally logged on the goal's budget line) |
| ✅ Custom reports + export | Presupuesto → Reportes: any period, group by category / subcategory / budget line / person / month / week / place / payment; CSV (Excel/Sheets, re-importable) and print to PDF |
| ✅ Baby Steps roadmap ("Tu camino") | Deudas y Metas: net worth today → projected at retirement age (only invested money earns interest), debt-free date, the next concrete step; debts show how much is already paid |
| ✅ Custom budget groups | Simple view → "Agregar grupo"; move a line between groups from its detail. (Nested sub-groups: not yet — see Phase 3) |
| ✅ Per-line detail | Chart icon on a line: this month planned/spent/remaining, last 12 months vs. plan, its transactions, group / type / linked category |
| ✅ Split transactions | "✂ Dividir entre rubros" on a transaction's chip: up to 3 lines, the rest counts as usual |
| ✅ Investments: ETF / stocks / funds | Ticker + units; price from Finnhub or Alpha Vantage with the user's free key, or typed by hand; flows into net worth. The key never goes into backups |
| ✅ Accounts with balances | Patrimonio → Cuentas (corriente / ahorros / efectivo); a bank CSV with a "Saldo" column updates the account with the latest balance on import; feeds net worth and the Resumen |
| ✅ Quick entry | Floating "+" on every screen: amount keypad, most-used category chips, note, date, person; rules apply |
| ✅ Logging streak | Resumen → Hoy: days in a row with something logged, this week's dots |
| ✅ Dark mode | Configuración → Este dispositivo (Claro / Oscuro / Automático) or the moon button in the header; charts follow |
| ✅ App lock with a PIN | Configuración → Este dispositivo. Salted PBKDF2 hash, 5 tries then a 30 s wait, locks again after 5 min in the background. Honest caveat shown: it hides the screen, it does not encrypt the data (encryption at rest → stage B). Forgot PIN = wipe this browser and load a backup |
| ✅ Import: change many rows at once | Review step: one description / category / subcategory / budget line for every checked row, each row still editable (own description too); remembered for files with the same layout. Decimal separator decided by the whole column ("273.841" next to "173.94" is 273.84). Imported rows keep a fingerprint so re-importing is detected even after renaming |
| ✅ No double counting between hand-typed and imported | Import: a bank/SRI row with the same amount within 4 days of something typed by hand shows "¿Ya la anotaste?" and starts unchecked ("Es otro gasto" to import both); linking keeps your text and remembers the bank row (and the invoice). Typing something a file already brought in warns with Deshacer |
| ✅ Merchant alias rules | Rules can rename ("SQ *COZ" → "Cozy Coffee") besides category and budget line; offered for existing transactions when created; "+ regla" on any import row (starts from the file text); the file text stays visible next to the new name. Applied on import, in the form and in quick entry |
| ✅ Safe to spend | Resumen: checking + cash (savings excluded, credit-card purchases don't reduce it) − unpaid bills (overdue too) and scheduled payments until the next payday − what savings/goal lines still need this month − your cushion; per-day amount; the list of payments counted. Only as exact as the balances entered/imported |
| ✅ Money calendar | Resumen: this month + 2 ahead; paydays (net pay of each month, décimos included), bills (paid ones crossed out), scheduled items, projected balance per day with everyday spending spread evenly; days under the cushion (amber) or below zero (red) and the tightest day named; list view for small screens |

## Phase 3 — planned (works without a server)

| Feature | Source / notes |
|---|---|
| 📋 Nested budget groups (a group inside a group) | "Car Money → Transportation / Maintenance" |
| 📋 History grouped by week/month with category totals | Nudget history. Partly covered: Reportes groups by week/month with totals; a timeline view in Transacciones is still to do |
| 📋 Share a read-only report (file / print) | Until hosting allows real sharing. Today: Reportes → CSV / print to PDF. Next: a single-file read-only snapshot |

## 🔍 Under analysis — no decision yet (requested 2026-09-30)

Assessed only; nothing built. "Now" = works in the offline file; "Hosting" = needs stage A/B/C below.

| Idea | Can it be done? | What already exists | Missing / effort |
|---|---|---|---|
| Frictionless entry widget (lock screen / 2-second shortcut) | Partly now, fully only as a native app | Floating "+" quick entry | Now: open quick entry straight from a link/bookmark (`#rapido`) and a keyboard key. Hosting A (PWA): home-screen icon + Android long-press shortcut "Registrar gasto"; iPhone via the Shortcuts app. A real lock-screen widget needs a native iOS/Android app ⛔ for now |
| "What if" overspending sandbox | Yes, now | Budget, goals, debt plan, projections, undo | Medium: a copy of the plan where you add a purchase and see which lines/goals get starved, new debt-free date, emergency-fund months; nothing saved unless applied |
| Smart manual fallback when a bank connection breaks | The fallback is already the only mode (no bank connections in Ecuador yet) | CSV import with remembered mappings | Small now: a downloadable CSV template that imports with no mapping; "last import per account" reminder. The automatic switch belongs to stage C |
| Pitfall: irregular / annual bills | Yes, now | Goals with a target date (sinking funds), yearly/semiannual repeats | Small: "gastos anuales" list that turns into a monthly set-aside line; Ecuador items (matrícula vehicular, predial) and irregular income (décimo tercero / cuarto) |
| Pitfall: drop-off | Partly now | Streak, alerts | Small: weekly review checklist (unassigned, uncategorized, over-budget, next bills). Reminders need hosting |

## Needs hosting / a server 🌐

| Feature | Why not now | What it needs |
|---|---|---|
| 🌐 Sync the budget across phone and computer (and encrypt the data at rest) | No server to hold the data; localStorage is per browser | Hosting + accounts + encrypted sync (see stage B) |
| 🌐 Shared household / group budgets with invitation codes ("Start / Join group", review what is shared) | Two people's devices can't talk without a server | Accounts, groups, invitations, per-item sharing permissions |
| 🌐 Sign in with Touch ID / Face ID (the PIN lock is the offline stand-in) | WebAuthn needs a secure `https://` origin; `file://` doesn't qualify | Stage A (static hosting over HTTPS) is enough for a local lock; stage B for real sign-in |
| 🌐 Installable app on the phone (home-screen icon, works offline) | PWA install requires `https://` | Stage A |
| 🌐 Bill reminders as phone notifications | Push needs a service worker on `https://` and a push server | Stage A (local reminders) / B (push) |
| 🌐 Live customer support chat | Needs someone to answer and a chat service | Stage B: chat widget (e.g. WhatsApp Business link or a support tool) |
| 🌐 Stock prices without asking the user for an API key | Price APIs need a key; keeping one secret needs a server | Stage B: small price proxy with the app's own key |
| 🌐 Live bank connections (automatic transaction sync) | Needs a bank-data aggregator and a server; 🔍 Ecuador coverage of aggregators (e.g. Belvo) must be verified | Stage C. Until then: CSV import |
| 🌐 Validate / download SRI invoices by "clave de acceso" | SRI web services can't be called from a local file (CORS) | Stage B server calling SRI |
| 🌐 Import Google Wallet / Apple Pay payments | No public API; Apple Pay has no export; Google Takeout exports may help (🔍 verify format) | Try CSV import of exports first; revisit with hosting |
| 🌐 Server-side OCR for better invoice reading | Browser OCR is limited | Stage B |

## Not planned ⛔ (logged for reference)

| Idea | Reason |
|---|---|
| ⛔ Credit scores (TransUnion / Equifax style) | US bureaus; in Ecuador credit reports are paid services that need the person's consent and a server. Revisit only with stage C. |
| ⛔ Mileage / GPS trip tracking | Needs GPS in the background and maps; outside a budgeting web app's scope |

---

## Hosting plan

**Stage A — static hosting over HTTPS (low cost, no backend).**
Publish the same app on GitHub Pages / Cloudflare Pages / Netlify. Data still stays on the
device, but `https://` unlocks: install as an app (PWA) with offline support, a local lock
with Touch ID / Face ID (WebAuthn), local bill reminders, and native share sheets.
Work: add a web manifest + service worker; keep the single-file build for offline use.

**Stage B — backend with accounts.**
Options: a managed backend (Supabase / Firebase) or a small API.
Unlocks: sign-in, end-to-end-encrypted sync across devices, household groups with
invitations and sharing permissions, a price proxy for investments, SRI invoice lookup,
server OCR, push reminders, support chat.
Requirements: Ecuador's **Ley Orgánica de Protección de Datos Personales (2021)** — consent,
data minimization, the right to delete; encryption at rest; a privacy policy.

**Stage C — bank connections.**
🔍 Verify which aggregators cover Ecuadorian banks (Pichincha, Guayaquil, Produbanco,
Bolivariano, cooperativas) and their cost. Until then the CSV importer covers "connect your bank".

## How to use this log

- New ideas: add a row with a status and the source (screenshot / message).
- When something ships, move it to **Done** with a one-line note.
- Items marked 🔍 need research before deciding.
