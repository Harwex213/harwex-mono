# T08-FIX — design

Fixes the three defects in `.plan/VISUAL-CHECK-PHASE2.md` section 3.

- **D1** (must fix) — the view scale ratchets up on a viewport resize and never re-fits.
- **D2** (must fix) — `resetView()` is dead code; no UI reaches it.
- **D3** (best effort) — a country label can overhang its own country's shape.

No new source file. No new `localStorage` key, no schema field, no migration. The
fitted flag is session state, exactly like the view it describes.

---

## 1. Files touched

| Path | Change |
|---|---|
| `src/map/view.ts` | Add `MIN_SCALE`, `fittedScale`, `isFittedScale`, `resizeView`. `fitView` reuses `fittedScale`. Nothing existing changes behaviour. |
| `src/map/view.test.ts` | New tests for the four additions. Existing 27 tests untouched. |
| `src/state/view-store.ts` | New `viewFitted` signal. `writeView` derives it. `syncView` branches on it. |
| `src/state/view-store.test.ts` | `reset()` also resets `viewFitted`. New tests, including the 906 → 1400 → 906 sequence. |
| `src/ui/MapCanvas.tsx` | Extract `isTypingTarget`. The existing keydown effect gains the `0` reset shortcut. HUD gains a `fit` readout. |
| `src/ui/Shell.tsx` | A `Reset view` action button in the bar, calling `resetView()`. |
| `src/ui/shell.module.css` | `.barAction` and `.barDivider`. |
| `src/map/label-layout.ts` | D3: the per-offset trial also probes the two ends of the text span, with a guaranteed fallback pass. |
| `src/map/label-layout.test.ts` | New tests for the end probe and for the fallback. Existing 38 tests untouched. |
| `README.md` | The fitted policy, the shortcut table, the end probe. |

`src/ui/render.ts`, `OverlayInput`, `borders-store.ts`, `label-store.ts`,
`assign-store.ts`, `world-store.ts` and every panel file are **not** touched.
`render.test.ts`'s byte-identical assertions therefore still hold.

---

## 2. D1 — the resize ratchet

### 2.1 The defect, restated

`clampScale(scale, map, viewport)` floors at `fitScale(map, viewport)`. `syncView`
runs `clampView` on every viewport change, so growing the viewport raises the floor
and drags the scale up with it; shrinking it back lowers the floor and leaves the
scale where it was. One-way ratchet, map cropped.

The fit floor is **correct for user zoom** and must stay: `zoomAt` relies on it, and
`view.test.ts` and `view-store.test.ts` both pin "zooming out terminates at exactly
the fit view". The fix is that the **resize path stops using `clampScale`**, not that
the floor changes.

### 2.2 The policy (as briefed, no substitutions)

- The view is *fitted* when the user has not deliberately zoomed away from the fit
  scale. A fresh load starts fitted.
- Wheel zoom, double-click zoom and any explicit zoom control clear it. Returning
  exactly to the fit scale sets it again.
- On a viewport resize: fitted → recompute and stay at the new fit scale. Not
  fitted → preserve the absolute scale and re-clamp the translation only.
- Scale is still clamped to `MIN_SCALE .. MAX_SCALE`.

### 2.3 The flag is DERIVED, not imperative

`fitted === (view.scale === fittedScale(map, viewport))`, recomputed on every write
to the view signal and stored in `viewFitted`.

Deriving it is exactly equivalent to setting and clearing it by hand — a wheel notch
in either direction produces a scale that either is or is not the fit scale — and it
cannot go stale. It self-heals: a future zoom control needs no new wiring, and a
wheel event fully swallowed by the clamp leaves the flag alone because the scale did
not move.

The flag has to be **stored** rather than computed on demand, because at resize time
the question is "was this view fitted for the *previous* viewport". `setViewport`
writes `viewport.value` before it calls `syncView`, so the stored flag is
deliberately one viewport stale at the moment it is read. That staleness is the
whole mechanism.

The exact `===` is safe. `fitScale` is `Math.min(w / mw, h / mh)` over identical
inputs and is bit-identical between two calls, and `zoomAt` returns the floor value
itself (`Math.max(lo, scale)` returns `lo`) when the clamp bites, which is why the
existing "terminates at exactly the fit view" test can use `deepEqual`.

### 2.4 `src/map/view.ts` — additions

```ts
// Defensive only. No user action can reach it: zoom out floors at the fit scale
// and `resizeView` never lowers a scale. It exists so a preserved scale cannot be
// driven to 0, NaN or negative by a pathological resize sequence. At 0.02 the
// 3653 x 2855 map is still 73 x 57 CSS px and one keypress from a re-fit.
const MIN_SCALE = 0.02;

// The scale a fitted view has. `fitScale` capped at MAX_SCALE, which is what
// `fitView` already produced through `clampScale`; extracted so the store can ask
// "is this the fit scale" without building a whole View.
function fittedScale(map: Size, viewport: Size): number;

function isFittedScale(scale: number, map: Size, viewport: Size): boolean;

// The RESIZE clamp. Unlike `clampView` it does NOT floor the scale at the fit
// scale — that floor is what ratchets a view up when the viewport grows and never
// lets it back down. The translation is clamped exactly as before.
function resizeView(view: View, map: Size, viewport: Size): View;
```

Bodies:

```ts
function fittedScale(map: Size, viewport: Size): number {
  return Math.min(MAX_SCALE, fitScale(map, viewport));
}

function isFittedScale(scale: number, map: Size, viewport: Size): boolean {
  return scale === fittedScale(map, viewport);
}

function resizeView(view: View, map: Size, viewport: Size): View {
  let scale: number;
  if (Number.isFinite(view.scale) && view.scale > 0) {
    scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale));
  } else {
    // The same fallback `clampScale` makes: a non-finite scale becomes the fit
    // scale, never NaN and never MIN_SCALE.
    scale = clampScale(view.scale, map, viewport);
  }
  return clampTranslate({ scale, x: view.x, y: view.y }, map, viewport);
}
```

`fitView` becomes `clampTranslate({ scale: fittedScale(map, viewport), x: 0, y: 0 }, ...)`.
That is the same number `clampScale(fitScale(...), ...)` returns today, including the
viewport-larger-than-8x-the-map case, so no `fitView` test changes.

`clampScale` and `clampView` are **not** modified. `clampView` is left exported and
is now used only by `view.test.ts` and by ~15 `render.test.ts` view fixtures. That is
deliberate: it is the "clamp everything including the scale floor" helper, and
deleting it would mean rewriting those fixtures for no gain. Do not delete it and do
not route the resize through it.

Add to the grouped export at the end of the file: `MIN_SCALE`, `fittedScale`,
`isFittedScale`, `resizeView`.

### 2.5 `src/state/view-store.ts` — additions

```ts
// Session state, never persisted, exactly like `view` itself. True while the view
// sits at the fit scale — i.e. while the user has not deliberately zoomed. A
// resize re-fits a fitted view and preserves the scale of one that is not.
const viewFitted = signal(true);
```

`writeView` gains the derivation and runs it **before** the sameView early return,
so a resize that leaves the view untouched still re-evaluates the flag against the
new viewport:

```ts
function writeView(next: View): void {
  // `peek`, not `value`. `writeView` runs from DOM handlers and plain effects and
  // must never widen a dependency set.
  const size = mapSize.peek();
  const port = viewport.peek();
  if (size && port.width > 0 && port.height > 0) {
    const fitted = isFittedScale(next.scale, size, port);
    if (viewFitted.value !== fitted) {
      viewFitted.value = fitted;
    }
  }
  const current = view.value;
  if (current && sameView(current, next)) {
    return;
  }
  view.value = next;
}
```

`syncView` branches, and its first-view path now goes through `writeView` so the flag
is set there too:

```ts
function syncView(): void {
  const size = mapSize.value;
  const port = viewport.value;
  if (!size || port.width <= 0 || port.height <= 0) {
    return;
  }
  const current = view.value;
  // Fresh load, and a fresh load is fitted.
  if (!current) {
    writeView(fitView(size, port));
    return;
  }
  // The flag still describes the PREVIOUS viewport here; `setViewport` wrote the
  // new one a line earlier. That is what makes "was the user fitted before this
  // resize" answerable at all.
  if (viewFitted.peek()) {
    writeView(fitView(size, port));
    return;
  }
  writeView(resizeView(current, size, port));
}
```

`resetView`, `panTo` and `zoomAtPoint` are unchanged. All three already go through
`writeView`, so the flag follows for free — `resetView` sets it, a zoom in clears it,
a zoom out back to fit sets it again.

Imports change from `clampView` to `fitView, isFittedScale, resizeView, screenToMap,
translateTo, zoomAt`. Add `viewFitted` to the grouped export.

### 2.6 Consequences and edge cases

| Case | Behaviour | Why it is right |
|---|---|---|
| 906 → 1400 → 906, never zoomed | 32% → 47% → **32%** | The defect, fixed. |
| 906 → 1400 → 906, user at 300% | 300% throughout | A resize alone never changes a deliberate zoom. |
| Non-fitted scale **below** the new fit (zoom slightly in, then grow the window) | Scale preserved; the map is now smaller than the viewport on both axes and `clampTranslate` centres it, so it letterboxes on all four sides | Required by the briefed policy. It is recoverable in one keypress, and the alternative is the ratchet. Document it. |
| `setViewport(0, 0)` — an ancestor goes `display: none` | `syncView` returns early; view and flag both survive | Pinned by the existing "a zero-sized viewport report leaves the previous good view untouched" test. |
| Fractional `getBoundingClientRect` jitter while fitted | Re-fits to the new fit each time | Not a ratchet; the scale tracks the viewport in both directions. |
| Viewport larger than 8x the map | `fittedScale` caps at `MAX_SCALE`, and `isFittedScale` compares against the same capped number | Without the shared helper the flag would read false forever there and every resize would preserve instead of fit. |
| `dpr` change | Nothing. `dpr` never enters the scale. | |
| Non-finite scale reaching `resizeView` | Falls back to the fit scale, exactly as `clampScale` does | A `MIN_SCALE` fallback would leave a 73 px map on screen after a NaN. |

### 2.7 D1 tests

`src/state/view-store.test.ts` — **the `reset()` helper must also set
`viewFitted.value = true`**, or a leftover `false` leaks across tests in the file.

1. `"a viewport that grows and shrinks back returns to the fit scale"` — the required
   test. `ready(1728, 906)`; record `fitScale(MAP, HOST)`; `setViewport(1728, 1400)`
   and assert the scale is the 1400 fit; `setViewport(1728, 906)` and assert
   `deepEqual(view.value, fitView(MAP, HOST))`. Assert the intermediate scale is
   strictly greater than the 906 fit, so the test would still fail if the whole
   resize path were replaced by "never touch the scale".
2. `"a deliberate zoom survives the same grow-and-shrink sequence"` — same sequence
   with a `zoomAtPoint(800, 400, 4)` first; the scale is identical at all three steps.
3. `"a resize preserves a scale that is now below the new fit scale"` — fitted at
   906, `zoomAtPoint` by a small factor, grow to 1400, assert the scale did not move
   up to the new fit and that `x` and `y` stay finite and centred.
4. `"zooming back to the fit scale re-arms the re-fit"` — zoom in, zoom out until the
   scale is the fit again, assert `viewFitted.value === true`, then resize and assert
   the view re-fits.
5. `"resetView re-arms the re-fit"` — zoom in, `resetView()`, assert
   `viewFitted.value === true`, resize, assert the view re-fits.

`src/map/view.test.ts`

6. `"resizeView preserves the scale where clampView would raise it"` — the pure-unit
   twin of test 1, asserting `resizeView` and `clampView` disagree on exactly that
   input.
7. `"resizeView clamps to MIN_SCALE and MAX_SCALE and never returns NaN"` — including
   a non-finite input scale falling back to the fit scale.
8. `"isFittedScale agrees with fitView for both fit axes and for a huge viewport"`.

---

## 3. D2 — a reachable reset control

Two entry points, both calling the existing `resetView()` from
`src/state/view-store.ts`. No new store, no new action.

### 3.1 The shortcut: `0`

Existing bindings are `l` / `L` (labels, `MapCanvas`) and `Escape` (close panel, else
leave assign mode, `Shell`). `0` collides with neither and is the fit-to-view key
users already know from design tools.

It joins the **existing** keydown effect in `MapCanvas.tsx` — one window listener for
map keys, not a second one. That effect's "is the user typing" guard is lifted to a
module-level helper so both keys share it verbatim:

```ts
// A keydown inside a text field is text, not a shortcut. `CountryPanel` and every
// T09-T12 field would otherwise blank the map or jump the view mid-word.
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  if (target.isContentEditable) {
    return true;
  }
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}
```

The handler keeps its existing modifier guard (`alt`, `ctrl`, `meta` → return), then
switches on `event.key`: `"l"` / `"L"` → `toggleLabels()`, `"0"` → `resetView()`.
Nothing else. No `preventDefault` — `0` has no default action outside a field.

`resetView` writes signals and is called from a DOM handler, which is legal. It is
**not** callable from a `useSignalEffect`; the store rule is unchanged.

### 3.2 The button

`Shell.tsx`, in the existing `.bar`, after the three panel buttons and a thin
divider. It stays a **sibling of the map host**, so it needs no `data-hud-control`
(the T06/T08 rule, restated in `Shell.tsx`'s header comment).

```tsx
<span className={styles.barDivider} />
<button
  className={styles.barAction}
  title="Reset view (0)"
  type="button"
  onClick={() => {
    resetView();
  }}
>
  Reset view
</button>
```

No `aria-pressed`, no `data-on`: it is an action, not a toggle. It is never disabled
— a disabled control that re-enables on a zoom is more confusing than a no-op click,
and `resetView` already writes nothing when the view is already fitted.

`shell.module.css` gains `.barAction` (the `.barButton` shape with
`background: var(--civ-plaque-dim)` or a plain transparent parchment and no
`data-on` state) and `.barDivider` (`width: 1px`, `background: var(--civ-line)`,
`align-self: stretch`). Tokens only — no hardcoded colour, gap, radius or font size.
One declaration per line.

### 3.3 The HUD readout

`Hud()` in `MapCanvas.tsx` gains one span next to `zoom`:

```
fit  yes | no
```

reading `viewFitted.value`. It is the instrument that makes D1 checkable in the
browser without the devtools: resize the window and watch whether `fit` stays `yes`.
The HUD is verification UI by charter (README, "The HUD in `MapCanvas.tsx` stays").

### 3.4 D2 verification

The button and the shortcut are `.tsx` and cannot be unit tested — the repo has no
jsdom, and T08 already recorded that rule. What is testable is `resetView` itself,
which `view-store.test.ts` already pins and which tests 4 and 5 above extend.
Reachability is verified in the browser (section 6).

---

## 4. D3 — label overhang (best effort, and it is worth doing)

### 4.1 Verdict: do it, with a fallback pass

The risk the brief worries about is real but avoidable. The fit test uses the
country's union bounding box, so a long thin country passes it even where no part of
it is that wide — the trap README already records under "Country labels". The cheap
correct probe is at the **placement** stage, not the fit stage.

The change is confined to the offset loop inside `layoutLabels`:

- Extract the existing 7-offset trial into a helper
  `chooseOffset(..., requireEndsInside: boolean)` that returns the winning
  `{ rect, index, centreY }` or `null`. The body is today's loop, verbatim, plus one
  extra condition.
- When `requireEndsInside` is true, a trial also back-projects the two ends of the
  **text span** — `(cx - textWidth / 2, cy)` and `(cx + textWidth / 2, cy)`, not the
  padded box corners — through `screenToMap` and requires `contains` on both.
- `layoutLabels` calls it with `true` first. **If that returns `null` it calls it
  again with `false`**, which is exactly today's behaviour.

The fallback is what makes this safe: the probe can only change *which* offset wins,
never *whether* a label is placed. A label that overhangs today either moves to an
offset that does not, or stays exactly where it is. No label is lost, no existing
assertion about placement counts can flip, and `placed`/`drawn` in the HUD cannot go
down.

Pan invariance survives. `mapToScreen` then `screenToMap` of an offset from the
anchor gives `anchor + offset / scale`, independent of `view.x` and `view.y`, so the
probe is a function of the scale alone — the same property the existing nudge probe
has, and `PAN INVARIANCE` stays green.

Cost: at most 2 extra `contains` calls per trial and at most one extra 7-trial pass
per label, i.e. ≤ 28 bitmap reads per label per frame against ≤ 7 today. Countries
number in the tens. Negligible.

### 4.2 Why not the alternatives

- Widening `FIT_WIDTH_RATIO` hides labels that are fine today. It is a blunt
  instrument aimed at the wrong stage.
- A run-length probe over the country's rows (the refinement T07 suggested) needs a
  per-country scan of the province bitmap and a cache keyed on `provinceIds`
  identity. That is a T07-sized piece of work, not a fix.
- Adding horizontal entries to `NUDGE_OFFSETS` changes the placement of every
  existing multi-country layout and would churn the pinned `offsetIndex` assertions.

### 4.3 The one hard rule

**If any existing test in `label-layout.test.ts` or `label-layer.test.ts` fails, do
not touch that test.** Put the probe behind an option — `probeEnds?: boolean`
defaulting to `false` — and pass `probeEnds: true` from `layoutCountryLabels` in
`src/ui/label-layer.ts`. The analysis says the fallback pass makes that unnecessary,
but the escape hatch is cheaper than an argument. Weakening a T07 assertion is not on
the table either way.

### 4.4 D3 tests

In `label-layout.test.ts`, beside the existing nudge tests:

1. `"a label whose ends leave the country moves to an offset where they do not"` — a
   `contains` that accepts a tall narrow vertical strip around the anchor. Assert the
   chosen `offsetIndex` is one of the vertical nudges, and assert both ends of the
   winning rect's text span back-project inside the strip.
2. `"when no offset keeps the ends inside, the label is still placed"` — a `contains`
   that accepts a region narrower than the text at every offset. Assert
   `placements.length === 1` and that the result is identical to the pre-change
   layout (offset 0). This is the test that pins "the probe never costs a label".
3. `"the end probe does not depend on the translation"` — the same candidates at two
   view translations give the same `offsetIndex`.

---

## 5. Explicitly NOT part of this task

- Any change to `clampScale`, `clampView`, `zoomAt`, `fitScale` or `MAX_SCALE`
  behaviour. Zoom-out still floors at the fit scale.
- Deleting `clampView`. It stays exported and test-used.
- Persisting the view, the zoom or the fitted flag. Session state, by decision.
- An animated or eased reset. `resetView` is an instant jump, like the double-click
  zoom.
- Zoom in/out buttons, a zoom slider, a minimap, keyboard panning.
- Touch, pinch zoom, non-Chrome browsers. Still a desktop prototype.
- The two known layout overlaps left to T09 (plaque vs panel dock at 900-1200 px, HUD
  `max-width` below 760 px).
- A run-length fit test, a per-country horizontal profile, or any change to
  `resolveLabelAnchor`, `findInteriorPoint`, `chamferDistance` or the font ramp.
- The other items in VISUAL-CHECK section 4 ("not covered"): flag upload, quota
  recovery in the browser, alt-erase, multi-country border interaction.

---

## 6. Verification

Run from
`javascript/packages/prototypes/civitas/civitas-interactive-map`.

```bash
yarn test        # every existing test still passes; the count only goes up
yarn typecheck   # prints nothing on success
yarn build       # two asset size warnings are expected and pre-existing
```

`yarn test` must report **≥ 493 passing and 0 failing**. Note the per-file counts
before the change if a regression needs bisecting: `view.test.ts` 27 top-level tests,
`view-store.test.ts` 16, `label-layout.test.ts` 38.

Sanity greps:

```bash
grep -rn "clampView" src/            # view-store.ts must no longer appear
grep -rn "resetView" src/ui/         # MapCanvas.tsx and Shell.tsx must both appear
```

Browser check, the same way `.plan/VISUAL-CHECK-PHASE2.md` did it — `yarn dev`, then
in the page drive the host's own `ResizeObserver` by changing the shell height:

1. Load. HUD reads `zoom 32%`, `fit yes`.
2. Host height 906 → 1400 → 906. HUD returns to `zoom 32%`, and the map is not
   cropped. This is the exact reproduction from the visual check.
3. Wheel in to ~150%. HUD reads `fit no`. Repeat step 2: the zoom stays at ~150% at
   every step.
4. Press `0`. The map returns to the fit view and `fit` reads `yes`.
5. Click `Reset view` in the bar after a deep zoom. Same result. Clicking it twice
   changes nothing and logs nothing.
6. Focus a panel text field, type `0` and `l`. The map does not move and the labels
   do not toggle.
7. Create a long thin country, zoom to ~150%, toggle labels with `l`: the name sits
   within its own territory, or at worst no worse than before.
8. Console clean apart from the known Chrome-extension warning.

---

## 7. Documentation

`README.md`, three edits:

1. **"Rendering, zoom and pan" → "The view store"** — a new paragraph on the fitted
   policy: what `viewFitted` means, that it is derived from the scale on every write,
   that it is read one viewport stale on purpose, and that the resize path uses
   `resizeView` rather than `clampView` because the fit floor is a ratchet. Add to
   its "Traps" list: *a non-fitted view whose scale is below the new fit letterboxes
   on all four sides, by policy; `0` re-fits it.*
2. **"Selection and the UI shell"** — a new "### Keyboard and the reset control"
   subsection with the full shortcut table, which does not exist anywhere in the
   README today:

   | Key | What it does | Owner |
   |---|---|---|
   | `L` | Toggles the country labels | `MapCanvas.tsx` |
   | `0` | Resets the view to the fit scale | `MapCanvas.tsx` |
   | `Esc` | Closes the open panel, else leaves assign mode | `Shell.tsx` |

   Plus: every map shortcut is ignored inside an `INPUT`, `TEXTAREA`, `SELECT` or
   `contentEditable` element and under any modifier chord, through the one shared
   `isTypingTarget` helper; and the bar's `Reset view` button is the same action.
3. **"Country labels" → "The fit test and the greedy layout"** — the end probe and
   its fallback pass. Replace the "a long thin country ... a run-length probe is the
   next refinement" trap with what now happens, and keep the note that the *fit* test
   still uses the union bounding box.
