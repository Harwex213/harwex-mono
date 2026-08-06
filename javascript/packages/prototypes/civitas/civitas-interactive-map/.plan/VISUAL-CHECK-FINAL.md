# Final visual verification (whole app, T01-T12)

Date: 2026-08-05
Agent: final visual verification (no production code written)
Build: `prototype/civitas` @ `4555542` (T12 committed). Working tree clean apart from
`.plan/T12/memory.md` and unrelated `.yarn/cache` churn.
Dev server: `yarn dev` on `http://localhost:56838/` (random port, read from the log).
Browser: Chrome, one MCP tab, window 1728 x 940 CSS px, `devicePixelRatio` 2.

Verdict: **the app works end to end.** Every item on the checklist passed. Phase 2 defect 1
(the resize ratchet) and defect 2 (`resetView` unreachable) are **fixed and verified**. Phase 2
defect 3 (label overhang) is **not fixed** and is still visible. Two new cosmetic defects found.
No crash, no console error, no unhandled rejection anywhere in the session.

---

## 0. A tooling caveat you must read before trusting any timing claim below

The Chrome MCP tab **never received a rendering opportunity**: `document.visibilityState` stayed
`"hidden"` and `requestAnimationFrame` fired **0 frames in 500 ms**, even after a click gave the
document focus. This is the known Chrome-MCP limitation. Consequences for this pass:

- `ResizeObserver` callbacks are not delivered until a frame happens. My own probe observer never
  fired either — proof the stall is the harness, not the app.
- `computer screenshot` **does** force a frame. Every resize and every virtual-list assertion below
  was therefore driven as *mutate → screenshot (forces a frame) → read the DOM*.
- The **5 s End Turn arm window expires inside a single tool round-trip.** Two `computer` clicks
  cannot reach the button in time. The first press was verified with a real `computer` click
  (label became `confirm turn 1`, `data-armed="true"`); the confirming second press had to be
  issued from the page (`button.click()`, 120 ms apart). This is a harness limit, not a defect —
  a human at 5 s has ample time.
- Nothing about animation smoothness or frame cost was verified. It cannot be, in this tab.

Everything else was verified either visually from a forced frame or by reading the live DOM.

---

## 1. What was verified

### a. The map renders, zooms, pans; borders align with the art

PASS.

- Cold boot with `localStorage` empty: full-bleed art at fit scale (33%), HUD `fit yes`, and
  **no key written to `localStorage`** until something actually changed. Canvases `3456 x 1992`
  backing store at `1728 x 940` CSS — DPR 2 honoured, two stacked canvases.
- Wheel up over the map: 33% → 52% → 81%. HUD zoom tracks. Wheel down clamps back to the 32-33%
  fit. Left drag moved the map with the pointer; the HUD map-pixel readout followed.
- Border alignment at 81% (see the screenshots in this session): the province border net follows
  every coastline, river and ridge in the art. The country tint's stepped pixel edges land exactly
  on the border polylines — no half-pixel drift between the scene and overlay canvases. HUD
  `border ready · scan 539 ms · segs 132500` after a reload (54-56 ms on a warm scan in Phase 2 —
  the 539 ms is a cold worker scan, still off the main thread).

**Phase 2 defect 1 — FIXED.** Drove the host's own `ResizeObserver`, forcing a frame at each step:

| Step | Host height | Canvas | HUD |
| --- | --- | --- | --- |
| fitted | 940 | 1728 x 940 | `zoom 33% fit yes` |
| grown | 1400 | 1728 x 1400 | `zoom 47% fit yes` |
| restored | 940 | 1728 x 940 | **`zoom 33% fit yes`** |

The map returns to fit. The one-way ratchet is gone. And the fix chose the right policy, which I
also checked: with the user deliberately zoomed to 52% (`fit no`), grow-then-restore **preserves
52%** rather than throwing the zoom away. `syncView` in `src/state/view-store.ts` carries a
`viewFitted` flag that is deliberately read one line stale, and the code says so in a comment that
cites `VISUAL-CHECK-PHASE2.md` by name.

**Phase 2 defect 2 — FIXED.** There is now a `RESET VIEW` button in the bottom control bar. Clicked
it at 52% `fit no`; it returned the view to 33% `fit yes`. `MapCanvas.tsx` also binds the `0` key to
the same action, guarded by `isTypingTarget` so it does not fire inside a text field. The HUD gained
a `fit yes` / `fit no` readout, which makes the whole thing self-evidencing.

### b. Create a country, assign provinces

PASS. `+ new` created `Country 1` with an auto colour, a colour swatch, an inline name input and a
`delete` button, reading `0 prov · 0 px`. `assign: off` → `on` armed the mode: an orange inset rail
around the viewport and a banner `assign mode · Country 1 · left drag paints · alt erases · esc
exits`. Four left drags built the country up to **147 provinces / 297,422 px**, and all three
artefacts appeared together and stayed correct at every zoom:

- **Tint** — the 147 provinces filled with the country's red, `rgba(193, 87, 62, 0.32)` sampled off
  the overlay canvas.
- **Country border** — a thick dark outline around the union of the 147, drawn over the thin
  province lines.
- **Label** — `COUNTRY 1` in letter-spaced caps at the centroid, scaling with zoom. HUD
  `placed 1/1`, `country 4 ms / 11761` — the union recompute is cheap.

`Escape` left assign mode. No browser context menu on right-click.

### c. Country overview

PASS.

- Panel: FLAG slot (`no image`, `CHOOSE FILE…`, the note "png, jpeg, webp or svg · scaled to 384px
  on its long edge before it is saved"), NAME, SLOGAN (placeholder `ever onward`), LORE (placeholder
  "how the country came to be, who rules it, and what it wants"), and a TERRITORY block
  `provinces 147 / area 297,422 px`.
- Edited all three. Name `Country 1` → `Valdoria`, slogan `the tide remembers`, a 107-character
  lore paragraph.
- **The name change is live in four places on the same commit**: the plaque headline (`VALDORIA`),
  the **map label** (`VALDORIA`), the country-list row, and the HUD `active Valdoria`.
- **Flag upload.** Generated a 900 x 600 PNG on a canvas inside the page, wrapped it in a `File`,
  set it on the hidden `input[type=file]` through a `DataTransfer` and dispatched `change`. The flag
  rendered in the panel preview **and** in the plaque; `CHOOSE FILE…` became `REPLACE… / REMOVE`;
  TERRITORY gained a `flag 2 KB` row. The saved payload is a **`data:image/webp`** URL of 2,519
  characters — the downscale-and-recompress path ran, it did not store the raw PNG.

### d. Provinces overview

PASS.

- Header `Valdoria · 147 provinces`, a `Filter` box, editable rows (IMAGE slot + `ADD…`, NAME, LORE),
  footer `147 of 147 shown · 0 edited · no images yet · room for about 83`.
- **Virtualisation confirmed by counting the DOM**: `13` elements match the row class against a
  total of `147`, and the scroller reports `scrollHeight 28812` against `clientWidth`-sized
  viewport. Setting `scrollTop = 4000` and forcing a frame moved the rendered window from
  `Province 187 … Province 348` to `Province 358 … Province 440`, still **13 rows**. 13 of 147.
- **Filter works.** Typing `358` reduced the footer to `1 of 147 shown` and left one row.
- **Row → map.** Clicking the row set HUD `selected 358 · scope province`, put `Province 358` in
  the plaque, and painted the gold selection on that province on the map.
- **Map → row.** Right-clicking a province of the country selected the country and marked
  `Province 187`'s row `data-selected="true"`. Left-clicking a *deep* province (637) drove the
  virtual scroller to `scrollTop 13658` and, after a forced frame, rendered and ringed
  `Province 637` in the middle of the window. Both directions work, including through the
  virtualiser.

### e. Economics — tags, live `[A]`, the step cap

PASS, and the tag discipline holds structurally, not just by convention. Counted over the live DOM,
resolving each `[P]`/`[V]`/`[A]` chip to its containing field or readout:

| | count | inputs found | result |
| --- | --- | --- | --- |
| `[A]` | 84 | **0** | every `[A]` sits in a `readoutLabel`. There is no input, select, textarea or `contenteditable` anywhere under an `[A]`. |
| `[V]` | 49 fields | 49 | **every one `disabled`** with judge mode off. Zero enabled. |
| `[P]` | 27 fields | 27 | all enabled except one — the `enterprise` select, correctly disabled with the caption `no action pending`. |

- **Judge mode.** The checkbox flips `data-judge="true"` on the panel root. **46 of 48** `[V]` fields
  become enabled and gain a gild border (`1px solid rgb(154, 107, 31)`), visibly different from the
  dimmed `VOLUME LOCKED` state. The two that stay disabled are contextually correct and say why:
  `roll (d10) — no action pending` and `grant a concession in — a concession needs a region of
  Bengo, Aglan, Sudhara or Badiyat`. **`[A]` stays read-only in judge mode**, as designed.
- **A `[P]` change updates `[A]` live.** Typed `emission` 0 → 4 through the real input.
  **16 readouts moved on the one commit**, and the arithmetic matches the spec:
  `inflation 0.00% → 6.00%` (1.5 x), `FR from emission 0.00 → 2,000.00`
  (4% of 100,000,000 obor / 2,000 obor per FR), `emission rating cost 0.00 → +2.00`,
  `rating next turn 70 → 68`, `FR generated 10,017.00 → 12,017.00`, `growth modifier +0.63 →
  +0.11 pp` (0.63 + 0.08 auto-invest − 0.60 inflation drag), `reserve cap 20,034 → 24,034`,
  `debt limit 22,538.25 → 27,038.25`.
  `GDP next turn` did **not** move, because a fresh country has 0 deposits and every sector is
  shortage-capped at 0.00% growth. That is design edge case 3, and the panel says so in a footer
  line, so nobody will file it as a bug. Setting the eight `deposits` to 400 through judge mode
  immediately produced `overall growth +3.11%` and `GDP next turn 103,113,880`.
- **The emission step cap blocks the edit, with a visible message.** With `emissionPct` 4 and a
  10.00 pp step window the field renders the always-visible caption
  `step this turn: 10.00 pp — you may set 0.00% to 10.00% (now 4.00%)` and the input carries
  `min="0" max="10" step="0.01"`. Typing `30`:
  - during the draft window: `aria-invalid="true"`, `data-invalid="true"`, and the message
    **`outside 0 to 10`** rendered under the field;
  - after the 200 ms commit window: the value **snapped back to `4`**, `aria-invalid="false"`;
  - `localStorage` holds `emissionPct: 4`. Nothing over-large was ever written.
  Typing it with real keystrokes produced the same snap-back — I could only catch the invalid
  intermediate state by reading the DOM inside the debounce window.
- **The pre-flight error list works too.** Added an FR expense ledger line of 99,000 against
  12,184.62 available. The remainder readout went to `-86,815.38` in danger tone with the inline
  explanation `the ledger is over — End Turn will refuse (V5)`, and the pre-flight list showed
  `V5 · frExpenseLines · the FR ledger is over by 86815.38 points`.

### f. End Turn

PASS.

- **Two-stage arm.** First press: label `end turn 1` → `confirm turn 1`, `data-armed="true"`.
  Second press within 5 s resolves. Verified the arm with a real click and the resolve from the page
  (see §0).
- **The turn advanced and persisted immediately.** `turn 1 → 2`, `history.length 0 → 1`, and
  `civitas.state.v1` already carried `turn: 2` on the next read — `flushState()` ran, the write was
  not left to the 400 ms debounce.
- **Outcome banner**: `turn 1 resolved. growth was 3.11%, and the rating moved from 70 to 68.` with
  a `DISMISS` button.
- **A failing turn changes nothing.** With the V5 ledger overrun in place, two presses produced a
  `role="alert"` banner reading `turn 2 was not resolved and nothing changed. V5 ·
  frExpenseLines · the FR ledger is over by 86815.38 points`, and `turn` stayed 2 with
  `history.length` 1. The engine's "writes nothing on failure" guarantee holds through the store.
- **`clear all lines` is also two-press**: `clear all lines` → `confirm — clear all four ledgers`.
- **The history is a readable per-step record, not a raw dump.** Turn 2's entry, newest first and
  open by default (turn 1 below it, closed), reads:
  - headline: GDP `103,113,880` → GDP next `106,316,460`, overall growth `+3.11%`, FR generated
    `12,184.62 FR`, FR remainder `12,184.62 FR`, MIC generated `240.46 MIC`, MIC remainder
    `240.46 MIC`, credit rating `68` → `66`, control `50` → `50`;
  - then all fifteen engine steps in order with humanized labels and units:
    `CHECKS` (GDP, planned growth 3.00%) · `RESOURCES` (free units carried 319,387 units) ·
    `INCOME` (FR generated, MIC generated, FR before emission 10,122.34, FR from emission 2,062.28,
    rating factor x0.98, control multiplier x1.00) · `ACTIONS` *no change* · `BORROWING`
    (debt limit 18,276.92, headroom 18,276.92) · `SAVINGS` *no change* · `DEBT SERVICE` *no change* ·
    `STOCKPILE UPKEEP` *no change* · `SPENDING` (FR/MIC available and remainder) ·
    `AUTO-INVESTMENT` (auto-invested 36,392,312, +0.71 pp, note "both remainders are now discarded —
    points do not carry over") · `GROWTH` (global modifier 0.11 pp, overall 3.11%, and a final pct
    per sector) · `GDP` (next turn, change) · `CREDIT RATING` (emission −2, next 68, note "not a
    clean turn, so no automatic recovery") · `FLAGS AND COOLDOWNS` (cleared one-shot inputs 7) ·
    `COMMITTED` (turn, GDP, rating, control).
    Zero-valued rows are dropped and a step that loses every row renders one grey `no change` line,
    so the step order is still legible. Figures are right-aligned tabular.

### g. Reload

PASS. Reloaded twice. After the reload from turn 2, and again after reaching turn 3:

| Thing | Survived |
| --- | --- |
| country | `Valdoria`, 147 provinces, 297,422 px, tint + country border + label all re-rendered |
| slogan / lore | both intact, in the plaque and the panel |
| flag | intact, 2,519-char `data:image/webp` — rendered in the plaque and the panel |
| turn | 3 |
| `emissionPct` | 4, and the step window correctly re-derived to `0.00% to 14.00%` from the new `emissionPctLast` of 4 |
| deposits | 400 on all eight resources |
| history | 2 turns, newest first, newest open |
| rating / GDP | 66 / 106,316,460 |
| judge mode | reset to **off** — view state, not world state, as designed |
| panel | closed — view state, as designed |
| repair notice | **absent**, so `economyFromJson` round-tripped the document with no repairs |

Stored payload: 13,567 bytes under `civitas.state.v1`. Keys `version`, `provinceOverrides`,
`countries`, `economics`, `nextCountryId` — T12 added no top-level key.

---

## 2. Console output

Clean. Across the whole session — cold boot, four paint drags, three panels, ~120 field reads, a
flag upload, three End Turn attempts (two resolved, one refused) and three reloads — the app
produced **zero** errors, **zero** warnings and **zero** unhandled rejections.

The only messages in the console were, at load:

```
[INFO] [rspack-dev-server] Server started: Hot Module Replacement enabled, Live Reloading enabled, ...
[LOG]  [HMR] Waiting for update signal from WDS...
```

and, intermittently, one message that is not ours:

```
[WARNING] chrome-extension://didegimhafipceonhjepacocaffmoppf/.../browser-integration.js
port disconnected from addon code: 7be1c6bf-...
```

That is the Claude Chrome extension's own content script.

---

## 3. Defects, worst first

### 1. The country label overhangs its own country — Phase 2 defect 3, unfixed

Severity: cosmetic, but now clearly worse than Phase 2 reported, and reproducible on the first
country a user paints.

At 81% zoom the `VALDORIA` label spills out of the country on **both** sides: `VAL` sits on
unassigned green land to the west and `RIA` on unassigned land to the east. Only the middle two
letters are over the country's own tint. `layoutCountryLabels` places at the centroid and hides a
label that cannot fit, but a long thin country produces a centroid inside a narrow strip and the
fitted label still spills sideways.

This misreads badly: a viewer sees `VALDORIA` written across territory that is not Valdoria's. The
label was also legible at 33% for the same country, so the naive fix (shrink harder) costs
readability. Whoever fixes it has to pick a policy — shrink to the inscribed width, place at the
pole of inaccessibility rather than the centroid, or accept the overhang and add a leader line.

Phase 2 filed this as "may not matter for realistic country shapes". At 147 provinces in a
snake-shaped country it matters.

### 2. The panel-button bar overlaps the HUD

Severity: cosmetic, always present at this viewport.

Measured off the live DOM at 1728 x 940:

- HUD: x `12 … 686`, y `882 … 928`
- button bar (`COUNTRY` / `PROVINCES` / `ECONOMICS` / `RESET VIEW`): x `621 … 1107`, y `893 … 928`

They overlap by 65 px horizontally and 35 px vertically. The `COUNTRY` button sits on top of the
HUD's bottom-right corner, covering part of the `segs 132500` chip and the HUD's own border. Both
elements are position-fixed with no reserved gutter between them, so the overlap is unconditional,
and it gets worse as the viewport narrows and the HUD's flex-wrap pushes more content right.

The HUD itself does not overflow (`scrollWidth === clientWidth === 672`), so this is purely a
layout-adjacency bug between two sibling overlays, not a text-overflow bug.

### 3. The economics tables are 344 px wide and scroll horizontally in a 1728 px window

Severity: low. Usability, not correctness.

The Economics panel body gives its `tableWrap` containers `clientWidth 344`. The sector table wants
`955`, the resources table wants `1306`, and the loan table wants `631`. All three do scroll
correctly inside their own container (`overflow-x: auto`) and the panel body itself never scrolls
sideways — the design's rule is honoured. But the practical result is that the resources table shows
about a quarter of its columns at a time, and the sector table cuts `PERMANENT` mid-word at the
panel edge with no visible scrollbar hint until you try to drag it.

This is a consequence of the fixed panel width, not of the table code. It is worth a scroll
affordance (a fade or a chevron) or a wider panel for this one section.

### 4. Nothing else

No functional defect was found in T09-T12. Specifically checked and correct: `[A]` never editable in
either mode; `[V]` never editable with judge mode off; `[P]` always editable except where the panel
explains why not; step caps enforced with a message and a snap-back rather than a silent clamp;
End Turn two-press; End Turn writes nothing on a validation failure; `flushState` on a resolved turn;
history newest-first with the 12-turn cap named in the footer; no spurious `localStorage` write on
mount; judge mode and panel state deliberately not persisted.

---

## 4. Not covered

- **Frame-level behaviour of any kind.** The tab rendered 0 frames (§0). Nothing about animation,
  paint cost, drag smoothness or the border-scan worker's effect on interactivity was observed.
- **The quota / oversized-document path.** Design §10 step 7 asks for `civitas.state.v1` stuffed to
  near the quota and then a field edit, to see `saveNoticeFor` at the top of the panel. Not run —
  filling the quota would have destroyed the state this pass was verifying, and there was no second
  browser profile to do it in.
- **`statePersistent === false` (a future-version document)** and the `read-only` badge, and the
  End Turn disabled-with-reason path that goes with it.
- **The remaining `[V]` verdict surfaces**: mobilization, region, nationalization/privatization with
  a typed d10 roll, concessions in a concession region, loans and manual `allocatedFr` with
  auto-service off, and the Other-sector add/remove. Rendered and correctly locked/unlocked, but
  their downstream arithmetic was not exercised turn by turn.
- **More than one country**, and therefore: switching country mid-edit (the `key`-per-country draft
  drop), multi-country border interaction, and draft pruning on `deleteCountry`.
- **Alt-erase during a paint stroke.**
- **Touch, and any browser other than Chrome.**
