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
| ✅ Automatic categorization rules | "Contains X → category / budget line"; applied on import and while typing a new transaction |
| ✅ SRI electronic invoice import (XML) | Supplier, RUC, number, date, total, IVA, items, payment type; the same invoice twice is detected by its access key |
| ✅ Invoice / receipt photo (OCR) | Best effort in the browser (Tesseract.js, needs internet the first time); prefills the form for review |
| ✅ Household members | Configuración → Tu hogar; "¿Quién?" on each transaction, filter by person, "Aportes del hogar" (income/expense share per person). Real-time sharing between phones still needs hosting (below) |
| ✅ This-month dashboard | Spent vs. last month (daily curve + plan), cash flow with ▲▼ vs. last month, top expenses, "Puedes gastar hoy" (daily limit from flexible lines), next payday (Ingresos → Días de pago), insights: projected month-end spend, where most money goes, biggest jump / drop |
| ✅ Repeating / scheduled transactions, subscriptions list | "Repetir" when registering (future date = scheduled) or the repeat button on a transaction; posted automatically when due (on opening the app), undoable; monthly cost of subscriptions and scheduled income |
| ✅ Deleted transactions bin | Kept 60 days; restore or delete for good |
| ✅ Goals with a target date (sinking funds) | Monthly needed to arrive on time (with DPF interest), "A tiempo" / "Atrasada", progress bar, "Depositar" (optionally logged on the goal's budget line) |
| ✅ Custom reports + export | Presupuesto → Reportes: any period, group by category / subcategory / budget line / person / month / week / place / payment; CSV (Excel/Sheets, re-importable) and print to PDF |
| ✅ Investments: ETF / stocks / funds | Ticker + units; price from Finnhub or Alpha Vantage with the user's free key, or typed by hand; flows into net worth. The key never goes into backups |

## Phase 3 — planned (works without a server)

| Feature | Source / notes |
|---|---|
| 📋 Custom budget groups (Dar, Vivienda, Comida…) and nested groups | EveryDollar desktop, "Car Money" style |
| 📋 Per-line detail: monthly history vs. limit, its transactions | MoneyCoach budget detail |
| 📋 Split a transaction across budget lines | EveryDollar "Add a split" |
| 📋 Baby Steps roadmap: net worth today vs. projected, debt-free date, debt paid progress | EveryDollar roadmap |
| 📋 Accounts with balances (checking, savings, card, cash) | Rocket Money / Empower |
| 📋 Quick entry (amount keypad + category tags) | Nudget |
| 📋 History grouped by week/month with category totals | Nudget history |
| 📋 Dark mode | Nudget settings |
| 📋 Share a read-only report (file / print) | Until hosting allows real sharing |
| 📋 Streaks / motivation | EveryDollar streaks (logging every day) |
| 📋 App lock with a PIN | Honest caveat: without hosting the data in the browser is not encrypted; a PIN only hides the screen |

## Needs hosting / a server 🌐

| Feature | Why not now | What it needs |
|---|---|---|
| 🌐 Sync the budget across phone and computer | No server to hold the data; localStorage is per browser | Hosting + accounts + encrypted sync (see stage B) |
| 🌐 Shared household / group budgets with invitation codes ("Start / Join group", review what is shared) | Two people's devices can't talk without a server | Accounts, groups, invitations, per-item sharing permissions |
| 🌐 Sign in with Touch ID / Face ID | WebAuthn needs a secure `https://` origin; `file://` doesn't qualify | Stage A (static hosting over HTTPS) is enough for a local lock; stage B for real sign-in |
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
