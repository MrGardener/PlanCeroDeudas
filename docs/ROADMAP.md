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
| ✅ "¿Y si compro…?" sandbox | Resumen → safe-to-spend card: one purchase, three ways side by side — this month's budget (which lines it would empty, free money first, fixed bills never touched, what's still missing, effect on safe-to-spend), savings (emergency-fund months, Baby Step), credit card in N installments (monthly payment, interest, debt-free date, whether the debt budget covers it; rate 0 = diferido sin intereses). Nothing saved; "Registrar la compra" prefills the form |
| ✅ Quick entry from a link or a key | `#rapido` at the end of the app's address opens quick entry (copy it from Configuración → Este dispositivo and save it as a bookmark); key N on a computer. Home-screen icon / Android shortcut → stage A; lock-screen widget → native app ⛔ |
| ✅ Any pay rhythm | Ingresos → ¿Cómo te pagan?: fixed days of the month (15 y 30, last day; every 1/2/3/6/12 months; weekend → Friday before or Monday after), every week or every 2 weeks on a weekday, certain weeks of the month (2.º y 4.º viernes, the last one), every day or weekdays only; optional amount per payment (otherwise the yearly net pay spread over the year's paychecks, décimos on top). Preview of the next paydays. Calendar, safe to spend and "próximo día de pago" follow it. Repeating transactions can also be every 3 or 6 months |
| ✅ Forecast in the trend lines + projected balances | Transacciones → Tendencia: "Próximos N" (weeks / months / years, or none); dashed projected income (salary on its paydays, other planned income, repeating income) and money out (budget plan, or the last-3-months average); "Hoy" marker; projected rows in the table. "Saldos proyectados": cash, savings & investments (with DPF interest) and debts (snowball plan) month by month; paid-off debt payments roll into savings. A biweekly year with 27 paydays shows the extra check |
| ✅ Paycheck deductions + pay stub reading | Ingresos → "Descuentos de tu rol de pagos": insurance (health, dental, vision, life, car), garnishments (pensión alimenticia / child support), loans (IESS quirografario, 401k loan; link to the debt → paid by payroll, not a budget line), retirement (ahorro voluntario, 401k/403b/457, HSA → counts for Baby Step 4), union dues, employer match (informational, adds to retirement). Reads a PDF (pdf.js) or photo (Tesseract) of a rol de pagos or US pay stub in English/Spanish: gross, net, pay period → paychecks a year, each deduction with its type; review before saving; IESS / income tax already computed are recognized; checks the stub's net against the app. Only labels and amounts are kept; the file and ID numbers are not |
| ✅ English / Spanish | Configuración → Este dispositivo (and EN/ES in the header on a computer). Spanish stays the source; js/i18n/en.js translates every text on screen, tooltips, dialogs, toasts and chart labels, including sentences with values; month/weekday names and dates follow the language. A unit test fails when new Spanish text has no English |

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
