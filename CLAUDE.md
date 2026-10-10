# PlanCeroDeudas — notes for working on this repo

Dave Ramsey–style budgeting app (Baby Steps, zero-based budget, debt snowball). One codebase,
two editions:
- **ZeroDebtPlan (US)** — the main focus. English by default, Spanish switch. All states,
  Michigan first. Built to `dist/zerodebtplan-usa.html` and the phone app (`mobile/`).
- **Plan Financiero Ecuador** — Spanish, English switch. Built to `dist/plan-financiero-ecuador.html`.
  Maintenance mode: bug fixes and Ecuador-only features (SRI, IESS) when asked.

Plain HTML/CSS/JS, no framework, no server. Everything runs in the browser; data stays on the device.

## Layout
- `index.html` — all markup. `css/app.css` — styles (Tailwind CDN for utility classes).
- `js/engine.js` — pure calculations (taxes, debts, budgets, forecasts…), unit-tested in Node.
- `js/categorize.js` — reads bank/card statement lines (clean names, direction, MCC codes, guesses).
- `js/importers.js` — CSV/OFX/SRI XML parsing, rules, duplicates. `js/store.js` — state, saving, migrations.
- `js/defaults.js` (Ecuador) / `js/defaults-us.js` (US) — country packs: taxonomy, tax tables, new-state shape.
- `js/sample.js` — the example families (US: the Millers, Grand Rapids; Ecuador). Deterministic.
- `js/views/*.js` — one file per screen or card. `js/ui/core.js` — UI helpers. `js/app.js` — routing, undo.
- `js/i18n.js` + `js/i18n/es.js` (+ `ec.js`, `en.js`, `us.js`) — translation (see below).
- `mobile/` — Capacitor app; `mobile/build-www.js` builds `mobile/www` (offline, US edition).
- `tests/*.test.js` — unit tests (node:test). `tests/e2e/` — browser suites (Playwright). `tests/fixtures/` — invented test files.
- `docs/ROADMAP.md` — feature log and plans. `docs/MOBILE.md` — phone app build/install.

## Commands
```
npm ci && (cd mobile && npm ci)   # once per machine
npm run build                     # writes dist/ (sealed; needs mobile/node_modules; tests fail if dist/ is stale)
npm test                          # unit tests (fast; run often)
npm run build:mobile              # phone build (must run from mobile/ — the script does that)
npm run e2e                       # all browser suites (~6 min); `node tests/e2e/run.js us` runs matching ones
                                  # (e2e-sweep: every screen, phone + file, portrait + landscape)
npm run e2e:bounds                # every field with boundary values (~20 min; CI runs it in 3 parts:
                                  # `node tests/e2e/e2e-bounds.js "US phone" "patrimonio,config"` for some)
npm run e2e:lang                  # every screen and dialog in both editions and languages: nothing in the
                                  # wrong language (~13 min; CI runs it in 2 parts: `node tests/e2e/lang-sweep.js US`)
npm run check                     # all of the above, before pushing
npm run i18n:missing              # English text with no Spanish yet (report)
npm run i18n:spanish              # Spanish text left in the code (only shrinks)
```
CI (`.github/workflows/tests.yml`) runs the same on every push; `mobile.yml` builds the Android APK.
While developing, run `npm test` and the one suite you touched; run `npm run check` before pushing.

## Conventions
- Match the surrounding code: small functions, comments that say *why*, no new dependencies.
- New UI: `App.defineView`, `UI.register({ 'name.action': (el, e) => … })`, `data-action`/`data-change`/`data-input`.
- Changes that should be undoable go through `App.undoable(msg, fn)`; then `App.changed({ structural, step })`.
- New state keys: add them to `newState()` in `js/defaults.js` (the sample test checks the shape).
- Engine functions are pure and get a unit test in `tests/engine.test.js`.
- Category / type / payment names in data are **Spanish identifiers** (`'Gasto'`, `'Alimentación'`,
  `'Sueldo/Salario'`). They are saved in people's data: never rename them; they're shown translated.

## Translation
- The code is written in **US English**. `js/i18n/es.js` maps English → Spanish (`I18n.add('es', {...})`).
  New work goes in English only; `npm run i18n:missing` lists English text without Spanish yet
  (a report, not a test). Add the real ones to `es.js` in batches.
- `js/i18n/ec.js`: the Ecuador edition's own wording (IESS, DPF, cooperativas…) for English text,
  in English and Spanish (`I18n.override('EC', 'en'|'es', {...})`). Checked first.
- Saved data stays Spanish (`'Gasto'`, `'Alimentación'`, CD modalities…) and some older code is still
  Spanish: `js/i18n/en.js` (Spanish → English) and `us.js` (Ecuador → US Spanish wording) handle those.
- `tests/i18n.test.js` fails when new Spanish text appears in the code (`tests/i18n-spanish-left.json` is
  what's left, and it only shrinks: `npm run i18n:spanish` shows it, `-- --write` saves it after you move
  text to English or add a saved-data name). It also fails when Spanish text has no English entry.
- `${…}` in a template becomes `{0}`, `{1}`… in the key. Plurals: `day${n === 1 ? '' : 's'}` and in
  Spanish `día{1|s|}` (`{n|a|b}`: a when that piece is non-empty, else b).
- Avoid several placeholders side by side (`{2}{3}`): matching becomes ambiguous. Build messages from
  short sentences and translate each (`parts.map(I18n.t).join(' · ')`).
- The runtime splits text on " · " and " + "; a `<strong>` inside a sentence splits it into pieces.
- `data-i18n-skip` leaves an element alone (names people typed). Attributes translated: placeholder,
  title, aria-label, data-label. `<textarea>` is not translated.
- Regex literals with `'` confuse the extractor: write `\x27`.

## Privacy rules (always)
- Files people import (CSV/OFX/XML/photo/PDF) are read in memory and never stored.
- Never commit real personal or bank data — not in fixtures, tests, comments, docs or screenshots.
  Test data is invented. Screenshots go to `tests/e2e/out/` (ignored).
- Pay stubs keep only labels and amounts. `settings.priceKey` is never in backups.
- Device settings (theme, language, PIN) live apart from the budget: not in backups, not undoable.
- Files leave the app encrypted: `Native.saveSecure` (password → `js/vault.js`, AES-256-GCM). Use it for any
  new export; plain `Native.saveFile` only for a copy the person decrypts on purpose.
- The built file is sealed (scripts/build.js + scripts/vendor.js): no outside scripts, styles or fonts, and
  a Content Security Policy that only runs its own scripts. A new outside connection (an API) must be added
  to `connect-src` in `scripts/vendor.js` on purpose; never load code from a CDN at runtime.
- The 10th wrong PIN erases the app's data on the device (`Device.wipeAll`). With a PIN the saved plan is
  encrypted (js/device.js): the store saves through `Device.storage()`; App starts after `Device.whenReady`.

## Workflow
- `main` is releasable. One short branch per feature or batch; open a PR; merge when CI is green.
- Each finished feature: a row in `docs/ROADMAP.md` (short), then commit and push.
- Log anything that can't be done now in `docs/ROADMAP.md`.

## Plan (agreed 2026-10-04)
1. ✅ Tests in the repo + CI, this file, PR #1 merged.
2. ✅ Source language flipped to English: English text in the code, `es.js` for Spanish, `ec.js` for
   Ecuador wording; Spanish identifiers in data stay.
3. ✅ New work in English only (a test enforces it); Spanish catches up in batches (`npm run i18n:missing`
   lists what's pending; 0 after the first batch). The Ecuador edition may show some English between batches.
