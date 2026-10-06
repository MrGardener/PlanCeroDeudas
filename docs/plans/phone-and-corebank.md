# Plan: phone fixes + "personal finance" views (US edition first)

Asked 2026-10-04 after testing the Android app. Ideas come from the screenshots and the feature list at
corebank.com/personal-finance (Trends, Accounts, Transactions, Spending, Budgets, Debts, Net Worth,
Goals, Cash Flow). The videos can't be watched from here; each step below says what we build instead.
Main target: the phone app and the HTML file (same code). One PR per step; each ends with
`npm run check` green and a ROADMAP row. Mark a step ✅ here when merged.

Ask: **"Do step N of docs/plans/phone-and-corebank.md. Open a PR, merge when CI is green, report in 5 lines."**
(or "continue the plan" to take the next open step).

## A. Fixes from phone testing
1. ✅ **Keyboard hides the field you're typing in** — on Android the page jumps and the field ends up
   off-screen. Let the app shrink when the keyboard opens (Android `adjustResize`), and scroll the focused
   field to the middle of what's visible (`visualViewport`), in pages and in sheets/dialogs.
2. ✅ **Chart values cover the chart** — the tooltip box goes away. A readout line under each chart shows
   the values of the tapped point; a thin vertical marker on the chart shows where it is.
3. ✅ **Edit a rule** — rules can only be deleted. Tap a rule to edit everything it does (text, name,
   type, category, subcategory, person, income link) with the same form used to create it.
4. ✅ **Categories you can find and change** — "Manage categories" is buried in Transactions. Move it to
   Settings (plus a link from the category picker), add **rename** (category and subcategory, carried to
   transactions, rules, budget lines and the list) and **add subcategory**. Saved names stay as they are
   unless you rename them.
5. ✅ **Household, not a person** — a "Household (shared)" choice next to each person, for transactions,
   rules and imports; reports show it as its own column. Bills (utilities, rent, mortgage, insurance)
   default to Household; "no one" stays for "not set".

## B. Imports, accounts and reconciling
6. ✅ **Import into an account** — every import asks which account the file is from: checking, savings or
   **credit card** (new account kind, its balance is what you owe). Transactions remember their account;
   a card payment from checking becomes a transfer between the two (not spending twice). Each account
   keeps a balance: from the file's balance column, or opening balance + transactions. "Accounts" lists
   them all in one place with totals (cash, credit, loans, investments).
7. ✅ **Last import marker** — each account remembers the date of the last imported transaction. Next time,
   rows on or before it are flagged "before your last import" and unchecked; a banner says from which
   date the new ones start. Can be moved back by hand.
8. ✅ **Manual vs. imported** — transactions show where they came from (typed / imported / scheduled).
   Importing matches typed ones (already exists) and marks them **reconciled**; a "Not reconciled" filter
   lists typed transactions no statement has confirmed yet, per account.

## C. First run
9. ✅ **Step-by-step start** — on first open, one screen that walks through: household → how you're paid
   → accounts and balances → main bills → debts → done (each step a short form, no jumping between
   tabs; skip allowed). It doesn't come back unless you open it from Settings.

## D. Views like the bank's "personal finance" tools
10. ✅ **Spending** — a donut by category for a month (or 3M/6M), total in the middle; tap a slice to see
    its transactions; per person or household.
11. ✅ **Trends** — stacked areas by category per month with an income line; 3M / 6M / 9M / 1Y; all
    categories or one; filter by account.
12. **Budget bubbles** — a bubble per category sized by budget, colored green / yellow / red by how much
    is spent; tap to see the line. A toggle next to the current table view.
13. **Cash flow** — daily balance for the next 30/60/90 days with a "today" line and the area below $0
    in red; **cash events** (one-off bills or deposits you add) show on it.
14. **Debts chart** — stacked areas of each debt paying down to the debt-free date, with the table (APR,
    payment, payoff date) — check what Debts & Goals already shows and add only what's missing.
15. **Net worth over time** — line of net worth by month with assets and liabilities, from the monthly
    snapshots already saved — again, only what's missing.

## Notes
- Every new text in English with Spanish in `es.js` (CLAUDE.md → Translation).
- New saved fields get defaults so older data keeps working; tests for each engine change.
- Goals already exist (Debts & Goals); no step unless testing shows a gap.
