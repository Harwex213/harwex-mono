# S4 — island canvas and build phase

The hero canvas of the island page, the build-phase interactions of plan §3.2, and the seven pieces of
building art. `yarn workspace @hw/ostrov-prototype-v4 typecheck` and `build` both exit 0, and a headless
Playwright pass over the built `dist/` reports `ALL PASS 16/16` with no console or page errors.

## 1. Files

New:

```
src/assets/buildings/{farm,sawmill,mine,village,masons-guild,observatory,university}.webp
src/ui/island-canvas/camera.ts
src/ui/island-canvas/draw-island.ts
src/ui/island-canvas/hit-test.ts
src/ui/island-canvas/island-canvas.tsx
src/ui/components/buildings-panel.tsx
src/ui/components/demolish-icon.tsx
src/ui/components/hex-popup.tsx
src/ui/components/biome-modal.tsx
src/domain/build-actions.ts
```

Taken over and extended: `src/ui/pages/island-page.tsx` (the placeholder is gone, the slots are filled),
`src/domain/registry.ts`, `src/domain/registry-creator.ts`, `src/ui/app.css`, `src/store/store.ts`
(additive only). `src/store/ui-state.ts` needed no change: S3's `TCamera`, `TScreenPoint` and
`INITIAL_CAMERA` were already the right shape.

Nothing under `src/core/`, `src/main.tsx`, `game-state.ts`, `game-actions.ts`, the S3 components,
`world-page.tsx`, `battle-page.tsx` or any config was touched.

## 2. Registry additions (`src/domain/registry.ts`)

```ts
type TArmBuildingAction = (building: TBuildingId | null) => void;
type TToggleDemolishAction = () => void;
type TSelectHexAction = (hexId: string | null) => void;
type THoverHexAction = (hexId: string | null, screen: TScreenPoint | null) => void;
type TSetCameraAction = (camera: TCamera) => void;
type TPlaceBuildingAction = (hexId: string, building: TBuildingId) => void;
type TDemolishAction = (hexId: string) => void;
```

Added to `TAppRegistry` as `armBuilding`, `toggleDemolish`, `selectHex`, `hoverHex`, `setCamera`,
`placeBuilding`, `demolish`, and bound in `registry-creator.ts` through the same reduce S1 wrote.

Behaviour (`src/domain/build-actions.ts`):

- `armBuildingAction` toggles: passing the armed building disarms it. Arming also clears `demolishMode`.
  Arming is refused on a foreign island and outside the build phase, with a toast; disarming (`null`) is
  always allowed, so `Esc` and right-click work everywhere.
- `toggleDemolishAction` clears `armedBuilding`; the same two guards apply when switching the mode on.
- `placeBuildingAction` checks `legalHexesFor` then `canAfford`, deducts 🪨🪵⚒️, calls `setBuilding`,
  disarms the card and logs. Each refusal raises its own toast and changes nothing. An unaffordable card
  still arms, so the legal hexes are previewed; only the placement is refused (plan §3.2).
- `demolishAction` on a hex with a building: `setBuilding(…, null)` and a refund of
  `floor(cost.stone / 2)` and `floor(cost.wood / 2)`, no ⚒️ back. On an empty hex: `removeHex`, costing
  `2 ⚒️`, or `1 ⚒️` when the hex is at `DEAD_HEX_TOXICITY`, refused below `MIN_ISLAND_HEX_COUNT` and
  refused when the hammers are missing. Both paths log; both are build-phase-only and own-island-only.
- `hoverHexAction`, `selectHexAction` and `setCameraAction` are plain writers.

Exported constants: `REFUND_RATIO = 0.5`, `HEX_DEMOLITION_HAMMERS = 2`,
`DEAD_HEX_DEMOLITION_HAMMERS = 1`.

## 3. Derived additions (`src/store/store.ts`)

```ts
readonly legalHexIds: ReadonlySignal<readonly string[]>;
readonly affordable: ReadonlySignal<Readonly<Record<TBuildingId, boolean>>>;
```

`legalHexIds` is `legalHexesFor(viewedIsland, armedBuilding)`, and one shared frozen empty array while
nothing is armed, so the identity is stable. `affordable` runs `canAfford` over `BUILDING_ORDER`.
`createDerivedState` now takes the `ui` slice as its third argument; nothing else in the file moved.

## 4. Camera

`src/ui/island-canvas/camera.ts` exports `worldToScreen`, `screenToWorld`, `zoomAt`, `clampCamera`,
`fitIsland`, `islandBounds`, `MIN_SCALE = 0.4`, `MAX_SCALE = 3` and the types `TViewport`,
`TWorldBounds`, `TWorldPoint`. `camera.x` / `camera.y` are the world point at the centre of the canvas
and `camera.scale` is screen pixels per world pixel — the same meaning S3's comment gave them.

**The camera lives in `store.ui.camera`** and is written only through `registry.setCamera`. S8's dev hook
reads `ui.camera` for `state().camera`; the probe's wheel assertions (`scale` after a ctrl+wheel, `x`
after a `deltaX` wheel) read the same signal.

`zoomAt` keeps the world point under the cursor fixed, then clamps. `clampCamera` holds the scale in
`[0.4, 3]` and keeps the camera centre inside the island bounds grown by half a screen, so the island can
never fly away. `fitIsland` contain-centres the island with 96 px padding and reserves a 168 px bottom
band for the resources panel, the buildings panel and the end-turn medallion; it runs on the first
measurement and whenever the route points at another player's island.

## 5. Canvas

`island-canvas.tsx` renders one `<canvas class="island-canvas">` filling `island-page__canvas-slot`.
React only mounts the element: `effect(paint)` repaints straight from the signals, a `ResizeObserver`
re-measures and rewrites `canvas.width = round(rect.width * devicePixelRatio)`, and a
`requestAnimationFrame` loop runs **only while a building is armed** (the green pulse is the one
animation). The cleanup cancels the frame, disposes both effects, unsubscribes the art listener,
disconnects the observer and removes both listeners.

- Wheel: native `addEventListener("wheel", …, { passive: false })`, never the React prop. `ctrlKey` →
  pinch zoom `exp(-deltaY * 0.01)`; `deltaX !== 0` → two-finger pan; otherwise wheel zoom `1.1`.
- Left drag pans. A pointerdown/up inside 4 px and 300 ms counts as a click.
- Click: armed → `placeBuilding`, demolish mode → `demolish`, otherwise → `selectHex`.
- Hover writes `ui.hoveredHexId` and `ui.hoverScreen`. `Esc` and right-click disarm, leave demolish mode
  and close the biome modal.
- Readonly islands keep pan, zoom, hover and the modal; arming and demolishing are impossible, because the
  panels are not rendered and both actions refuse on a foreign island.

`draw-island.ts` paints, in order: the glowing ownership border, then each hex — the procedural biome
swatch clipped to the hex, a grey cover at `DEAD_HEX_TOXICITY`, a green tint proportional to
`hex.toxicity` below it, the building art at `1.4 × hex size` (or the biome glyph on an empty hex), the
toxicity number when it is above zero, then the mode overlays (green pulse on legal hexes, dim on the
rest, red tint in demolish mode) and finally the hover and selected strokes.

`hit-test.ts` exports `hexIdAtWorldPoint(island, world)` and does nothing but call `pixelToHex` and
`hexId` from the core; no hex layout math was written outside `src/core/hex.ts`.

## 6. DOM hooks

| element | selector |
| --- | --- |
| island canvas | `canvas.island-canvas` |
| building card | `button.building-card[data-building="<TBuildingId>"]`, armed → `building-card--armed`, unaffordable → `building-card--poor` |
| card tooltip | `.building-card__tooltip` (CSS `:hover`, the full per-biome yield table) |
| demolish button | `button.demolish-icon`, active → `demolish-icon--active` |
| hover popup | `.hex-popup` (`__title`, `__biome`, `__combo`, `__list`, `__row`, `__toxicity`) |
| biome modal | `.biome-modal` (`__close`, `__swatch`, `__title`, `__description`, `__toxicity`, `__building`, `__yield`) |

`RESOURCE_GLYPHS` (the ten emoji of `01-spec-image-6.png`) is exported from `hex-popup.tsx`; the
buildings panel and the biome modal import it from there, so the glyphs exist in one place outside
S3's `resources-panel.tsx`, which does not export its own copy.

## 7. Self-check

Built `dist/` served with `python3 -m http.server 8402`, driven by Playwright 1.61.1 / chromium-1228 from
a throwaway `scripts/s4-check.ts` that was deleted afterwards. Two runs, two different island seeds, both
green; `page.on("console")` and `page.on("pageerror")` stayed silent.

```
PASS one island canvas — 1
PASS seven building cards — 7
PASS demolish icon — 1
PASS farm card arms — 1
PASS placing a farm costs 10 wood — 30 → 20
PASS placement disarms the card — 0
PASS hover popup — 1
PASS biome modal opens — 1
PASS Escape closes the modal — 0
PASS demolish mode turns on — 1
PASS demolishing a farm refunds 5 wood — 20 → 25
PASS Escape leaves demolish mode — 0
PASS ctrl+wheel re-renders the canvas — equal=false
PASS deltaX wheel pans — canvas changed
PASS readonly hides the buildings panel — 0
PASS readonly keeps the canvas — 1
ALL PASS 16/16
```

Screenshots, all looked at and all fixed where they were wrong:
`…/scratchpad/s4-1-menu.png`, `s4-2-island.png`, `s4-3-armed.png`, `s4-4-placed.png`, `s4-5-popup.png`,
`s4-6-modal.png`, `s4-7-demolish.png`, `s4-8-readonly.png`, plus the crops `crop-seam.png`,
`crop-cards.png` and the art contact sheet `art-sheet.png`
(scratchpad root:
`/private/tmp/claude-501/-Users-aleh-kaportsau-Projects-harwex-mono-worktrees-ostrov-prototype-01/53d19bd8-02b6-407f-af32-23464242a9f6/scratchpad`).

Three defects the screenshots exposed and the code now fixes:

1. The buildings slot at `min(760px, 58vw)` covered the tools column, so the demolish button could not be
   clicked. The slot is back at S3's `min(560px, 42vw)` and the card art is 46 px.
2. `fitIsland` centred the island in the whole viewport, so its bottom row sat behind the buildings panel.
   It now reserves a 168 px bottom band.
3. The camera did not re-frame when the route switched to another player's island. `fitIsland` now runs
   inside its own `effect`, keyed by `viewedPlayerId`.

Build: `dist/` is **628 KB** (10 files: `index.html`, one JS, one CSS, seven webp).

## 8. Deviations

1. **The art is `.webp`, but neither `cwebp` nor `sips` produced it.** `cwebp` is not installed and
   `sips -s format webp` fails with `Can't write format: org.webmproject.webp`. `sips -Z 384 -s format png`
   worked but came to 2.5 MB, well past the 1.5 MB budget. The seven files were therefore written with
   Python's Pillow (`WEBP`, quality 84, Lanczos to 384 px), which is on this machine and needs no install.
   Total: **376 KB**.
2. **The source PNGs are not transparent.** Every one of them is fully opaque, with the "transparent"
   background baked in as a light checkerboard (a black field on `01-spec-image-12.png`). Dropped on a hex
   they showed as a white square. The background is removed by a flood fill from the image border over
   near-grey pixels, with a 0.6 px alpha blur to soften the cut. The cutouts were checked on a contact
   sheet before shipping.
3. **The island border is drawn as an oversized union fill, not an edge walk.** Every hex is added to one
   `Path2D` at `1.08 ×` its size and filled once with a shadow; the real hexes then cover the middle and
   only the glowing rim is left. Walking the boundary would have needed an edge→neighbour table, and
   `src/core/hex.ts` exports none — writing one here would have put hex layout math outside the core.
4. **`RESOURCE_GLYPHS` lives in `hex-popup.tsx`.** S3's `resources-panel.tsx` keeps its ten glyphs private
   and that file is not mine to change, so the shared copy sits in the first S4 component that needed it.
5. **`island-page.tsx` no longer exports `TIslandPageRegistrySlice`.** The page now needs six of the
   registry's actions and hands the whole object to five children, so it takes `TAppRegistry` directly.
   Nothing imported the slice type.
6. **`Esc` clears all three modes at once** — the armed card, demolish mode and the selected hex. The
   brief gives `Esc` to the modes and to the modal separately; one handler covering both is simpler than
   two listeners racing for the same key.
7. **The hover popup is `pointer-events: none`,** so it can never eat a click meant for the hex under it.
