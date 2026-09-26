# 10 — Fixes after verification `@hw/ostrov-prototype-v4`

Four defects from `09-verification-report.md §5` were fixed: #1 (purge ritual action), #2 (single-quoted
string literals), #4 (truncated resource labels), #5 (retreat button over the end-turn medallion). Nothing
else from the defect list was touched.

---

## Defect 1 — the purge ritual now has an action (medium)

`src/core/techs.ts:67` promised "потратить 5 маны и снять 20 токсичности с одного гекса" and nothing
implemented it. The action is built exactly like the demolish mode of S4: a cursor the tools column arms and
the island canvas spends.

| file | line | change |
| --- | --- | --- |
| `src/store/ui-state.ts` | 33, 56 | `purgeMode: Signal<boolean>`, additive, initialised `false` |
| `src/domain/tech-actions.ts` | 26–35 | `PURGE_TECH`, `PURGE_MANA_COST = 5`, `PURGE_TOXICITY_DELTA = 20` and the five refusal strings |
| `src/domain/tech-actions.ts` | 131 | `canPurge(store)`: refuses and toasts when `purge_ritual` is unresearched, the island is foreign or the phase is not `build` |
| `src/domain/tech-actions.ts` | 153 | `togglePurgeAction(store)`: arms the cursor, clears `demolishMode` and `armedBuilding` |
| `src/domain/tech-actions.ts` | 169 | `purgeHexAction(store, hexId)`: pays `5 💠`, writes `addToxicity(island, hexId, -20)`, logs the line, leaves the cursor armed |
| `src/domain/build-actions.ts` | 82, 94 | `armBuilding` and `toggleDemolish` clear `purgeMode`, so two cursors are never armed at once |
| `src/domain/registry.ts` | 104–109, 142–143 | `TTogglePurgeAction`, `TPurgeHexAction`, both on `TAppRegistry` |
| `src/domain/registry-creator.ts` | 38–40, 80–81 | the two actions bound to the store |
| `src/ui/island-canvas/island-canvas.tsx` | 260 | the click handler calls `purgeHex` when `purgeMode` is on, after the demolish branch and before the `selectHex` fallback |
| `src/ui/island-canvas/island-canvas.tsx` | 203, 343 | `Escape` and the context menu disarm the purge cursor, next to the demolish case S4 wrote |
| `src/ui/island-canvas/draw-island.ts` | 72, 100, 332 | `purgeMode` on `TDrawIslandInput`; a hex with `toxicity > 0` gets the violet `PURGE_TINT_COLOUR` fill and a light violet outline, mirroring the red demolish tint |
| `src/ui/components/purge-icon.tsx` | new file | the 💠 button, class `purge-icon` / `purge-icon--active`; it returns `null` until `purge_ritual` is researched |
| `src/ui/pages/island-page.tsx` | 10, 64 | the button mounted in the tools column, under the technologies flask |
| `src/ui/app.css` | 1270–1306 | `.purge-icon`, `:hover` and `--active`, copied from `.demolish-icon` with the mana violet of `.tech-icon--researching` |
| `src/ui/app.css` | 214 | the tools column is `min-height: 132px` instead of `height: 132px`, so a third slot fits |
| `src/dev/dev-hook.ts` | 110–111, 213–214 | `window.__ostrov.togglePurge()` and `window.__ostrov.purgeHex(hexId)` |

Refusals: an unarmed cursor, a foreign island, a phase other than `build`, a hex whose toxicity is already
`0`, and less than `5 💠` each raise their own toast and change nothing.

Cost and clamp are checked in both runners:

- `scripts/probe.ts:632` `runPurgeChecks` — five browser checks. `scrubbers`, `asylum` and `purge_ritual`
  are paid one at a time through `setResearchTarget` + `addResearch` (`irrigation` is already researched by
  the tech checks above, which is what `asylum` needs). `setResources({ mana: 10 })`, then the first hex with
  `toxicity > 0` is purged and `💠 −5` plus `☣️ max(0, t − 20)` is asserted. With no toxic hex the run prints
  `PASS a purge costs 5 💠 and takes 20 ☣️ off the hex — skipped (no toxic hex)`.
- `scripts/core-smoke.ts:350, 358` — two core checks that `addToxicity(island, id, -20)` subtracts 20 and
  clamps at zero.

## Defect 2 — single-quoted string literals (low)

`scripts/probe.ts:583` and `:597` held `'.tech-card[data-tech="irrigation"]'`. The selector carries a
double-quoted attribute value, so it became one named constant written as a template literal —
`scripts/probe.ts:32 IRRIGATION_CARD_SELECTOR` — used at `:592` and `:606`.

`grep -rn "'" src scripts rspack.config.mjs index.html tsconfig.json` afterwards returns only apostrophes
inside English comments (`the island's`, `React's`); no other single-quoted literal exists in the package.

## Defect 4 — full resource labels (low)

`src/ui/app.css:383` — the grid went from three columns to two, `gap: 6px 8px`. `src/ui/app.css:412` — the
label lost `overflow: hidden` and `text-overflow: ellipsis`.

The panel could not simply grow sideways: it sits at `left: 16px` with `width: 300px` and the tools column
starts at `left: 332px`, and moving the tools column right would push it into the buildings panel, which
starts at x = 440 at 1440 px. Two columns of ~138 px hold the longest label with room to spare; the panel
grows downwards instead, where nothing stands. Three columns are what `01-spec-image-6.png` shows, but that
reference panel is far wider than 300 px.

Measured in the browser at both sizes (`scrollWidth <= clientWidth` per label):

```
1440x900 labels — Еда:full, Камень:full, Дерево:full, Население:full, Молотки:full, Наука:full, Разведка:full, Мана:full, Токсичность:full, Сумасшедшие:full
1280x720 labels — Еда:full, Камень:full, Дерево:full, Население:full, Молотки:full, Наука:full, Разведка:full, Мана:full, Токсичность:full, Сумасшедшие:full
1440x900 resources right 316, tools left 332
1280x720 resources right 316, tools left 332
```

## Defect 5 — the retreat button clears the medallion (low)

`src/ui/app.css:1177` — `.battle-page__retreat` moved from `right: 16px; bottom: 196px` to
`right: 184px; bottom: 16px`, that is left of the end-turn panel (16 px + its 152 px + a 16 px gutter).
`src/ui/pages/battle-page.tsx:59` keeps the same markup.

Measured box test in the browser:

```
1440x900 retreat vs medallion — CLEAR retreat 1104..1256 x 845..884, medallion 1294..1402 x 765..873
1280x720 retreat vs medallion — CLEAR retreat 944..1096 x 665..704, medallion 1134..1242 x 585..693
```

---

## Verification output

```
$ yarn workspace @hw/ostrov-prototype-v4 typecheck
typecheck exit 0

$ yarn workspace @hw/ostrov-prototype-v4 smoke
...
PASS a purge takes 20 toxicity off the hex — 30 → 10
PASS a purge of a barely poisoned hex clamps at zero — 8 − 20 → 0
ALL PASS                                        (28 checks, 0 FAIL, exit 0; was 26)

$ rm -rf dist && yarn workspace @hw/ostrov-prototype-v4 build
build exit 0                                    (3 rspack size warnings, as before)

$ yarn workspace @hw/ostrov-prototype-v4 probe      (run 1)
PASS the purge button stays hidden until the ritual is researched — 0 buttons
PASS the three techs complete and the purge button appears — researched [irrigation, scrubbers, asylum, purge_ritual], buttons 1
PASS clicking the purge button arms the cursor — class "purge-icon purge-icon--active"
PASS a purge costs 5 💠 and takes 20 ☣️ off the hex — 💠 10 → 5, -1:-1 ☣️ 1 → 0, want 0
PASS the purge cursor stays armed, so several hexes are cleaned in a row — class "purge-icon purge-icon--active"
PASS Escape disarms the purge cursor — class "purge-icon"
PASS no console errors — clean
PASS no page errors — clean
PASS 44/44

$ yarn workspace @hw/ostrov-prototype-v4 probe      (run 2)
PASS 44/44
```

`dist/` was left in place after the last build.

## Screenshots

All were opened and looked at, not only written.

| file | what it shows |
| --- | --- |
| `<scratch>/fix/shots/resources-1440x900.png` | the resources panel, ten full labels in two columns |
| `<scratch>/fix/shots/resources-1280x720.png` | the same at 1280×720 |
| `<scratch>/fix/shots/island-1440x900.png` | the whole island page: panel, tools column and buildings panel do not touch |
| `<scratch>/fix/shots/battle-1440x900.png` | «Отступить» left of the medallion, both fully visible |
| `<scratch>/fix/shots/battle-1280x720.png` | the same at 1280×720 |
| `<scratch>/fix/shots/purge-off.png` | the 💠 «Очистить» button in the tools column, cursor disarmed, no tint |
| `<scratch>/fix/shots/purge-on.png` | cursor armed: the button glows violet and the four hexes with `40 ☣️` are tinted violet, the clean hexes are not |
| `<scratch>/fix/probe1/s8-purge-mode.png` | the probe's own purge-mode frame |

`<scratch>` = `/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad`.

The Playwright script that took them served `dist/` on port 8402 with `python3 -m http.server`, checked
`lsof` first, killed the process group afterwards and was deleted.

## Not fixed

Defects 3, 6, 7, 8, 9, 10 and 11 of `09-verification-report.md §5` were out of scope and are untouched. The
empty dark band on the left of the battle page (defect 6) is still visible in `battle-1440x900.png`.

---

# Round 2 fix

## Defect 12 — the buildings panel covered the tools column (low)

At 1280×720 the buildings panel was centred at x≈371..909 while the tools column stands at a fixed
`left: 332px` (x 332..436), so the demolish, technologies and purge buttons sat under it and took no clicks.
At 1440×900 the two boxes were 4 px apart.

`src/ui/app.css:224` — `.island-page__buildings-slot` no longer centres unconditionally:

```css
.island-page__buildings-slot {
  --tools-right: 448px;
  --end-turn-left: 180px;
  --buildings-width: min(560px, 42vw, calc(100vw - var(--tools-right) - var(--end-turn-left)));
  left: max(calc(50% - var(--buildings-width) / 2), var(--tools-right));
  bottom: 16px;
  width: var(--buildings-width);
  min-height: 132px;
}
```

`--tools-right` is where the tools column ends (332 + 104) plus the 12 px gutter; `--end-turn-left` is the
end-turn panel's own 152 px plus its 16 px inset plus the same gutter. The left edge is clamped to the first
and the width is capped by the second, so neither neighbour can ever be reached. `transform: translateX(-50%)`
is gone, because `left` now carries the centring itself. Above ~1400 px the clamp never bites and the panel
is centred exactly as the wireframe draws it; at 1920×1080 it measures 680..1240 around a centre of 960.

No markup changed — `island-page.tsx`, `world-page.tsx` and `battle-page.tsx` are untouched — and the world
and battle pages, which reuse the same panel classes, needed nothing: they carry no tools column and no
buildings panel.

### Measured rects

Every floating box on each page at each viewport, plus a pairwise test that no two intersect and that the
shortest distance between any two is at least 12 px.

| page | viewport | `.players-panel` | `.resources-panel` | `.island-page__tools` | `.island-page__buildings-slot` | `.end-turn-panel` | `.battle-page__retreat` | `.cell-panel` | `.battle-hud` |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| island | 1280×720 | 16..240 x 16..268 | 16..316 x 509..704 | 332..436 x 500..704 | 448..986 x 571..704 | 1112..1264 x 541..704 | — | — | — |
| world | 1280×720 | 16..240 x 16..268 | 16..316 x 509..704 | — | — | 1112..1264 x 541..704 | — | 996..1264 x 72..310 | — |
| battle | 1280×720 | 16..240 x 16..268 | — | — | — | 1112..1264 x 541..704 | 944..1096 x 665..704 | — | 1044..1264 x 16..133 |
| island | 1440×900 | 16..240 x 16..268 | 16..316 x 689..884 | 332..436 x 680..884 | 448..1008 x 751..884 | 1272..1424 x 721..884 | — | — | — |
| world | 1440×900 | 16..240 x 16..268 | 16..316 x 689..884 | — | — | 1272..1424 x 721..884 | — | 1156..1424 x 72..310 | — |
| battle | 1440×900 | 16..240 x 16..268 | — | — | — | 1272..1424 x 721..884 | 1104..1256 x 845..884 | — | 1204..1424 x 16..133 |
| island | 1920×1080 | 16..240 x 16..268 | 16..316 x 869..1064 | 332..436 x 860..1064 | 680..1240 x 931..1064 | 1752..1904 x 901..1064 | — | — | — |
| world | 1920×1080 | 16..240 x 16..268 | 16..316 x 869..1064 | — | — | 1752..1904 x 901..1064 | — | 1636..1904 x 72..310 | — |
| battle | 1920×1080 | 16..240 x 16..268 | — | — | — | 1752..1904 x 901..1064 | 1584..1736 x 1025..1064 | — | 1684..1904 x 16..133 |

```
PASS no overlaps, every gap >= 12 px
```

The tightest pairs are resources → tools (16 px) and tools → buildings (12 px) on the island page, and
retreat → end-turn panel (16 px) on the battle page.

### Verification

```
$ yarn workspace @hw/ostrov-prototype-v4 typecheck
typecheck exit 0

$ rm -rf dist && yarn workspace @hw/ostrov-prototype-v4 build
build exit 0

$ yarn workspace @hw/ostrov-prototype-v4 probe
PASS 44/44
```

Nine screenshots in `<scratch>/fix/shots2/` (`island|world|battle-1280x720|1440x900|1920x1080.png`), all
opened and looked at. The island shots show the three tool buttons fully clear of the buildings panel at
every size. The Playwright script that measured and took them served `dist/` on port 8402, checked `lsof`
first, killed the process group afterwards and was deleted. `dist/` was left in place.
