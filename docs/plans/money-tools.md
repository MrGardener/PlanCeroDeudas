# Plan: the bank's 9 "personal finance" tools, on the phone (US edition first)

Asked 2026-10-06 with a master plan (`complete_master_development_plan.md`) and 28 screenshots of
corebank.com/personal-finance (Transactions, Accounts, Trends). Main target: the phone app and the HTML
file (same code). One PR per step; each ends with `npm run check` green and a ROADMAP row. Mark a step ✅
here when merged.

Ask: **"Do step N of docs/plans/money-tools.md. Open a PR, merge when CI is green, report in 5 lines."**
(or "continue the money tools plan" to take the next open step).

## Already built (docs/plans/phone-and-corebank.md)
Spending donut, Trends stacked areas (3M/6M/9M/1Y), Budget bubbles, Cash flow 30/60/90 with cash events,
Debts stacked payoff, Net worth assets/liabilities by month, accounts with credit cards and balances,
import into an account with "last import" marker, typed / imported / scheduled, rules you can edit,
categories you can rename, Household. The steps below add what the screenshots and the master plan show
on top of that: one way in to every tool, and the drill-downs (level 1 → 4).

## How the master plan maps to this app
- **No bank login / sync** (Plaid, MX, OFX direct connect): it needs a server and sends bank credentials and
  data off the phone; this app keeps everything on the device (CLAUDE.md → Privacy). Accounts are added by
  hand and filled from CSV / OFX / QFX statements, as today.
- **No React, PostgreSQL or framer-motion**: plain HTML/CSS/JS and the saved state. The plan's tables map to
  `accounts`, `transactions`, `taxonomy`, budget lines, `debts`, `goals`. Drill-downs open as sheets (they
  slide up on the phone).
- **Our design system stays**: light and dark, the color-blind-checked chart palette, status colors with an
  icon and a word. No bank logos or ads: accounts show a type icon or the first letters of the bank.

## A. One way in
1. ✅ **Tools bar + Help** — an icon bar (scrolls sideways on the phone) at the top of Overview: Accounts,
   Transactions, Spending, Budgets, Trends, Debts, Net Worth, Goals, Investments, Cash Flow; each opens its
   screen. A "?" opens a Help grid (12 tiles: the 10 tools + Alerts, General, Mobile), each with a short
   how-to.

## B. Accounts (tool 1)
2. ✅ **Accounts hub** — everything you have and owe in one list, by type (Checking, Savings, Cash, Investment,
   Property, Credit card, Mortgage, Loan) with each type's total (owed in red). On the phone the types are
   chips at the top that jump to their section. "+ Add an account" (balance, name, type; Property asks
   real estate / vehicle / other). Reads accounts, CDs and investments, assets and debts; a card linked to
   its debt counts once.
3. ✅ **Account details** — tap an account: name, type and balance; **Activity** tab: 12 months of money out vs
   money in (bars) and the account's transactions; **Details** tab: name, type, interest rate, minimum
   payment, payment due day, credit limit, original balance. Editing a card or loan here changes its debt
   in the snowball (and the other way round).

## C. Transactions (tool 2)
4. ✅ **Ledger toolbar** — date range: Today, This month, Last month, Last 7 / 30 / 90 days or from–to, with
   ‹ › to step back and forward; account picker grouped by type with checkboxes and All; search ("No
   transactions found"); download what's shown (CSV); money in shows green with "+".
5. ✅ **Transaction details** — tap a row: payee (editable) with the bank's original text under it (kept on
   import from now on), date, category (a picker with search, grouped by category, "+ Add subcategory"),
   tags, memo. "…" menu: **Flag**, **Exclude** (kept, but left out of budgets, reports and totals),
   **Split**. Filters for flagged and excluded.

## D. Drill-downs (tools 3–5)
6. ✅ **Spending wheel** — tap a category: the donut shows its subcategories, with a banner (total, share of
   spending, vs the period before) and "View transactions" (grouped by payee). Back returns to categories.
7. ✅ **Smart budget** — "Suggest from my last 90 days": average monthly spending per line, rounded, in a
   preview where you accept line by line. In the bubble sheet: a slider to change the target and a pace bar
   (where spending should be by today, what's left per day).
8. ✅ **Trends drill-down** — tap a month: its categories vs the period's average (up / down); tap a category:
   its subcategories; tap one: its transactions.

## E. Plans (tools 6–9)
9. ✅ **Debt payoff controls** — an "extra each month" slider that moves the debt-free date and interest saved
   as you drag; tap a debt: its schedule (month, payment, interest, principal, balance). Unit test:
   $10,000 at 5% paying $200 matches a standard amortization table to the cent.
10. **Balance sheet** — Net Worth: what you own vs what you owe, by type, each with its total; tap a type to
    see its accounts and edit a manual asset; the net worth line updates.
11. **Goals** — cards with progress and status (on track / behind for its date); a monthly-amount control
    that recalculates the date (unit test); link a goal to a savings account (its balance is the progress);
    saved per month over the last months.
12. **Cash flow calendar** — Chart | Calendar toggle on Cash flow; tap a day: what comes in and goes out and
    the balance, "+ Add expected transaction" for that day; list of repeating items with their next date.

## F. Later
13. **Alerts** — an inbox with a badge: balance going below $0 (or your cushion), a budget line over, a bill
    due in 3 days, an unusually large transaction. In the app only (no push).

## Notes
- Every new text in English with Spanish in `es.js`; Ecuador edition gets the same tools.
- New saved fields get defaults (`newState()`), so older data keeps working; tests for each engine change.
- More screenshots (Spending, Budgets, Debts, Net Worth, Goals, Investments, Cash Flow detail views) can
  refine steps 6–12 before they're built.
