# @hw/faenwald-battle-prototype

A small React prototype for the Faenwald battle screen, built on a strict
**three-layer architecture**: API → Model → View.

```
src/
  api/      # API layer — transport, never knows about React or MobX
    request.ts        # generic `request()` with request/response/error interceptors
    interceptors.ts   # default interceptors (headers, logging, error normalisation)
    mock.ts           # mock adapter serving canned data + preset scenarios (swappable transport)
    battle-api.ts     # domain calls built on request() (loadBattle, listScenarios)
    types.ts          # transport DTOs (board tiles + unit placements)
  model/    # Model layer — MobX observable domain state + pure engine helpers
    catalog.ts        # the unit catalog (§4): per-100, rank-II base stats
    hex.ts            # axial/cube hex math (§2.1) — pure
    zones.ts          # facing & the three zones (§2.2) — pure
    terrain.ts        # terrain reference table (§10)
    stats.ts          # rank → count → degradation effective stats (§3.2-3.4) — pure
    combat.ts         # resolveAttack: the §9 damage pipeline (dual channel, cap, rounding) — pure
    terrain-effects.ts# terrain/elevation damage modifiers, line of fire, move cost (§10, §2.3) — pure
    actions.ts        # basic Attack/Move/Turn rules (§7, §11.1) — pure
    initiative.ts     # initiativeOrder: speed → category → side alternation (§6.1) — pure
    opportunity.ts    # opportunity attacks: who reacts to a mover + the free strike (§8) — pure
    morale.ts         # cascade morale penalties, ruler aura & fate table (§11.2-11.3) — pure
    rng.ts            # seeded RNG (mulberry32) for replayable dice (§11.3, §15.3) — pure
    board.ts          # observable Hex + Board (terrain, elevation, mud/frozen)
    unit-state.ts     # observable UnitState (rank/count/facing, effective-stat getters, per-turn flags)
    battle-store.ts   # BattleStore: loads via API, hydrates Board + UnitState, drives the initiative turn loop, applies actions, deterministic auto-battler (autoStep)
  ui/       # View layer — React, reads the Model via mobx-react-lite `observer`
    store-context.ts  # DI for the BattleStore
    hex-geometry.ts   # pure pixel helpers for the SVG grid
    App.tsx
    components/       # HexGrid, UnitToken, UnitCard, ActionBar, TurnTracker, DamagePreview, BattleResult, PlaybackControls, CheatSheet
```

## Layer rules

- **API** depends on nothing above it. `request()` is transport-agnostic — the
  mock swaps the adapter with `setAdapter`, so the app runs with zero backend.
- **Model** consumes the API layer and exposes observable state + actions. It
  hydrates DTOs into a `Board` of `Hex` tiles and `UnitState` objects; the View
  never sees a DTO. The combat math (`hex`, `zones`, `stats`) lives here as pure,
  unit-tested functions so the engine stays testable without React (GDD §15).
- **View** reads the Model through `observer` components and triggers actions.

## Run

```bash
yarn workspace @hw/faenwald-battle-prototype dev
```

By default the app uses the mock transport (`installMockAdapter()` in
`src/index.tsx`). Remove that call to hit a real server at `BASE_URL`.
