# Plan: hourly pay, overtime and bonuses (US edition)

Agreed 2026-10-04. One PR per phase; each ends with `npm run check` green. **Done: phases 1–4 (PRs #4–#7).**
Ask: **"Do phase N of docs/plans/hourly-pay.md. Open a PR, merge when CI is green, report in 5 lines."**

## Why
Today the US edition knows one number: a monthly gross salary (`yd.sueldo`). Taxes, take-home, the
budget, retirement and the health score all start from it. Hourly workers have to guess it, and
overtime and bonuses are never in the tax estimate.

## Approach (Ramsey)
Budget on the base pay you can count on; give overtime and bonuses a job when they arrive.
- Taxes are estimated on the **whole year** (base + usual overtime + bonuses).
- The **monthly budget** uses base pay, plus overtime only if the person says so
  ("count my usual overtime in the budget"). A bonus counts in its month only if marked "plan it".
- Ecuador is untouched (its décimos stay as they are).

## Data (per year, US only; missing = salary, so old saved data works unchanged)
- `yd.payType`: `'salary'` | `'hourly'`.
- `yd.hourly`: `{ rate, hours, otHours, otRate: 1.5, otInBudget: false }` — hours are per week.
- `yd.bonuses`: `[{ id, name, amount, month: '1'…'12', inBudget: false }]` — gross amounts.
- `yd.sueldo` stays the monthly gross the rest of the app reads; with hourly pay the Income screen
  keeps it equal to the base monthly gross (phase 2).

## Phases
1. **Engine** — `Engine.usGrossPay(yd)` → `{ payType, baseM, overtimeM, budgetM, bonusesY, annual }`
   (52 weeks / 12 months). `payrollUS` taxes the annual total and gives the budget its share
   (`netoM` for `budgetM`); `bonusForMonth` adds planned US bonuses, net at the year's average tax
   rate. New fields in `defaults-us.js` `newYear()`. Unit tests, including "salary with no bonuses
   gives exactly the old numbers".
2. **Income screen** — "How you're paid: Salary / Hourly"; hourly fields with the monthly figure
   live; bonuses list; overtime toggle with a one-line Ramsey tip. Spanish in `es.js`; US browser checks.
3. **Extra-paycheck months** — weekly/biweekly pay: name the months with a 3rd (or 5th) paycheck;
   a "Next moves" card: give it a job (the current Baby Step).
4. **Pay stub scan + refund check** — the scan fills rate, hours, overtime and bonus lines; the
   refund-or-owe check counts bonuses (usually withheld at a flat 22% federal).

## Risks
- Payroll feeds take-home, budget and retirement: phase 1 is engine-only with tests first.
- Old saved data: a missing `payType` means salary (tested).
