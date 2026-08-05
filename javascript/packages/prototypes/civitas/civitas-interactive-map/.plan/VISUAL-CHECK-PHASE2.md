# Phase 2 visual verification (T05-T08)

Date: 2026-08-05
Agent: visual verification (no production code written)
Build: `prototype/civitas` @ `0799722`, dev server `yarn dev` on `http://localhost:54254/`
Browser: Chrome, tab kept active/foreground, window 1728 x 906 CSS px, `devicePixelRatio` 2

Verdict: **the app visibly works.** Every item on the checklist passed. Two real defects
found, both behavioural, neither a crash and neither blocking Phase 3.

## 1. What was verified

### a. The map art renders

PASS. Full-bleed canvas showing the artistic render at fit scale (32%), letterboxed
horizontally with the sea colour on both sides. Not blank, not a broken image.

Checked the pixel data, not just the picture. Reading the scene canvas back with
`getImageData` at four screen points:

| Point | RGB | Reads as |
|---|---|---|
| open water | `51, 60, 79` | dark navy sea |
| temperate land | `86, 97, 85` | sage green |
| southern biome | `103, 75, 31` | ochre desert |
| unpainted western landmass | `57, 55, 53` | near-black land |

The near-black landmass down the western edge is the source art, not a rendering
fault. Hovering it reports `province —`, and `painted.coverage` in the manifest is
0.264, so that continent simply has no provinces painted on it. Confirmed against
`assets/map.png` decoded independently in the page: the same map pixel reads
`51, 49, 47` in the file.

Canvas sizing is correct: both stacked canvases are `3456 x 1812` backing store at
`1728px x 906px` CSS, i.e. DPR 2 is honoured.

### b. Zoom and pan

PASS.

- Wheel up over the map: 34% -> 71% -> 151% -> 675%. HUD zoom readout tracks it.
- Wheel down: returns to the 32% fit and clamps there.
- Left drag from (800,400) to (500,250): the map moved with the pointer, HUD cursor
  readout went from `px 268, 2009` to `px 1843, 1288`.
- No page scroll behind the zoom, so the `{ passive: false }` wheel listener works.

### c. Province borders line up with the art

PASS at every zoom tried. At 32% the border net follows every coastline and island
outline. At 151% and 675% the borders still sit exactly on the art's terrain and
river features, and the country tint's stepped pixel edges land exactly on the
border polylines — no half-pixel drift between the scene and overlay canvases.
Border scan runs off the main thread: HUD reports `border ready · scan 54-56 ms ·
segs 132500`.

### d. Hover, left click, right click

PASS.

- Hover paints a translucent gold fill over exactly the province under the cursor,
  bounded by its borders.
- Left click selects: plaque changed to `PROVINCE 1294`, HUD to `selected 1294 ·
  scope province`.
- Right click on a province belonging to a country: plaque changed to `COUNTRY 1`,
  HUD to `scope country`. **No browser context menu appeared** — verified twice, once
  before any country existed and once after.

### e. Create a country and assign provinces

PASS.

`+ new` created `Country 1` with an auto colour `#c0563f`. `assign: off` -> `assign:
on` armed the mode: an orange inset rail appeared around the viewport and a banner
read `assign mode · Country 1 · left drag paints · alt erases · esc exits`. One left
drag across the map assigned 10 provinces, and all three artefacts appeared at once:

- **Tint** — the 10 provinces filled with the country's red.
- **Country border** — a thick dark outline around the union of the 10, drawn over
  the thin province lines.
- **Label** — `COUNTRY 1` in letter-spaced small caps at the country's centroid,
  scaling with zoom. HUD `placed 1/1`.

The country panel row updated live to `10 prov · 18,687 px`, the plaque to `Province
1294 · 10 provinces`. HUD `country 2 ms / 1065` — the country border recompute is
cheap and did not freeze the UI.

`l` toggles the labels off and back on; the tint and country border stay.

### f. Persistence across reload

PASS. After the reload, `Country 1` was still in the list at `10 prov · 18,687 px`,
and the tint, country border and label all re-rendered on the map. The stored payload
is 239 bytes under `civitas.state.v1`:

```json
{"version":1,"provinceOverrides":{},"countries":[{"id":1,"name":"Country 1","slogan":"","lore":"","flagDataUrl":null,"provinceIds":[1241,1286,1289,1294,1301,1325,1327,1334,1341,1345],"colorHex":"#c0563f"}],"economics":{},"nextCountryId":2}
```

A cold load with `localStorage` cleared boots clean, shows `no countries yet`, and
writes **no** key until something actually changes — no spurious write on mount.

### g. Panels and Escape

PASS.

- `COUNTRY` opens the country panel: flag slot (`no image` + `CHOOSE FILE…`), NAME
  (`Country 1`), SLOGAN (placeholder `ever onward`), LORE textarea, and the note
  `T09 fills in the rest of this panel.`
- `PROVINCES` opens a header `Country 1 · 10 provinces` and 10 rows, `Province 1241`
  … `Province 1345`, with `Province 1294` ringed as the selected one. Note
  `T10 replaces these rows with editable ones.`
- `ECONOMICS` opens `COUNTRY / Country 1`, `TURN / —`, note `T11-B implements the
  calculator; T12 renders the sheet.`
- Escape closes the open panel: `#civ-panel` leaves the DOM.
- Escape with no panel open leaves assign mode instead (`assign: on` -> `assign:
  off`, rail and banner gone). The single-listener precedence documented in
  `Shell.tsx` behaves as written.

## 2. Console output

Clean. Across the whole session — load, zoom, pan, paint, panel open/close, two
reloads — the console produced **one** message, and it is not ours:

```
[WARNING] chrome-extension://didegimhafipceonhjepacocaffmoppf/.../browser-integration.js
port disconnected from addon code: 27115142-2b99-4271-853c-6cbaa5210368
```

That is the Claude Chrome extension's own content script. **Zero** errors, zero
warnings and zero unhandled rejections from the app itself.

## 3. Defects, worst first

### 1. The view scale ratchets up on resize and never re-fits — the map stays cropped

Severity: moderate. User-reachable with an ordinary window resize.

`syncView` in `src/state/view-store.ts` calls `clampView` on every viewport change,
and `clampScale` in `src/map/view.ts` only enforces the fit scale as a **lower**
bound:

```ts
return Math.min(MAX_SCALE, Math.max(lo, scale));   // lo = fitScale(map, viewport)
```

Growing the viewport raises `fit` above the current scale, so the scale is pulled up
to the new fit. Shrinking it back lowers `fit` below the scale, so the scale is left
where it is. The result is a one-way ratchet.

Reproduced deterministically by driving the host's own `ResizeObserver`:

| Step | Host height | HUD zoom |
|---|---|---|
| fitted | 906 | 32% |
| grown | 1400 | 47% |
| restored | 906 | **47%** |

At 47% in a 906 px viewport the map is cropped top and bottom — the southern
continents run off the bottom edge. This also happened twice by accident during the
session, presumably when a Chrome toolbar appeared or disappeared and briefly changed
`innerHeight`, leaving the map at 34% instead of the 32% fit.

Recovery exists but is not obvious: wheeling out returns to fit, because fit is the
clamp floor. There is no control that does it directly — see defect 2.

Not a wrong fix to just re-fit on every resize: that would throw away a deliberate
zoom whenever the window changes. Whoever fixes this has to choose the policy.

### 2. `resetView` is dead code — no UI reaches it

Severity: low.

`resetView()` is exported from `src/state/view-store.ts` and is referenced only by
`src/state/view-store.test.ts`. Nothing in `src/ui/` calls it, and there is no
keyboard shortcut and no button for it. It is the natural escape hatch from defect 1
and from any accidental deep zoom, and it is not wired up.

### 3. The country label can overhang the country's own shape

Severity: cosmetic.

At 151% the `COUNTRY 1` label extended past the left edge of its country into the
neighbouring unassigned province. `layoutCountryLabels` places at the centroid and
hides a label that cannot fit, but for a long thin country the fitted label still
spills sideways. Only observed with a single 10-province country in a strip shape, so
it may not matter for realistic country shapes. Worth a look when T07's overlap
avoidance meets real data.

## 4. Not covered

- Flag upload, and the localStorage quota / downscale path for data-URL images. That
  is T09's surface; the file picker was rendered but not driven.
- Corrupt or oversized `civitas.state.v1` recovery. Unit tested in T05; not exercised
  in the browser.
- Alt-erase during a paint stroke, and multi-country border interaction.
- Touch and non-Chrome browsers.
