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
js/device.js            this device only: theme (light/dark/auto) and PIN lock — never in backups
js/format.js            money/percent formatting, HTML escaping
js/defaults.js          default budget template, categories, sample data, new-year factory
js/engine.js            ALL financial math — pure functions, no DOM (payroll/SRI, budget,
                        DPF projection, debts, goals, mortgage, retirement, net worth)
js/importers.js         CSV / SRI invoice XML / receipt text parsing — pure, no DOM
js/store.js             the single state object: autosave, migrations, baselines, reset
js/ui/core.js           event delegation, dialogs, toasts, chart helper
js/app.js               tab registry, router (#hash), bindings, render orchestration
js/views/*.js           one file per tab: render() on structure changes, update() for numbers
tests/                  node:test unit tests (engine, store/migration, build)
scripts/build.js        inlines everything into dist/
```

Data flows one way: input → handler updates `Store.state` → `App.changed()` → autosave +
re-render of the visible view. `update()` never recreates inputs, so typing keeps focus.

## Develop

```
npm test          # unit tests (Node 18+, no dependencies)
npm run build     # regenerate dist/ after editing sources (a test checks it's current)
```
