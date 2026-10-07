# Plan: the bank's tools, second pass (from the screenshots, 2026-10-06/07)

The user sent screenshots of corebank.com/personal-finance tool by tool (Spending, Budgets, Net Worth,
Cash Flow, Goals, "more to come"). Each step copies how the bank's tool behaves, in our design system
(light/dark, color-blind-checked palette, status = color + icon + word), on the phone first. No bank
login or server: accounts are typed or filled from statements. One PR per step; `npm run check` green;
a ROADMAP row; mark ✅ here when merged.

Ask: **"Do step N of docs/plans/bank-tools-2.md"** (or "continue the bank tools plan").

## Done before this plan
- ✅ Trends drill-down (PR #37): tap a band → its card by month; again → its subcategories with ←;
  a subcategory → its transactions with ←; the income line → its card.
- ✅ Spending (step 1 below).

## Steps
1. ✅ **Spending** — date range with ‹ › and presets (Today, This/Last month, Last 7/30/90 days, from–to);
   Spending | Income tabs; tap a category: highlighted, the middle shows its name and amount and "Select to
   view transactions"; tap again: its subcategories in an inner ring, the outer ring faded, "‹ Back" and
   Total; the middle opens the transactions (Date, Payee, Category, Account, "End of the list", ← back);
   a transaction opens its details; its category opens "Select a category" (search, expandable,
   "+ Add new subcategory"); picking one says "Category updated" and Back returns to the list.

2. ✅ **Budgets — start and summary**
   - First visit (no plan for the month yet): "Understand the health of your finances" with the bubble legend
     (green 0–79% used, yellow 80–100%, red over budget), **Auto-generate budgets** (from the last 90 days,
     `Engine.suggestBudget`) and "No thanks, I'll start from scratch".
   - Header: Bubbles | List toggle, month navigator ‹ October 2026 ›, "+ Manage budgets".
   - Bubbles: one per category, size by budget, category icon, "$spent / $budget", ring shows the part used;
     color by state. **Drag** a bubble: the others move aside and settle again (simple physics, no library).
   - Bottom panel (collapsible ˄/˅): Spent bar "Spent $4,696 of $5,059 budgeted"; Income bar "Earned $5,986
     of $5,981 projected income" (projected income editable); "$922 unbudgeted".

3. ✅ **Budgets — a bubble's details**
   - Tap a bubble: header ← and the month; the bubble big with **pencil** (edit) and **+** (sub-budgets).
   - 12-month bar chart of its spending, this month darker, a dashed line at the budget; tap a month: its
     value. "View transactions".
   - Pencil → "Edit Home budget?": "Total unbudgeted: $922", amount field, Cancel / Save, "Delete Home
     budget" (undoable); × closes.
   - + → "Add sub-budget": the category's subcategories (pick one to give it its own budget) and
     "+ Add a subcategory".

4. **Net Worth like the bank's**
   - 6M | 9M | 1Y; "Current net worth" and "View assets & liabilities"; a line with points and a soft fill
     (green going up, gray going down from the month before).
   - Tap a month: "Jan 2026 net worth" and "From previous month" (green +, red −), and a
     "Jan 2026 – Gains & losses" button.
   - Assets & liabilities sheet (←): Assets total, Checking / Savings / Investment / Property with totals;
     tap a type: its accounts under it (e.g. Property → home, car, laptop); Liabilities: Loan, Credit card,
     Mortgage. Accounts add more properties ("+ Add a property").
   - Gains & losses sheet (←) for the month: Gains (accounts that grew, or debts that shrank) and Losses,
     each with its total and per-account change. Needs per-account month-end balances (snapshots).
   - Accounts → a property: "Account history" bars by month; tap a month: its value and "View transactions".

5. **Cash Flow like the bank's**
   - First visit: 3 intro pages with dots (Your cash past, present & future → Forecast your cash flow →
     Cash events: paid / past due / upcoming) and **Get started**.
   - Header: Chart | Calendar, "N account(s) ˅" picker (All, grouped by type with checkboxes; unchecking one
     changes "Current cash available" and every day's balance), "+ Add an event".
   - Chart: past solid, the future shaded with "Today"; ‹ date range ›, Today, Month | Year.
   - Calendar: each day's ending balance, ↑ money in / ↓ money out marks; ‹ Dec 2026 ›, This month.
   - Right column: the month's events (✓ paid with "Paid Dec 2", ! past due "3 days ago", ○ upcoming).
   - "Add a cash event": **Suggested** (repeating payees found in transactions: name, category, "Last
     occurred", amount, ✓ / ✗; ✓ asks how often: No repeat, Weekly (Fridays), Every other week, Monthly
     (on the 2nd), Monthly (on the 1st Friday), Quarterly, Yearly, with a "Starting…" calendar and Create;
     the card turns into "Created") | **All transactions** | search | **Create manual event** (payee, amount
     with Expense/Income switch, account, category, Occurs… with the same picker).

6. **Goals like the bank's**
   - First visit: "Welcome to Goals" and Get started.
   - Header: "Total monthly contribution", "+ Add a goal", "Manage".
   - A timeline (years going into the distance) with each goal's icon at its projected date.
   - Add a goal → type: **Savings** (Emergency fund, Automobile, College, Home, Recreational, Vacation,
     Electronic, Other → name, amount to save, account to link with its balance → progress "$0 / $1,000, 0%"),
     **Debt payoff** ("Select debts to track": the debts with checkboxes, one goal each), **Retirement**.
   - Manage: Retirement ("Add retirement goal"), Savings (n goals, "needs attention", $ a month), Debt payoff
     (n goals) and the total monthly contribution.
   - Debt payoff: "Additional monthly contribution to the top debt" (pencil → field and Save; the dates move),
     In progress ordered by a menu: Highest interest first, Fastest payoff first, Lowest balance first
     (the snowball, our default), Highest balance first; each "Pay off X — projected Jun 2028 — $120 +
     monthly"; tap one: Goal details (account, minimum payment, interest, payment due, progress) and "…".
   - Savings (from Manage): "Monthly contribution to the top savings goal" and Save; In progress with the
     projected date and a red ! when it needs attention (date too far or behind).
   - Retirement goal: birthday, retirement age (65), desired savings, current savings = the retirement
     accounts you tick ("Include all accounts contributing to your retirement", "Add it here"), "Assumes a
     6.0% annual rate of return"; progress "$0 / $500,000".
   - Manage shows "You've overbudgeted your goals: your total contribution is $621 higher than what's left
     in your budget" when the goals ask more than the month's unassigned money.
   - The timeline scrolls (a slider on the left from Now to the farthest goal's year) to reach far-off goals.

7. **Security A: PIN wipe and encrypted exports** (asked 2026-10-07)
   - The wrong-PIN count is saved on the device, so reloading doesn't reset it. After 5 wrong tries
     there's a 30-second wait. The 10th wrong PIN erases everything this app saved on the device
     (budget, backups kept in the browser, device settings) and closes the app on the phone. The lock
     screen counts down ("3 tries left before the data is erased").
   - Backups are always encrypted with a password you choose: AES-GCM 256 with a key from PBKDF2-SHA-256
     (600,000 rounds, random salt and IV). The file is `.zdpbackup`. Loading one asks for the password.
     Older plain `.json` backups still load.
   - Other downloads (transactions CSV, reports) are encrypted the same way by default. "Download
     unencrypted" needs an explicit confirmation. Settings → "Open an encrypted file" decrypts one.
   - Unit tests cover encrypt → decrypt, a wrong password and a changed byte (tamper). Browser tests
     cover the 10-try wipe.
8. **Security B: data encrypted on the device** — with a PIN or passcode set, the saved budget is stored
   encrypted with a key derived from it (it's decrypted in memory after unlocking and never written in
   the clear). A longer passcode (letters allowed) is offered, because a 4-digit PIN can be guessed
   offline by someone who copies the storage. Also: the clipboard is never used for amounts; there's an
   optional "hide amounts" privacy mode; the screen is hidden in the phone's app switcher (Android
   FLAG_SECURE).
9. **Full check of the phone app and the computer file** — every screen, button, field and label, in
   portrait and landscape (phone and tablet sizes); a parity list showing that every tool works the
   same in the phone app and the HTML file; fix what's broken without removing features. Browser suites
   for landscape layouts (no sideways scroll, sheets fit, keyboard doesn't hide inputs).

## Notes
- English in the code, Spanish in `es.js`; the Ecuador edition gets the same tools.
- New saved fields get defaults in `newState()`; each engine change gets a unit test.
- More screenshots are coming (Investments and the rest); refine the steps above before building them.
