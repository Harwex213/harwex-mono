# S3 — shell UI

The store slices, the turn loop, the island page layout, the main menu and the four panel components.
`node_modules/.bin/tsc --noEmit -p packages/prototypes/ai-slop/ostrov/ostrov-prototype-v4/tsconfig.json`
exits 0 with no diagnostics, inside and outside `src/core`.

## 1. Files

New:

```
src/store/game-state.ts
src/store/ui-state.ts
src/domain/game-actions.ts
src/ui/components/turn-pill.tsx
src/ui/components/players-panel.tsx
src/ui/components/resources-panel.tsx
src/ui/components/end-turn-panel.tsx
```

Taken over from S1: `src/store/store.ts`, `src/domain/registry.ts`, `src/domain/registry-creator.ts`,
`src/ui/app.tsx`, `src/ui/app.css`, `src/ui/pages/main-menu-page.tsx`, `src/ui/pages/island-page.tsx`.
`src/ui/palette.ts` was left exactly as S1 wrote it: it already carries `PLAYER_COLOURS`.
Nothing under `src/core/`, `src/main.tsx`, `world-page.tsx`, `battle-page.tsx` or any config was touched.

## 2. `TGameState` (`src/store/game-state.ts`)

```ts
type TLogEntry = {
  readonly turn: number;
  readonly phase: TPhase;
  readonly textRu: string;
};

type TGameState = {
  readonly started: Signal<boolean>;
  readonly seed: Signal<number>;
  readonly turn: Signal<number>;
  readonly phase: Signal<TPhase>;
  readonly players: Signal<readonly TPlayer[]>;
  readonly islands: Signal<Readonly<Record<string, TIsland>>>;
  readonly resources: Signal<TResources>;
  readonly worldCells: Signal<readonly TWorldCell[]>;
  readonly islandCellId: Signal<number>;
  readonly researching: Signal<TTechId | null>;
  readonly researched: Signal<readonly TTechId[]>;
  readonly researchProgress: Signal<Readonly<Partial<Record<TTechId, number>>>>;
  readonly log: Signal<readonly TLogEntry[]>;
  readonly pendingEnemies: Signal<number>;
  readonly calmUsesThisTurn: Signal<number>;
  readonly battle: Signal<TBattleState | null>;
  readonly busy: Signal<boolean>;
};
```

Initial values: `started` false, `seed` `NO_SEED` (= `0`, meaning "not chosen"), `turn` `FIRST_TURN` (= `1`),
`phase` `"build"`, `players` `[]`, `islands` `{}`, `resources` `INITIAL_RESOURCES`, `worldCells` `[]`,
`islandCellId` `0`, `researching` `null`, `researched` `[]`, `researchProgress` `{}`, `log` `[]`,
`pendingEnemies` `0`, `calmUsesThisTurn` `0`, `battle` `null`, `busy` `false`.

Also exported from this file: `PHASE_NAMES_RU: Readonly<Record<TPhase, string>>` —
`build` "Строительство", `tax` "Налоги", `exploration` "Разведка", `clearing` "Зачистка". The turn pill,
the log lines and (later) the tech modal all read it, so the four names live in exactly one place.
Full export list: `export type { TGameState, TLogEntry };` and
`export { FIRST_TURN, NO_SEED, PHASE_NAMES_RU, createGameState };`.

## 3. `TUiState` and `TCamera` (`src/store/ui-state.ts`)

```ts
type TScreenPoint = {
  readonly x: number;
  readonly y: number;
};

type TCamera = {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
};

type TUiState = {
  readonly armedBuilding: Signal<TBuildingId | null>;
  readonly demolishMode: Signal<boolean>;
  readonly hoveredHexId: Signal<string | null>;
  readonly hoverScreen: Signal<TScreenPoint | null>;
  readonly selectedHexId: Signal<string | null>;
  readonly techModalOpen: Signal<boolean>;
  readonly eventModal: Signal<TTrailEvent | null>;
  readonly toast: Signal<string | null>;
  readonly camera: Signal<TCamera>;
};
```

`INITIAL_CAMERA` is `{ x: 0, y: 0, scale: 1 }`. Exports:
`export type { TCamera, TScreenPoint, TUiState };` and `export { INITIAL_CAMERA, createUiState };`.
S4 imports `TCamera` and `INITIAL_CAMERA` from here, not from `src/ui/island-canvas/camera.ts`.

## 4. `TStore` (`src/store/store.ts`)

```ts
type TDerivedState = {
  readonly viewedPlayerId: ReadonlySignal<string>;
  readonly isReadonly: ReadonlySignal<boolean>;
  readonly viewedIsland: ReadonlySignal<TIsland | null>;
  readonly toxicityPercent: ReadonlySignal<number>;
  readonly toxicityPoints: ReadonlySignal<number>;
  readonly humanPlayer: ReadonlySignal<TPlayer | null>;
};

type TStore = {
  readonly route: TRouteState;
  readonly game: TGameState;
  readonly ui: TUiState;
  readonly derived: TDerivedState;
};
```

`viewedPlayerId` is `route.viewedPlayerId.value ?? HUMAN_PLAYER_ID`; `isReadonly` is
`viewedPlayerId !== HUMAN_PLAYER_ID`; `viewedIsland` is `game.islands.value[viewedPlayerId] ?? null`;
`toxicityPercent` / `toxicityPoints` call `islandToxicityPercent` / `islandToxicityPoints` on the viewed
island and return `0` when there is none; `humanPlayer` is the `p1` row or `null`.
`HUMAN_PLAYER_ID = "p1"` is exported from this file — every other layer imports it from here.
The file header carries the `S5 adds anim` note.
Exports: `export type { TDerivedState, TStore };` and
`export { HUMAN_PLAYER_ID, StoreProvider, createStore, useStore };`.

Every `computed` is lazy, so `toxicityPercent` and `toxicityPoints` do not call into the still-throwing
core stubs until something renders them.

## 5. `TAppRegistry` (`src/domain/registry.ts`)

```ts
type TNavigateAction = (page: TPage, playerId?: string | null) => void;
type TStartGameAction = (nickname: string) => void;
type TEndTurnAction = () => void;
type TCalmAction = () => void;
type TShowToastAction = (text: string) => void;
type TDismissEventModalAction = () => void;
type TSetSeedAction = (seed: number) => void;

type TAppRegistry = {
  navigate: TNavigateAction;
  startGame: TStartGameAction;
  endTurn: TEndTurnAction;
  calm: TCalmAction;
  showToast: TShowToastAction;
  dismissEventModal: TDismissEventModalAction;
  setSeed: TSetSeedAction;
};
```

`registry-creator.ts` binds all seven through the same `func.bind(null, store)` reduce S1 wrote.
Later subtasks append their action types to this file and their entries to `rawRegistry`.

## 6. Actions (`src/domain/game-actions.ts`)

- `startGameAction(store, nickname)` — keeps `game.seed` when a dev hook already wrote one, otherwise
  `Date.now() % SEED_MODULO` (`100000`). Players: `p1` human (trimmed nickname, `"Игрок"` when empty,
  `PLAYER_COLOURS.green`), then `p2` "Carribean Sorcerer" teal, `p3` "Blue Sorcerer" blue,
  `p4` "Orange Sorcerer" orange, each seeded from one `createRng(seed)`. Four islands through
  `createIsland(seed + index, player.id)` keyed by owner. `resources = INITIAL_RESOURCES`,
  `worldCells = createWorld(seed)`, turn `1`, phase `"build"`, everything else reset, `started = true`,
  one log line, then `navigateAction(store, "island")`.
- `endTurnAction(store)` — returns immediately when `game.busy`. A `switch` with four branches in phase
  order, each carrying its owner comment: `build → tax` (`// S5 replaces: startTaxPhase`, stays on the
  island), `tax → exploration` (`// S6 adds: trail + event roll`, navigates to `world`),
  `exploration → clearing` (`// S7 adds: createBattleLevel`, navigates to `battle`), `clearing → build`
  (turn + 1, `calmUsesThisTurn = 0`, AI counters advance, navigates to `island`). Every branch appends a
  log entry.
- AI counters, per plan §3.4: one `createRng(seed + completedTurn)` per end-turn;
  `army += rng.int(0, 2)`, `buildingCount += rng.int(0, 1)`, `techCount += 1` when the new turn number is
  a multiple of `AI_TECH_EVERY_TURNS` (`4`). The human row is left alone.
- `calmAction(store)` — `3 💠 + 2 🍗` cures `1 🤖 → 1 🧍`, `2 💠` cures `3` with `asylum` researched,
  at most `MAX_CALM_USES_PER_TURN` (`5`) uses per turn. Each refusal (uses spent, no insane, not enough
  mana or food) raises a toast and changes nothing.
- `showToastAction(store, text)` — writes `ui.toast` and clears it after `TOAST_MS` (`2000`). One
  module-level timer handle is cleared before a new toast, so a second toast never cuts the first short.
- `dismissEventModalAction(store)` — `ui.eventModal.value = null`.
- `setSeedAction(store, seed)` — pins the seed before `startGame`, for the dev hook and the probe.

## 7. DOM hooks for S4, S5 and S8

The island page renders, in this order, inside `<div class="island-page">`:

| element | class | who fills it |
| --- | --- | --- |
| canvas slot, `position: absolute; inset: 0` | `island-page__canvas-slot` | S4 |
| placeholder inside the slot | `island-canvas-placeholder` | **S4 replaces this element**, keeps the slot |
| player list, top left | `panel players-panel` | S3 |
| turn pill, top centre | `turn-pill` | S3 |
| resources, bottom left | `panel resources-panel` | S3 |
| tools column, right of the resources panel | `island-page__tools` | S4 demolish icon, S8 tech icon |
| buildings, bottom centre | `island-page__buildings-slot` | S4 |
| end-turn, bottom right | `panel end-turn-panel` | S3 |
| toast | `island-page__toast` | S3 |
| readonly back button | `island-page__back` | S3 |

Both slots are empty `<div>`s and both are rendered only when `derived.isReadonly` is false, together with
the resources panel. `.panel` is the shared look: 1px `--gold-dim` border, `rgba(8, 20, 38, 0.82)`
background, `--radius` corners, `pointer-events: auto`, `z-index: 2`.

Measurement hooks:

- every resource counter is `<div class="resource-chip" data-resource="<TResourceId>">`, ten of them, in
  the order `food stone wood / population hammers science / scouting mana toxicity / insane`
  (`01-spec-image-6.png`). S5 measures `.resource-chip[data-resource="food"]` and so on for the flight
  targets. Inside a chip: `.resource-chip__glyph`, `.resource-chip__value`
  (`--toxic` / `--insane` modifier), `.resource-chip__label`.
- every player row is `<button class="players-panel__row" data-player="<playerId>">`, with
  `players-panel__row--viewed` on the row currently shown.
- the medallion is `button.end-turn-panel__medallion`, its label `div.end-turn-panel__banner`.

Layout, translated from the 1016×580 wireframe to fixed insets so it holds at 1280×720 and 1920×1080:
16px from every viewport edge; players panel 224px wide, resources panel 300px, tools column at
`left: 332px` (just right of the resources panel) 104×132, buildings slot centred at
`width: min(560px, 42vw)`, end-turn panel 152px wide. The turn pill and the buildings slot are centred
with `left: 50%` plus `translateX(-50%)`.

## 8. Deviations

1. **`WORLD_START_CELL_ID` is not in the core contract**, as the brief anticipated. `startGameAction`
   therefore takes the id of the first world cell whose `occupantId === "p1"`, and falls back to `0` when
   the generator names none (`findStartCellId`). If S2 adds the constant later, that helper is the one
   place to change.
2. **`PHASE_NAMES_RU` lives in `src/store/game-state.ts`**, not in a UI file. Both the domain layer (log
   lines) and the UI (turn pill) need the four names, and a UI module must not be imported from
   `src/domain/`. The end-turn button keeps its own `PHASE_BUTTON_LABELS_RU`, because those four strings
   name the *next* phase, not the current one.
3. **`game-actions.ts` imports `PLAYER_COLOURS` from `src/ui/palette.ts`.** `TPlayer.colour` is a plain
   colour string that both the panels and the canvas layers read, and `palette.ts` is a constants module
   with no React in it. The alternative was a second copy of the four hex values.
4. **The resources panel tolerates a missing value.** `INITIAL_RESOURCES` is still `{} as TResources` in
   the S1 stub, so `formatAmount` prints `0` for anything that is not a finite number instead of `NaN`.
   The guard is harmless once S2 fills the table.
5. **The toast is rendered by the island page**, class `island-page__toast`. Nothing in the brief owns it,
   and without it `calmAction`'s refusals would be invisible.
6. **The end-turn panel stays visible on a readonly island.** Spec node-58 lists only the buildings panel,
   the demolish icon, the technologies icon and the resources panel as the things that disappear.
7. **`app.tsx` falls back to the menu for every route while `game.started` is false**, including `#/world`
   and `#/battle`, not only the island. There is no game to render on any of them.
8. **The medallion is pure CSS**: a gold ring, a radial dark centre, an X drawn with two `linear-gradient`
   layers and the four glyphs ⚒ 💀 ⚔ 🌾 placed top, right, left and bottom, matching
   `01-spec-image-2.png`. No image asset was added.
9. **`Space` and `Enter` are bound on `document`** from the end-turn panel's `useEffect`, removed on
   unmount, and skipped when the event target is an `input`, `textarea`, `select` or a contenteditable
   element. The listener does not check `game.busy`: `endTurnAction` already refuses while busy.
10. **`startGameAction` throws until S2 lands**, because `createRng`, `createIsland` and `createWorld` are
    still throwing stubs. That is the expected mid-work state; only the typecheck is green today.
