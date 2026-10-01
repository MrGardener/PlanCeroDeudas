# PlanCeroDeudas — Plan Financiero Ecuador

Zero-based budget, debt snowball, DPF savings, retirement and net worth for Ecuador's
dollarized economy (IESS/SRI payroll, décimos, COSEDE-insured pólizas), organized around
Dave Ramsey's Baby Steps.

## Use it

- **Open `index.html`** in a browser (double click). No server or install needed.
- **Share it as one file:** `dist/plan-financiero-ecuador.html` has everything inlined.
- Data is saved automatically in the browser (localStorage). Use *Configuración → Tus Datos*
  to download or load a backup `.json` (backups from the previous version load too).

## Roadmap

Every requested feature, what's done, what's next, and what waits for hosting (with the
reason and what it needs) is logged in [`docs/ROADMAP.md`](docs/ROADMAP.md).

## Structure

```
index.html              markup for every tab (no logic)
css/app.css             shared components: cards, fields, buttons, KPI tiles, tables
js/i18n.js              language layer: translates what's on screen from the Spanish source
js/i18n/us.js           US edition's Spanish wording (Seguro Social, CD, talón de pago…)
js/i18n/en.js           English dictionary (tests/i18n.test.js fails if a Spanish text lacks one)
js/device.js            this device only: language, theme (light/dark/auto) and PIN lock — never in backups
js/native.js            phone app bridge (share sheet, back button, native copy of the data); no-op on the web
js/format.js            money/percent formatting, HTML escaping
js/defaults.js          default budget template, categories, sample data, new-year factory (Ecuador)
js/defaults-us.js       US edition: budget, sample data, 2026 federal tax tables, states, Michigan cities
js/engine.js            ALL financial math — pure functions, no DOM (payroll/SRI, budget,
                        DPF projection, debts, goals, mortgage, retirement, net worth)
js/importers.js         CSV / SRI invoice XML / receipt text parsing — pure, no DOM
js/store.js             the single state object: autosave, migrations, baselines, reset
js/ui/core.js           event delegation, dialogs, toasts, chart helper
js/app.js               tab registry, router (#hash), bindings, render orchestration
js/views/cash.js        safe to spend + money calendar (shared by the Resumen cards)
js/views/whatif.js      "¿Y si compro…?" sandbox (nothing saved)
js/views/*.js           one file per tab: render() on structure changes, update() for numbers
tests/                  node:test unit tests (engine, store/migration, build)
scripts/build.js        inlines everything into dist/
scripts/i18n-extract.js lists every Spanish text the app can show (translation keys)
mobile/                 phone app (Capacitor: Android + iOS) built from the same code — docs/MOBILE.md
.github/workflows/      cloud builds: tests, Android test APK, iOS compile on a macOS runner
```

Data flows one way: input → handler updates `Store.state` → `App.changed()` → autosave +
re-render of the visible view. `update()` never recreates inputs, so typing keeps focus.

## Editions

One codebase, one file per country (`npm run build` makes both):

| File | Edition | Default language |
|---|---|---|
| `dist/plan-financiero-ecuador.html` | Ecuador (IESS, SRI, décimos, DPF/COSEDE) | Spanish |
| `dist/zerodebtplan-usa.html` | ZeroDebtPlan, United States (federal + FICA + Michigan/state + city tax, 401(k)/HSA, Social Security, FDIC CDs, PITI, OFX) | English |

Both switch between English and Spanish. While developing, open `index.html?edition=us` for the US edition.
Each edition saves in its own browser storage, so both can be used on the same device.

**Phone app:** ZeroDebtPlan for Android and iPhone lives in `mobile/` (same code, works offline).
Every push builds a test APK in GitHub Actions → Phone app → Artifacts. See [docs/MOBILE.md](docs/MOBILE.md).

## Develop

```
npm test          # unit tests (Node 18+, no dependencies)
npm run build     # regenerate dist/ after editing sources (a test checks it's current)
cd mobile && npm ci && npm run sync   # phone app: build mobile/www and copy it into android/ and ios/
```
