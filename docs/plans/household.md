# Plan: the household, person by person (asked 2026-10-09)

The user: "can we make the assumption that the extra member of the household would also have their
income reduced due to taxes like the main user? … the tools [should] differentiate between the
household members, for tax, savings, expenses purposes."

Today the main earner has a full paycheck (salary or hourly, bonuses, pre-tax deductions, federal,
FICA, state and city tax). Anyone else's pay is a monthly income line typed as take-home, with a
`memberId`. Transactions, rules and the Spending tool already say whose (`memberId`, Household).

One PR per step; `npm run check` green; a ROADMAP row; mark ✅ here when merged.
Ask: **"Do step N of docs/plans/household.md"** (or "continue the household plan").

## Steps
1. ✅ **Every earner's paycheck is taxed** (US first; Ecuador taxes each person on their own).
   - An income line can be a member's **paycheck**: `line.pay = { sueldo, payType, hourly, bonuses,
     payDeductions }`, the same shape as the main paycheck. Its take-home is computed, not typed.
   - Taxes on the household: married filing jointly → federal and state tax on the combined
     income (one standard deduction, the joint brackets), shared out by each one's taxable wages;
     single / head of household → each person on their own (the others as single). Social Security
     and Medicare per person (each up to the wage base); city tax per person (resident or not).
   - Budget → Income: each paycheck shows gross → taxes → take-home; the setup guide asks the
     others' pay before taxes ("take-home" stays possible for a pension or anything untaxed).
   - Refund / W-4 check counts both earners' wages and withholding.
2. **Savings per person**: retirement accounts and contributions say whose; the retirement tool
   per person (age, Social Security from each one's earnings); 401(k)/IRA limits per person.
3. **Expenses per person**: a budget line can belong to someone; a per-person summary (earned,
   taxes, spent, saved) and "who spends on what" in Reports.
4. **Tax tools per person**: side-income tax set-aside per person, itemizing on the joint return,
   each W-4.

## Notes
- New saved fields get defaults in `newState()` / `newYear()`; each engine change gets a unit test.
- Old take-home lines keep working unchanged (no `pay` = typed take-home).
