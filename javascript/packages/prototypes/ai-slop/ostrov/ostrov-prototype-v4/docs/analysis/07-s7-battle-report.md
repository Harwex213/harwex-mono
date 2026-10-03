# S7 — clearing phase (phase 4)

Owner: S7. Scope: the battle page, the battle canvas and the battle actions of plan §3.8.

---

## 1. Files

New:

| file | what it holds |
| --- | --- |
| `src/domain/battle-actions.ts` | the six actions below, one private `appendLogEntry`, the module-level `currentInput` and `startingPlayerUnits` |
| `src/ui/battle-canvas/draw-battle.ts` | `drawBattle`, `battleCameraOffset`, every colour and size constant of the level |
| `src/ui/battle-canvas/battle-canvas.tsx` | `BattleCanvas` (canvas + frame loop + keyboard), `BattleHud`, `BattleBanner` |

Taken over:

| file | what changed |
| --- | --- |
| `src/ui/pages/battle-page.tsx` | the stub became the real page: canvas slot, `TurnPill`, `PlayersPanel`, `BattleHud`, `EndTurnPanel`, the retreat button, `BattleBanner`, the toast |

Additive edits:

| file | what was added |
| --- | --- |
| `src/domain/registry.ts` | six action types and six `TAppRegistry` entries |
| `src/domain/registry-creator.ts` | the six imports and the six raw-registry entries |
| `src/domain/game-actions.ts` | one import line; one call in each of the two branches named in §3 |
| `src/store/ui-state.ts` | `battleRetreated: Signal<boolean>`, initialised `false` |
| `src/ui/app.css` | one commented block at the end: `.battle-page`, `.battle-page__canvas-slot`, `.battle-canvas`, `.battle-hud`, `.battle-hud__row`, `.battle-hud__hint`, `.battle-page__retreat`, `.battle-banner`, `.battle-page__toast` |

Nothing under `src/core` was touched, and no S4/S5/S6 component file was touched.

---

## 2. Registry additions

| name | type | signature | behaviour |
| --- | --- | --- | --- |
| `startBattle` | `TStartBattleAction` | `() => void` | `battle = createBattleLevel(seed + turn * 101, ownIsland, turn, pendingEnemies, researched)`, `pendingEnemies = 0`, `busy = true`, `battleRetreated = false`, log `Зачистка началась: N вражеских островов` |
| `battleTick` | `TBattleTickAction` | `(dtMs: number, input: TBattleInput) => void` | clamps `dtMs` to `[0, 100]`, `battle = stepBattle(battle, dtMs, input)`, remembers `input`; on the tick that flips `finished` it sets `busy = false`, toasts `Уровень зачищен` and logs the same line |
| `stepBattleTicks` | `TStepBattleTicksAction` | `(ticks: number, input?: TBattleInput) => void` | runs `stepBattle` `ticks` times at `BATTLE_TICK_MS`; the same finish bookkeeping applies |
| `killAllEnemies` | `TKillAllEnemiesAction` | `() => void` | every enemy unit's `hp` becomes 0; they leave the level on the next tick, because `stepBattle` drops dead units |
| `retreat` | `TRetreatAction` | `() => void` | `battle.finished = true`, `busy = false`, `battleRetreated = true`, log `Отступление с уровня`; a no-op when the level is already finished |
| `finishBattle` | `TFinishBattleAction` | `() => void` | `addHexesToIsland(ownIsland, absorbedHexes)` with each hex re-stamped `building: null, toxicity: 0`; `players[p1].army = surviving player units`; log `Присоединено N гексов, потеряно M юнитов`; `battle = null`, `busy = false`, `battleRetreated = false` |

`stepBattleTicks` takes an **optional third argument** that the plan did not ask for. Without it the level
replays the last input `battleTick` received, which is all-false in a probe that never held a key, and the
player island then never moves, so no island can ever be absorbed. Passing `{ right: true, … }` lets S8 drive
the absorption check with no frame loop. The two-argument call the plan specifies still works unchanged.

`MAX_TICK_MS` (100) is also exported from `battle-actions.ts`, for the dev hook to reuse.

---

## 3. The `endTurnAction` branches after the edit

```ts
    case "exploration": {
      store.game.phase.value = "clearing";
      appendLogEntry(store, turn, "clearing", `Ход ${turn}: ${PHASE_NAMES_RU.clearing}`);
      navigateAction(store, "battle");
      // The level is built after the route already points at the battle page, so
      // the canvas mounts on a level that exists. `startBattle` holds `busy`.
      startBattleAction(store);
      break;
    }

    case "clearing": {
      const nextTurn = turn + 1;

      // The absorbed hexes and the surviving army land while the phase is still
      // `clearing`, because the log line reads the phase back.
      finishBattleAction(store);
      store.game.turn.value = nextTurn;
      store.game.phase.value = "build";
      store.game.calmUsesThisTurn.value = 0;
      advanceAiCounters(store, turn, nextTurn);
      appendLogEntry(store, nextTurn, "build", `Ход ${nextTurn}: ${PHASE_NAMES_RU.build}`);
      navigateAction(store, "island");
      break;
    }
```

The import added at the top of the file is `import { finishBattleAction, startBattleAction } from "./battle-actions";`.
`battle-actions.ts` imports `showToastAction` back from `game-actions.ts`; the cycle is the same one
`tax-actions.ts` already has, and it is safe because every reference sits inside a function body.

---

## 4. DOM hooks

| hook | where | what it is |
| --- | --- | --- |
| `canvas.battle-canvas` | inside `div.battle-page__canvas-slot` | the level. DPR-aware through a `ResizeObserver`, `aria-label="Зачистка"` |
| `div.battle-hud` | top right, `z-index: 2`, `pointer-events: none` | the readout. Carries **`data-player-x`** = `Math.round(battle.playerIsland.x)`. Rows: `Свои юниты: N`, `Враги: N`, `Вражеских островов: N`, hint `WASD — управление, Отступить — выйти` |
| `div.battle-hud__row`, `div.battle-hud__hint` | inside the HUD | the individual lines |
| `div.battle-banner` | centred horizontally, `top: 26%` | shown only while `battle.finished`. Text `Уровень зачищен — нажмите Следующий ход`, or `Отступление — нажмите Следующий ход` when `ui.battleRetreated` |
| `button.battle-page__retreat` | right `16px`, bottom `196px`, above the end-turn panel | label `Отступить`, calls `registry.retreat()` |
| `div.battle-page__toast` | bottom centre | the shared toast, same look as the other pages |

The HUD returns `null` while `game.battle` is `null`, so a probe should wait for `.battle-hud` rather than
assume it. `BattleHud` and `BattleBanner` are the only components that read the battle signal, so the
per-frame write re-renders those two and nothing else.

---

## 5. Camera, input and teardown

- **Camera.** Scale 1, the player island centred, the camera **centre** clamped into the world rect
  `[0, 1600] x [0, 1200]`. The obvious clamp — keeping the viewport inside the world — was tried first and
  rejected: the world is 1600x1200 and a normal window is 1440 wide, so that clamp pins the camera to the
  world edge and the island never leaves the left of the screen. Clamping the centre keeps the whole level
  reachable, centres the island everywhere it can stand, and the drawn world border still shows the edge.
- **Input.** `keydown` / `keyup` on `window` for `KeyW/KeyA/KeyS/KeyD` and the four arrows, ignored while the
  focus is in an `input`, `textarea`, `select` or a `contenteditable`. `window.blur` releases every key,
  because a lost focus never delivers the matching `keyup`.
- **Frame loop.** One `requestAnimationFrame` chain. It calls `battleTick` with the real frame time while the
  level runs, paints every frame, and **stops** on the first frame after `finished`, leaving the final frame
  on screen.
- **Teardown.** The cleanup cancels the RAF handle, disconnects the `ResizeObserver` and removes the three
  window listeners (plan §7).

---

## 6. Drawing (`draw-battle.ts`)

Background is a vertical `bg → bg-deep` gradient; a 100 px grid and a 2 px border mark the world. Each island
paints its hexes at `BATTLE_HEX_SIZE_PX` (24) through `islandHexCentres` + `hexCorners`, filled with the
two-stop `BIOMES[...].colours` gradient and edged in the same dark line `draw-island.ts` uses. The footprint
then gets a rim: red `#ff6b5e` for an enemy island, green `#5ec26a` with a slow 1.8 s breath for the player
island, both with a 14 px glow. An absorbed island drops to alpha `0.28`. Units are discs — 5 px ground, 4 px
air with a light ring — green for the player, red for the enemy, with a 14x2.5 px hp bar 10 px above. The
optional attack line was skipped: `stepBattle` does not expose the chosen target, and inferring it in the
renderer would duplicate the sim's targeting rule.

---

## 7. Self-check

Commands, cwd `javascript/`:

| command | result |
| --- | --- |
| `yarn workspace @hw/ostrov-prototype-v4 typecheck` | exit 0, no diagnostics |
| `yarn workspace @hw/ostrov-prototype-v4 build` | exit 0 (three rspack size warnings, pre-existing) |

Headless Playwright 1.61.1 / chromium-1228, `dist/` served by `python3 -m http.server 8402` (the port was
checked free with `lsof` first and the server killed by process group afterwards). The script lived in
`scripts/s7-selfcheck.ts` and was deleted, together with `dist/`, after the run.

Flow: `Начать` → arm the village card and hunt a legal hex by clicking a grid over the free middle band of
the canvas → end turn (tax, waited for the medallion to re-enable) → end turn (exploration, event modal
dismissed if present) → end turn (clearing) → assertions → `Отступить` → `Следующий ход`.

```
PASS village placed — wood dropped after a hex click
PASS tax phase ended — end turn re-enabled
PASS exploration route — http://127.0.0.1:8402/index.html#/world
PASS battle route — http://127.0.0.1:8402/index.html#/battle
PASS battle canvas — canvas.battle-canvas count 1
PASS hud text — Свои юниты: 1 | Враги: 9 | Вражеских островов: 3 | WASD — управление, Отступить — выйти
PASS end turn disabled while the level runs — disabled
PASS KeyD moves the island right — x 320 -> 381
PASS end turn enabled after retreat — enabled
PASS end turn label — Следующий ход
PASS battle banner — Отступление — нажмите Следующий ход
PASS turn pill — Ход 2 · Строительство
PASS island route — http://127.0.0.1:8402/index.html#/island
PASS no page errors — clean
PASS 14/14
```

Screenshots (scratchpad, 1440x900):

- `…/scratchpad/shots/s7-battle-start.png` — the level on arrival. The player island is centred and
  green-rimmed, two red-rimmed enemy islands with their units are on screen, the world's left border runs
  down the screen at x≈400, the HUD sits top right and the medallion is disabled.
- `…/scratchpad/shots/s7-battle-mid.png` — after 500 ms of `KeyD` plus 1.5 s of fighting. The camera has
  followed: the border has slid left, and three islands with their hp-barred units are visible.
- `…/scratchpad/shots/s7-battle-retreat.png` — the banner over the level, the medallion gold and clickable.
- `…/scratchpad/shots/s7-turn2-island.png` — turn 2, the island page.

The full path prefix is
`/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad/shots/`.

Absorption cannot be reached through the interface in a few seconds, so it was checked separately in Node
(`tsx`, a temporary script, deleted): `setSeed(4242)` → `startGame` → a village forced onto the first hex →
`startBattle` → `killAllEnemies` → `stepBattleTicks(300, { right: true })` → `finishBattle`.

```
islands 3 units 10 busy true
absorbedIslands 2 absorbedHexes 30 finished true busy false
island hexes 16 -> 25 army 1 battle null
log [ 'Уровень зачищен', 'Присоединено 9 гексов, потеряно 0 юнитов' ]
```

Two islands absorbed, the 25-hex cap respected, the army counter set to the survivor, the level cleared.

---

## 8. Deviations and notes for S8

1. **`stepBattleTicks` takes an optional `input`.** See §2. The absorption check in plan §6 needs it, or it
   needs a prior `battleTick(0, { right: true, … })` to prime the remembered input.
2. **Camera clamp.** The camera centre is clamped into the world rect, not the viewport into the world. See §5.
3. **`ui.battleRetreated`** is a new signal in `ui-state.ts`. It only chooses the banner wording.
4. **`battleInput` was not added to the store.** The pressed keys live in a mutable object inside the canvas
   effect, and `battle-actions.ts` remembers the last one it was handed. Nothing outside the level needs it.
5. **The RAF loop stops at `finished`.** An island whose defenders are all dead can therefore only be absorbed
   while some other island still has live enemies, which is what keeps the level running. That matches plan
   §3.8: the level ends when every enemy is dead or absorbed.
6. **`finishBattle` is idempotent.** It returns immediately when `game.battle` is `null`, so a second
   `Следующий ход` cannot double-apply a result.
7. **`startingPlayerUnits`** is module state, not store state. A hard reload during the clearing phase rebuilds
   the level through the page's mount effect and resets it, so the "потеряно M" line stays honest.
8. **`dist/` was deleted** and port 8402 is free.
