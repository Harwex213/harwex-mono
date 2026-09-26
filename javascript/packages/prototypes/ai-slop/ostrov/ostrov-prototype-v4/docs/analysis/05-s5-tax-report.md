# S5 — tax phase report

Plan §3.1, §4.5; spec nodes `node-74`, `50-100`, `bezier-curve-hud-350-ms`, `node-80`.

## 1. Files

New:

| file | what it holds |
| --- | --- |
| `src/store/anim-state.ts` | `TAnimState`, `TFlight`, `TTaxStage`, the four timing constants, `RESOURCE_GLYPHS` |
| `src/ui/tax-flight/bezier.ts` | `quadPoint`, `easeInOutCubic` |
| `src/ui/tax-flight/tax-flight-layer.tsx` | the fixed full-viewport canvas and the RAF loop |
| `src/domain/tax-actions.ts` | the five actions |

Edited, additively only:

| file | edit |
| --- | --- |
| `src/store/store.ts` | `anim: TAnimState` on `TStore`, `createAnimState()` in `createStore` |
| `src/domain/registry.ts` | five action types plus five `TAppRegistry` fields |
| `src/domain/registry-creator.ts` | the five entries in `rawRegistry` |
| `src/domain/game-actions.ts` | the `build` branch of `endTurnAction` now calls `startTaxPhaseAction` and does not navigate |
| `src/ui/pages/island-page.tsx` | `<TaxFlightLayer>` mount, `onClick` on the canvas slot calling `registry.skipFlights()` |
| `src/ui/components/resources-panel.tsx` | `pulseClassName(row.id, store.anim.pulse.value)` on each chip |
| `src/ui/app.css` | one appended block at the end: `.tax-flight-layer`, the two chip modifiers, two keyframes |

Nothing under `src/core/` was touched. No S6 file was touched.

## 2. `TAnimState`, verbatim

```ts
/** Both `from`, `control` and `to` are viewport pixels, so the layer can be fixed-position. */
type TFlight = {
  readonly id: string;
  readonly hexId: string;
  readonly resource: TResourceId;
  readonly amount: number;
  readonly from: TScreenPoint;
  readonly control: TScreenPoint;
  readonly to: TScreenPoint;
  /** `performance.now()` of the moment this glyph leaves its hex. */
  readonly startMs: number;
  readonly landed: boolean;
};

/**
 * `idle` before the phase, `flying` while glyphs travel, `pause` during the
 * 350 ms wait, `insane` while the conversion runs, `done` once the phase ended.
 */
type TTaxStage = "idle" | "flying" | "pause" | "insane" | "done";

type TAnimState = {
  readonly flights: Signal<readonly TFlight[]>;
  /** The centre of every `.resource-chip`, measured once when the phase starts. */
  readonly hudAnchors: Signal<Readonly<Partial<Record<TResourceId, TScreenPoint>>>>;
  readonly taxStage: Signal<TTaxStage>;
  /** The chip that should flash right now, or null. */
  readonly pulse: Signal<TResourceId | null>;
  readonly lastLandingMs: Signal<number | null>;
  readonly insaneAtMs: Signal<number | null>;
};
```

`TScreenPoint` is the existing `{ x: number; y: number }` from `src/store/ui-state.ts`, so no second
point type was introduced.

Constants exported beside it: `FLIGHT_MS = 700`, `FLIGHT_STAGGER_MS = 60`, `INSANE_DELAY_MS = 350`,
`PULSE_MS = 300`, `ALARM_PULSE_MS = 900`, `NO_FLIGHTS`, `RESOURCE_GLYPHS`.

`pendingYields` is a module-level `let` inside `tax-actions.ts`, not a signal, so `TAnimState` stays
exactly as specified.

## 3. Registry additions

```ts
type TStartTaxPhaseAction = () => void;
type TTickTaxAction = (nowMs: number) => void;
type TFinishTaxAction = (nowMs: number) => void;
type TSkipFlightsAction = () => void;
type TFastForwardTaxAction = () => void;
```

| registry field | bound action | called by |
| --- | --- | --- |
| `startTaxPhase` | `startTaxPhaseAction(store)` | `endTurnAction`, build branch |
| `tickTax` | `tickTaxAction(store, nowMs)` | the layer's RAF loop, once per frame |
| `finishTax` | `finishTaxAction(store, nowMs)` | `tickTax` and `fastForwardTax` |
| `skipFlights` | `skipFlightsAction(store)` | the island page's canvas-slot click |
| `fastForwardTax` | `fastForwardTaxAction(store)` | **S8's dev hook wires `fastForward()` here**, and an internal watchdog |

`fastForwardTax` is a no-op in the `idle`, `done` and `insane` stages, so the dev hook may call it at
any moment. From `flying` it lands everything, then runs `finishTax` with
`nowMs = lastLandingMs + INSANE_DELAY_MS`, so `insaneAtMs - lastLandingMs` is exactly 350 even when
fast-forwarded.

## 4. Order of operations

`startTaxPhaseAction`

1. `phase = "tax"`, `busy = true`, `taxStage = "flying"`, clear `pulse`, `lastLandingMs`, `insaneAtMs`.
2. Log `Ход N: Налоги`. (`endTurnAction` no longer writes this line and no longer navigates.)
3. `pendingYields = computeTaxYields(island, researched, resources.insane)` for the `p1` island.
4. `hudAnchors` = the centre of every `.resource-chip[data-resource]` rect.
5. One flight per yield entry for `entry.resource`, plus one to the `toxicity` chip when
   `entry.toxicity > 0`. `from` = `hexToPixel(q, r, HEX_SIZE_PX)` → `worldToScreen(world, camera, slotViewport)`
   → plus the canvas slot's `left`/`top`. `control` = midpoint lifted 160 px, offset `+60`/`-60`
   alternating by flight index. `startMs = performance.now() + index * 60`.
6. No flights → `lastLandingMs = now`, `taxStage = "pause"` straight away.
7. Arm a watchdog `setTimeout` at `flights * 60 + 700 + 350 + 1000` ms that calls `fastForwardTax`, so
   `busy` is released even if the layer is unmounted mid-flight.

`tickTaxAction(store, nowMs)` — `flying`: every flight with `nowMs >= startMs + 700` lands; a landing adds
its amount to its resource, poisons its hex when the glyph is toxicity, and pulses the chip. All landed →
`lastLandingMs = nowMs`, `taxStage = "pause"`. `pause`: `nowMs - lastLandingMs >= 350` → `finishTax`.

`finishTaxAction(store, nowMs)` — refuses unless the stage is `flying` or `pause`, then in this order:

1. `taxStage = "insane"`, cancel the watchdog.
2. `science` = the 📖 of `pendingYields`; `toxicityPoints = islandToxicityPoints(island)`.
3. `mana += manaIncome(science)`.
4. `applyInsaneConversion(resources, toxicityPoints)`, written to the store.
5. `insaneAtMs = nowMs`.
6. `applyUpkeep(resources)`, written to the store.
7. `advanceResearch`: `researchProgress[researching] += science`; at `TECHS[id].cost` push to
   `researched`, clear `researching`, log `Изучено: …`.
8. `rollRiot(createRng(seed + turn * 31), resources)`: on a hit, `setBuilding(hexId, null)` on a
   `rng.pick(builtHexIds(island))`, `addToxicity(+5)` on that hex, `pendingEnemies += 1`, log, toast.
9. `players[p1].buildingCount = builtHexIds(island).length`, `techCount = researched.length`.
10. Log the summary `Налоги: +4 🍗, +1 ☣️, …`.
11. `taxStage = "done"`, `busy = false`, red alarm pulse on the 🤖 chip.

`skipFlightsAction` — only in `flying`: lands every glyph now, `lastLandingMs = performance.now()`,
`taxStage = "pause"`. The 350 ms pause still runs.

## 5. DOM hooks

| hook | who owns it | used for |
| --- | --- | --- |
| `.resource-chip[data-resource]` | S3 | measured into `hudAnchors`; the flight targets |
| `.island-page__canvas-slot` | S4 | its rect turns canvas-local screen points into viewport ones; its `onClick` is skip-to-land |
| `canvas.tax-flight-layer` | S5 | fixed, `inset: 0`, `z-index: 4`, `pointer-events: none`, DPR-aware |
| `.resource-chip--pulse` | S5 | 300 ms gold scale pulse on the chip named by `anim.pulse` |
| `.resource-chip--alarm` | S5 | 900 ms red pulse, used only for the insane chip |

The layer draws a ~22 px emoji per in-flight glyph at `quadPoint(from, control, to, easeInOutCubic(t))`,
with three fading dots behind it at `t - 0.06 * n`. Its RAF loop starts only while the stage is `flying`
or `pause`, and the cleanup cancels the handle and clears the canvas.

## 6. Self-check

`yarn workspace @hw/ostrov-prototype-v4 typecheck` — exit 0, no diagnostics, before and after the build.
`yarn workspace @hw/ostrov-prototype-v4 build` — exit 0 (three rspack bundle-size warnings only), run
after `s6-browser-done` appeared.

Headless Playwright 1.61.1, chromium-1228, `dist` served by `python3 -m http.server 8402`. The script
lived in the scratchpad, ran from `<pkg>/scripts/s5-check.ts` and was deleted with `dist/` afterwards.
Flow: `Начать` → arm ферма, scan the board until wood drops by 10 → arm лесопилка, scan until stone
drops by 5 → read each placed hex's yield off `.hex-popup__combo` → read the ten chips → click the
medallion → screenshot → watch the chips with a `MutationObserver` → wait for the medallion to enable.

```
PASS first building placed — points=[[370,554]]
PASS second building placed — points=[[370,554],[860,120]]
PASS ten resource chips — {"food":20,"stone":25,"wood":15,"population":6,"hammers":3,"science":0,"scouting":4,"mana":2,"toxicity":0,"insane":0}
PASS expected yield parsed — {"food":4,"toxicity":3,"wood":5}
PASS flight layer mounted — {"present":true,"busy":true}
PASS end turn is busy during the flights — {"present":true,"busy":true}
PASS flights landed one by one — ["food 20→24 @8528","toxicity 0→1 @8588","wood 15→20 @8645","toxicity 1→3 @8704","food 24→18 @9062","mana 2→3 @9062"]
PASS food landed its yield — landed +4, want +4
PASS wood landed its yield — landed +5, want +5
PASS toxicity landed its yield — landed +3, want +3
PASS final food = yield minus upkeep — food 20 → 18, upkeep 6
PASS toxicity counter kept its yield — 0 → 3
PASS mana income paid — 2 → 3
PASS end-turn label is В разведку — В разведку
PASS the insane step waits at least 350 ms — gap 359 ms (marker mana @9062, last landing @8704, insane change none — island toxicity too low on turn 1)
ALL PASS 15/15
```

No console errors and no page errors: the run fails on either, and it did not.

The four landings sit at 8528 / 8588 / 8645 / 8704 ms — the 60 ms stagger, measured end to end.

Screenshots:

- `…/scratchpad/s5-1-liftoff.png` — the frame right after the click.
- `…/scratchpad/s5-2-midflight.png` — four glyphs (🍗, ☣️, ☣️, 🪵) in the air with their dot trails,
  arcing from the two built hexes down to the resources panel. The medallion is disabled.
- `…/scratchpad/s5-3-settled.png` — 🍗 18, 🪵 20, 💠 3, ☣️ 3, the 🤖 chip caught mid red alarm pulse, the
  flight canvas cleared, the banner reading `В разведку`, and the two built hexes now printing their new
  hex toxicity (1 and 2).

### Measured gap

**359 ms** between the last chip mutation of the flights and the mutation that `finishTax` writes.
A first attempt with a 20 ms poller read 340 ms; that was the poller's granularity, not the pause. The
`MutationObserver` timestamps the DOM change itself and reads 359 ms, consistent with the RAF loop
firing on the first frame at or after `lastLandingMs + 350`.

## 7. Deviations and notes

1. **The insane branch was not exercised.** `applyInsaneConversion` reads `islandToxicityPoints(island)`,
   the sum of **hex** toxicity, and an island starts with every hex at 0. Two buildings on turn 1 add 3
   points, so `floor(3 / 10) === 0` and the 🤖 counter does not move. The 350 ms pause was therefore
   measured against the mana income, which `finishTax` writes in the same synchronous block as the
   conversion. The branch needs roughly turn 4 of normal play, or a riot / garbage worm.
2. **A landing toxicity glyph also poisons its hex** (`addToxicity(island, hexId, amount)`), on top of
   adding to the ☣️ counter as instructed. Without it no hex toxicity would ever grow from ordinary play,
   which would leave both the `50-100` spec node (output falls, a farm dies at 50, a hex dies at 100) and
   the insane conversion permanently inert. It changes no documented acceptance number: the ten counters
   still receive exactly `computeTaxYields`, and `insane === floor(toxicityPoints / 10)` still holds
   against whatever `toxicityPoints` the same snapshot reports. **Flag for review** if the intent was for
   hex toxicity to come from disasters only.
3. **A watchdog timer** force-ends the phase 1 s after its natural duration. The RAF loop is the clock of
   the phase, so a player who leaves the island page mid-flight would otherwise leave `busy` stuck true
   forever.
4. `finishTax` also refreshes the human row's `techCount` alongside `buildingCount`, since tax is where
   research completes.
5. `pulse` is cleared by a `setTimeout` guarded with a token, so a newer pulse always wins and the class
   never sticks. A second pulse on the same chip does not restart the CSS animation — it holds the class
   longer instead, which reads as a continuous flash while many glyphs of one resource land.
6. `tax-actions.ts` imports `worldToScreen` from `src/ui/island-canvas/camera.ts`, and
   `game-actions.ts` ↔ `tax-actions.ts` is an import cycle (`showToastAction` one way,
   `startTaxPhaseAction` the other). Neither module calls across the cycle at evaluation time, so it
   resolves cleanly; the same pattern already exists between `game-actions` and `world-actions`.
