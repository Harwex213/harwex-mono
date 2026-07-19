# M1 — Routing & page wiring

Goal: the full page flow works end-to-end with the pages that already exist; no new mechanics.

## Tasks

1. **`pages/battle/battle.js` → pure dispatcher.** Drop the 3-column workspace markup (superseded — the
   complete disposition UI lives in `battle-disposition.js`; the workspace layout is re-created for the
   ACTIVE page in M3). Keep only: read `MODEL.activeBattle.phase`, `router.replace()` per the existing
   `BATTLE_PHASE_ROUTES` map (currently defined but unused at `battle.js:138-142`); phase `null` →
   battle-creation. Register it like the other render-nothing redirects in `index.js`.
2. **Register subroutes** in `src/index.js`: `ROUTES.BATTLE_DISPOSITION`, `ROUTES.BATTLE_ACTIVE`,
   `ROUTES.BATTLE_FINISHED` (constants already exist in `data/routing.js:4-7`) → the three pages.
3. **Wire `battle-disposition.js`**: migrate its signature from `(params, router)` + `querySelector("main")`
   to the current `index.js` convention used by `battle.js`. No behavior changes.
4. **Fix `battle-finished.js` imports**: `../data/…`, `../modules/…` → `../../…` (currently broken, the
   module would fail to load).
5. **Migrate `battle-active.js` / `battle-finished.js`** placeholders to the canonical signature.
6. **Phase guards** on each subpage, first thing in render: if `MODEL.activeBattle.phase` doesn't match the
   page, `router.replace(ROUTES.BATTLE)` and render nothing.
7. **Battle-creation guard**: while phase is DISPOSITION or ACTIVE, `router.replace(ROUTES.BATTLE)` (a stale
   history entry must not restart over a live battle). Phase FINISHED or `null` → creation renders normally.
8. **`ACTIVE_BATTLE_MODULE.reset(activeBattle)`**: returns state to the pristine shape
   (`startBattleDisposition` guards `phase !== null`, so a finished battle currently blocks any new one).
   Battle-creation calls it before `startBattleDisposition` when phase is FINISHED.
9. **CLAUDE.md cleanup** (separate commit, shown to the user for review): remove the `/game` routing
   description that was never implemented; align the page-lifecycle signature text with the real
   `index.js` convention.

## Done when

- `yarn test` passes; new test for `reset`.
- `/verify` walkthrough: creation → start → lands on `/battle/units-disposition`; place all units → start
  battle → `/battle/active` (placeholder); deep-link `#/battle` and each subpage in every phase redirects
  correctly; back-button to creation mid-battle bounces to `/battle`.
