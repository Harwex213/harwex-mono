# S8 — technologies, dev hook, probe and docs

The last subtask: the technologies modal of plan §3.2/§3.3, `window.__ostrov`, the Playwright probe that
implements every browser check of plan §6, the package `CLAUDE.md` and the rewritten `README.md`.

---

## 1. Files

New:

```
src/domain/tech-actions.ts
src/ui/components/tech-icon.tsx
src/ui/components/tech-modal.tsx
src/dev/dev-hook.ts
scripts/probe.ts
scripts/core-smoke.ts        (rebuilt — see §5)
CLAUDE.md
docs/analysis/08-s8-tech-probe-report.md   (this file)
```

Taken over: `README.md` (rewritten).

Additive edits:

| file | edit |
| --- | --- |
| `src/main.tsx` | one import and `installDevHook(store, registry);` right after `createRegistry` |
| `src/domain/registry.ts` | four action types, four `TAppRegistry` fields, `TTechId` added to the type import |
| `src/domain/registry-creator.ts` | the four imports and the four `rawRegistry` entries |
| `src/ui/pages/island-page.tsx` | `<TechIcon>` in `island-page__tools` under the demolish icon, `<TechModal>`, `<EventModal>` |
| `src/ui/app.css` | one appended block: `.tech-icon*`, `.tech-modal*`, `.tech-card*` |
| `tsconfig.json` | `"./scripts/**/*"` added to `include`; both scripts typecheck clean with the react preset |

Nothing under `src/core/` was touched, and no other implementer's component was changed.

---

## 2. Registry additions

```ts
type TOpenTechModalAction = () => void;
type TCloseTechModalAction = () => void;
type TSetResearchTargetAction = (tech: TTechId | null) => void;
type TAddResearchAction = (science: number) => void;
```

bound as `openTechModal`, `closeTechModal`, `setResearchTarget`, `addResearch` from `openTechModalAction`,
`closeTechModalAction`, `setResearchTargetAction`, `addResearchAction` in `src/domain/tech-actions.ts`.

- `setResearchTargetAction` refuses a researched tech and a locked one, each with its own toast
  (`isTechAvailable` decides). The tech already in research is cancelled when it is passed again, and
  `researchProgress` keeps whatever 📖 it collected. `null` clears the target without a toast.
- `addResearchAction` adds 📖 to the tech in research, completes it at `TECHS[id].cost`, logs
  `Изучено: …` and refreshes the human row's `techCount`. It is the same arithmetic S5 runs inline at the end
  of the tax phase; S5's copy was left untouched, as the brief requires.

### The modal

`tech-icon.tsx` is `button.tech-icon` (🧪) in `island-page__tools`, under `button.demolish-icon`; the column is
not rendered on a foreign island, so the icon needs no readonly branch. It carries `tech-icon--researching`
while a tech is in research.

`tech-modal.tsx` is a fixed full-screen `.tech-modal` with a header (`__title`, `__science` — the 📖 the island
earns per turn, from `computeTaxYields`, `__close`) and a `.tech-modal__grid` of one
`button.tech-card[data-tech="<id>"]` per `TECH_ORDER`: `__name`, `__cost`, `__progress` (`n / cost`),
`__description`, `__requires` (`требует: Ирригация, Скрубберы` — text, not drawn arrows) and `__state`.
State modifiers: `--researched`, `--available`, `--locked`, plus `--active` on the tech in research. A click
calls `setResearchTarget`; `Esc` and the X close the modal.

---

## 3. The dev hook, verbatim

`src/dev/dev-hook.ts`, `installDevHook(store, registry)`, always installed from `main.tsx`.

```ts
type TDevHook = {
  readonly store: TStore;
  readonly registry: TAppRegistry;
  readonly state: () => TDevState;
  /** Either a page name (`"island"`) or a whole hash (`"#/island/p2"`). */
  readonly navigate: (target: string, playerId?: string | null) => void;
  readonly endTurn: () => void;
  readonly fastForward: () => void;
  readonly setResources: (patch: Partial<TResources>) => void;
  readonly placeBuilding: (hexId: string, building: TBuildingId) => void;
  readonly seed: (seed: number) => void;
  readonly killAllEnemies: () => void;
  readonly stepBattle: (ticks: number) => void;
  readonly addResearch: (science: number) => void;
  readonly setResearchTarget: (tech: TTechId | null) => void;
  readonly revealCell: (cellId: number) => void;
  readonly moveIsland: (cellId: number) => void;
  /** The first empty hex of that biome on the human island, or null. */
  readonly firstHexWithBiome: (biome: TBiomeId) => string | null;
};

type TDevState = {
  readonly turn: number;
  readonly phase: string;
  readonly busy: boolean;
  readonly route: { readonly page: TPage; readonly viewedPlayerId: string | null };
  readonly resources: TResources;
  readonly players: readonly unknown[];
  readonly island: { readonly hexes: readonly THex[] };
  readonly camera: TCamera;
  readonly anim: {
    readonly flights: number;
    readonly taxStage: TTaxStage;
    readonly lastLandingMs: number | null;
    readonly insaneAtMs: number | null;
  };
  readonly world: {
    readonly cells: readonly { id: number; revealed: boolean; trail: number; occupantId: string | null }[];
    readonly islandCellId: number;
  };
  readonly battle: null | {
    readonly playerIsland: { readonly x: number; readonly y: number };
    readonly enemyIslands: readonly { id: string; absorbed: boolean; x: number; y: number }[];
    readonly units: readonly { side: "player" | "enemy"; hp: number }[];
    readonly finished: boolean;
    readonly absorbedHexes: number;
  };
  readonly researching: TTechId | null;
  readonly researched: readonly TTechId[];
  readonly researchProgress: Readonly<Partial<Record<TTechId, number>>>;
  readonly log: readonly TLogEntry[];   // the last 20 lines
};
```

`Window` is augmented through `declare global` in the same file. `state()` reads every signal with `.peek()`
and returns plain data, so the probe can hand it straight back over CDP. `stepBattle(ticks)` always passes
`{ up: false, down: false, left: false, right: true }` — without an input the level replays the canvas's
all-false one and nothing is ever absorbed (S7 §8.1).

---

## 4. The probe

`scripts/probe.ts`, run by `yarn workspace @hw/ostrov-prototype-v4 probe`. It never builds: it fails loudly
when `dist/index.html` is missing, and again when `lsof -nP -iTCP:8401 -sTCP:LISTEN` reports a listener.
Then `python3 -m http.server 8401 --directory dist` (detached, killed by process group),
`chromium.launch({ headless: true, args: ["--use-gl=swiftshader", "--enable-unsafe-swiftshader",
"--ignore-gpu-blocklist"] })`, viewport 1440×900, `seed(42)` before `Начать`, and every console error and
page error collected into two final checks. Screenshots go to `$PROBE_SHOT_DIR`.

Two consecutive runs, both `PASS 38/38`, exit 0. The full output of the second run:

```
PASS the dev hook is installed — window.__ostrov
PASS main menu renders a title, a nickname input and Начать — Toxic Island / inputs 1 / Начать
PASS Начать starts turn 1 of the build phase on the island page — turn 1, phase build, page island
PASS island page holds exactly one island canvas — 1
PASS the player list has four rows — 4
PASS the resources panel shows ten counters — 10
PASS the buildings panel has seven cards — 7
PASS demolish, tech and end-turn controls are present — demolish 1, tech 1, end turn 1
PASS a farm goes onto its biome and costs 10 wood — wood 30 → 20, -1:-1 (grassland) = farm
PASS the island screenshot was written — …/scratchpad/s8/s8-island-built.png
PASS a foreign island hides the build controls and the resources panel — cards 0, demolish 0, tech 0, resources 0
PASS a foreign island keeps the canvas and the player list — canvas 1, rows 4
PASS a ctrl+wheel changes the camera scale — 1.032 → 1.540
PASS a deltaX wheel pans and leaves the scale alone — x -24.2 → 66.6, scale 1.540
PASS end turn opens the tax phase with flights in the air — phase tax, flights 2
PASS the tax phase paid the farm's food, minus upkeep — 20 → 18, want 18 (+4 − 6)
PASS the tax phase paid the farm's toxicity — 0 → 1, want +1
PASS wood and stone did not move: the island only farms — wood 20, stone 30
PASS mana income landed — 2 → 3
PASS insane = floor(toxicity points / 10), capped by population — 0, want 0 (points 1)
PASS the insane conversion waits at least 350 ms after the last landing — 350 ms
PASS end turn opens the exploration phase on the world page — phase exploration, page world
PASS the globe canvas holds a WebGL context — ok
PASS the world has 92 cells — 92
PASS the phase start poured the island's toxicity into the cell's trail — 0 → 1, toxicity points 1
PASS the island flies to a neighbouring cell — 0 → 2
PASS revealing a neighbour costs 2 🔭 — 🔭 4 → 2, cell 4 revealed true
PASS end turn opens the clearing phase with its canvas — phase clearing, canvas 1, level built
PASS KeyD steers the island to the right — x 320 → 368
PASS a dead enemy island is absorbed once the player island flies over it — 2 of 4 absorbed, 33 hexes
PASS finishing the level starts turn 2 in the build phase — turn 2, phase build
PASS the technologies modal lists eight techs — 8
PASS irrigation becomes the research target — irrigation, class "tech-card tech-card--available tech-card--active"
PASS 20 📖 completes irrigation — researched [irrigation], class "tech-card tech-card--researched"
PASS Escape closes the technologies modal — 0 modals
PASS irrigation raises the farm's food yield by 1 — 3 → 4
PASS no console errors — clean
PASS no page errors — clean
PASS 38/38
```

Notes on the harder checks:

- **The expected tax numbers are derived in the probe, not read back from the app.** `FARM_YIELDS` re-states
  the farm rows of `src/core/buildings.ts` (grassland 4/1, plains 2/0, tundra 2/0, swamp 5/3, hills 3/1), and
  the food assertion is `before + payout − (population + 2 × insane)` with the conversion rule applied first.
- **The 350 ms gap is measured on the fast-forwarded run** and reads exactly 350 ms, because
  `fastForwardTaxAction` finishes with `nowMs = lastLandingMs + INSANE_DELAY_MS`. A second, animated tax run
  was left out: S5 already measured 359 ms end to end with a `MutationObserver`.
- **Reveal needs a flight first.** `startGame` reveals the start cell *and* all its neighbours, so on turn 1
  there is no dark neighbour to scout. The probe flies one cell, then reveals a dark neighbour of the new cell.
- **Absorption** is driven by `killAllEnemies()` and `stepBattle(300)`; the RAF loop has already stopped by
  then, and the pure sim still steps synchronously.
- **The irrigation effect is checked on the yield itself**, not only on the flag: the probe selects the farm
  hex, reads `.biome-modal__yield` before and after the research, and the food number goes 3 → 4 (the hex is at
  1 toxicity by then, so the base 4 scales to 3 and irrigation adds 1 back).

Screenshots looked at: `…/scratchpad/s8/s8-island-built.png` (turn 1, the farm on its hex, the flask under the
pickaxe in the tools column) and `…/scratchpad/s8/s8-tech-modal.png` (eight cards, irrigation active, the other
seven in their three states). The scratchpad prefix is
`/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad/s8`.

---

## 5. Fixes to other subtasks

1. **`scripts/core-smoke.ts` was missing.** S2 wrote it and a later cleanup of the throwaway self-check scripts
   deleted it with them, so `yarn smoke` died with `ERR_MODULE_NOT_FOUND`. It was rebuilt from the 26-check
   list in `02-s2-core-report.md §3`, in the same order and with the same names, and prints `ALL PASS`. Two
   detail values differ from S2's pasted output because the inputs are mine, not S2's: the island is the
   `4242` one (16 hexes, farm 11 / sawmill 3 / mine 1) and the starvation case reads `1 left and 2 insane`.
   This is the one file of another subtask that S8 wrote, and only because it did not exist.

No other implementer's code needed a fix; every plan §6 check passed against the code as it stood.

---

## 6. Known gaps

- **The tax check exercises one farm.** The probe places a single building, so the multi-building payout, the
  insane multiplier on ⚒️/📖/🔭 and the starvation branch are covered by `smoke`, not by the browser run.
  `state().resources.insane` is 0 on turn 1, so the conversion check is true but not strenuous.
- **No second, animated tax run.** The gap is asserted on the fast-forwarded path only (§4).
- **Riots, trail events and the calm action are never reached** in 2 turns of probe play.
- **The tech modal has no prerequisite arrows**, only the `требует:` line the brief allows, and no keyboard
  navigation between cards.
- **`state().players` is typed `readonly unknown[]`** so the dev hook does not re-export `TPlayer`; the probe
  never reads a field off it.
- The three rspack asset-size warnings are pre-existing: the bundle is 801 KB, mostly three.js.

---

## 7. Verification

Commands, cwd `javascript/`:

| command | result |
| --- | --- |
| `yarn workspace @hw/ostrov-prototype-v4 typecheck` | exit 0, no diagnostics, `src/` and `scripts/` both in the program |
| `yarn workspace @hw/ostrov-prototype-v4 smoke` | 26 checks, `ALL PASS`, exit 0 |
| `yarn workspace @hw/ostrov-prototype-v4 build` | exit 0, three pre-existing size warnings |
| `yarn workspace @hw/ostrov-prototype-v4 probe` ×2 | `PASS 38/38`, exit 0, both runs |

`dist/` is **1.2 MB** (10 files: `index.html`, one JS of 801 KB, one CSS, seven webp) and was left in place.
Port 8401 is free; `lsof` reports no listener after the run.
