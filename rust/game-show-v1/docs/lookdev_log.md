# Look-dev log

One section per round. Each round: what the render looked like against
`docs/wheel_stage.png`, what was wrong on the six crops, and what the round asked the fixer
for. Judged by eye on crops only. No histogram, mean or similarity score was computed, by
the standing instruction in `docs/agent_plan.md` invariant 4.

Machine-readable verdicts live beside the renders as `renders/verdict_r<N>.json`.

## Round 1

Shot `renders/r1.png`, crops `renders/crops_r1`, verdict `renders/verdict_r1.json`.
`cargo build --release` was clean and the shot wrote all seven files.

**Converged: no.**

### What the frame looks like

It is a recognisable version of the stage. Geometry, framing, the sector fan, the truss ring,
the pillars and the podium are all there and in the right places. But it reads as a pale
pastel daylight render where the reference reads as a saturated night stage.

Two causes account for most of it.

1. The two spot beam cones are enormous. A cream-white band about 240 px wide and 640 px long
   sweeps from the top edge near x 1000 diagonally down across the right pillar to about
   (1536, 520), nearly opaque, with a hard curved bright rim where its base circle turns away.
   A grey twin does the same over the left pillar and the podium. The reference has nothing of
   the kind: it has about ten narrow cones, 15 to 20 px at the lens, widening to only 55 to
   75 px after 180 px, brightest over the first third and gone before the floor. The washes
   erase the near-black violet ceiling void that the reference keeps in both top corners, and
   they lift and desaturate everything they cross. The left pillar ends up lighter than the
   wall behind it, which inverts the reference exactly.
2. Nothing glows and nothing reflects. The bulb channel on the rim is a row of dark beads. The
   crest crystal is a pale grey cone with no halo and no white spike. The podium desk band,
   the brightest thing in its crop in the reference, is a dark maroon ring here. The floor
   shows no reflection at all where the reference gives it a gold column under the wheel,
   magenta streaks under the beams and crisp gold ring inlays.

On top of that the hub is the wrong object - a magenta glossy ball with one pinpoint specular
instead of a violet-silver brushed disc with a radial sunburst inside a gold bezel - the
sector colours are pastel with cobalt blue effectively missing, the LED wall is milky pink,
and the frame has no left/right colour split at all.

### Crop by crop

- **hub.** Reference: cool violet-silver brushed dome, eight to ten alternating wedges
  converging on the centre, one groove circle at 55% of the radius, a broad silver-white lobe
  toward ten o'clock, warm gold-brown bezel, saturated wedges around it. Render: a saturated
  magenta sphere with a single pinpoint specular, a ring of dark rivets, a pale rose bezel,
  and a pastel fan in which the magenta is dusty rose, the cyan is mint, the gold is khaki and
  the cobalt is absent.
- **rim_top.** Reference: a stack of concentric gold bands alternating with dark warm-brown
  grooves on hard boundaries, blown warm bulb dashes in the outer channel with 4 to 8 px
  halos, chrome pegs each with a small white specular, and a magenta crystal with the frame's
  widest halo plus a hard white spike. Render: one flat pale cream band with no groove
  structure, near-black navy pegs with no specular, tiny cool white bulb dots with no halo,
  and a blunt pale grey crest. The top corners are milky lavender instead of near-black.
- **floor.** Reference: glossy plum-violet floor, blown gold band along the base plate's top
  edge with the crop's highest contrast under it, a warm gold reflection column reaching the
  bottom edge, vertical magenta streaks, and two or three crisp gold ring inlays over the
  blur. Render: a flat dark steel-blue floor, a few thin cool cyan arcs, a large featureless
  dark base drum, and no reflection of anything.
- **screen_left.** Reference: cobalt and royal blue upper right, magenta-violet through the
  middle, coral and peach cauliflower cloud tops at the left approaching white, hard lobes and
  flat interior steps, plus gold fascia pinstripes and a dark pillar silhouette. Render: one
  flat pale lavender-pink field with soft low-contrast wisps, no blue, broad matte tan fascia
  stripes, and a pale pink pillar brighter than the wall.
- **truss.** Reference: near-black violet void, a tangle of thin bright rim-lit lines, blown
  lens cores with tight halos, narrow coloured cones, anamorphic magenta flares 40 to 60 px
  wide, and a fine dust of sparkles. Render: the rim lighting on the tubes is actually close,
  but the void behind them is pale lavender haze, there are no flares and no sparkles, and the
  coloured bands between the chords are broad overlapping cone haze rather than discrete
  cones.
- **podium.** Reference: a black form drawn with gold lines, a lemon-white clipped desk band
  as the crop's brightest feature, a gold base ring, near-black panels with a barely readable
  violet-brown grid, and a short dark reflection. Render: dull bronze trim, a dark maroon desk
  rim with only a faint warm edge, no base ring, mid brown-grey panels, and no reflection.

### What was checked and found innocent

- `assets/wheel_stage.glb` has no duplicate node and no scaled node, so the big arc in the
  upper right is not doubled geometry. It is a beam cone.
- The embedded `T_LEDWall_Sky` (4096x1024) was extracted and looked at. It is a good painterly
  sunset: indigo zenith, magenta midband, coral and cream cloud tops. The washed-out screen is
  caused by how the texture is combined, not by the art.
- The beam cone half-angle is right. At the reference's scale a 0.19 rad cone is about 70 px
  wide after 180 px of travel, which is what `docs/look_target.md` asks for. The cones are too
  long and too bright, not too wide.
- The truss tubes' rim lighting reads close to the reference already.

### What round 1 asks for, in order

1. `src/postfx.rs` - shrink and dim the cones. `BEAM_STRENGTH` 3.0 to about 0.6-0.9,
   `BEAM_SPOT_LENGTH` 8.0 to about 2.5, `BEAM_HEAD_LENGTH` 5.0 to about 2.2, and a stronger
   `BEAM_LENGTH_FALLOFF` so no cone reaches the fascia. Keep the per-side tints saturated
   after the cut: lavender-magenta left, amber plus cyan right, never cream.
2. `assets/scene.json` - light the bulb ring. Raise `MAT_Bulb_Glass`'s emission well above the
   bloom threshold and warm it so the outer channel clips to pale lemon, and let that ring be
   what rim-lights the underside of the rim, the pegs and the floor.
3. `src/postfx.rs` - the floor reflection, which does not exist yet. Mirror the stage in the
   floor plane, blur it vertically only, composite at near full strength at the contact line
   decaying over about an eighth of the wheel's screen height, and draw the `Floor_Rings`
   inlays after the blur so they stay crisp.
4. `src/scene.rs` - fix the hub: raise its roughness so it stops mirroring the violet room,
   desaturate it toward silver, restore the gold bezel, and paint the radial sunburst into its
   roughness or normal (8 to 10 wedges plus one groove circle at 55% of the radius).
5. `src/postfx.rs` - make the bloom work. Lower `BLOOM_THRESHOLD` toward 1.0, raise
   `BLOOM_STRENGTH`, widen the second blur so the crest can reach a 25 to 40 px halo while the
   podium desk band stays near 10 px.
6. `src/screen.rs` - stop washing the sky out. Drive the wall from the texture as emission
   only, at a gain that keeps the indigo top dark and lets only the cloud tops clip, and check
   the UV scale: the render's cloud lobes read larger and softer than the source art's.
7. `assets/scene.json` - the crest crystal's emission and hue, the podium desk band's
   specular, the fascia pinstripe, and the floor inlays' gold.
8. `src/lighting.rs` - put the left/right split in. The environment map varies with elevation
   only; it needs an azimuthal hue swing, magenta-coral to camera-left and cobalt-cyan to
   camera-right, with `Rim_L` and `Rim_R` carrying more of the frame.
9. `src/postfx.rs` - sparkles and horizontal anamorphic flares. Deterministic at the shot's
   fixed time.

Fix order matters. Defect 1 is lifting and desaturating most of the frame, so the pastel
sectors, the pale pillar and the flat fascia cannot be judged until the cones are cut. Do 1,
then 2, then re-render before touching the material-level items.

One thing not to chase: the wheel sits smaller and higher in the render than in the painting,
and its base is a tall drum that fills most of the floor crop. The camera comes from the GLB
and the base is Blender geometry, so neither is to be edited. Judge the floor on its gloss,
its gold column and its crisp inlays, not on the slab's outline.

## Round 2

Shot `renders/r2.png`, crops `renders/crops_r2`, verdict `renders/verdict_r2.json`.
`cargo build --release` was clean and the shot wrote all seven files.

Judged by eye on the six crop pairs plus four extra pairs cut with `src/bin/crop.rs`:
`sky_right` at 1252,240 420x400, `crest` at 740,0 220x220, `low_right` at 1050,600 620x341,
and `top_right` at 1100,0 572x340. No histogram, mean or similarity score was computed.

**Converged: no.**

### What round 1 fixed

Real progress, and worth naming so nobody undoes it. The cream beam washes are gone. The
ceiling void is dark instead of milky lavender. The bulb ring emits and rim-lights the rim and
the floor. The floor reflects. The hub is a brushed silver disc with a radial sunburst inside a
bezel instead of a magenta ball. The sector fan's cobalt blue is back. The frame now reads as a
night stage rather than a pale pastel daylight render, which is what round 1 asked for.

### What the frame looks like now

Two things separate it from the reference, and both are bigger than anything else on the list.

1. **Nothing in the set is dark.** The pillar in `screen_left` is a pale grey-lavender fluted
   column, plainly brighter than the wall behind it, with a dozen fine vertical flute
   highlights. The reference pillar is a dark violet-brown silhouette carrying exactly two
   bright stripes, and it is darker than the screen. The podium body panels read mid-brown and
   half translucent where the reference has them near-black and opaque. The truss chords read as
   fully shaded solid tubes where the reference is nine parts silhouette to one part rim line.
   The moving-head bodies are pale grey boxes. All four use dark materials in `assets/scene.json`
   already, so the light reaching them is what is wrong, not their albedo. This removes the
   reference's whole contrast structure - saturated coloured light on near-black forms - and it
   is the most expensive defect in the frame.
2. **The LED wall lost its colour.** It is a muted mauve with soft airbrushed white-grey wisps
   and a near-black navy top, and it looks the same on both sides. The reference has coral and
   salmon cauliflower lobes on violet at the left and cyan-white lobes on cobalt at the right.
   The wall is the largest surface in the frame, so its greyness drains the whole image, and it
   also erases the left/right colour split, which the reference carries mainly here. The source
   texture was pulled off disk and looked at again: it is a good painterly sunset. The render is
   showing its navy zenith band, washed, magnified and blurred, with a field of white dots
   sprayed over it.

### Regressions

- **The head cones are now absent rather than oversized.** Round 1 asked for the two cream
  washes to be cut and they were cut to nothing. The `top_right` corner shows five clear cones
  in the reference - one amber, two cyan, two lavender - and none in the render. The `truss`
  crop shows blown lens dots on a black starfield with nothing descending from them. The upper
  half of the frame is empty. `BEAM_HEAD_LENGTH` went to 2.2 m, which subtends far less than the
  reference's 150-250 px at the truss's distance from a 22mm lens.
- **Bloom now over-swells two features it should leave alone.** The bulb ring has fused into one
  continuous glowing tube with a wide halo around the whole wheel, which erased the rim's stack
  of concentric gold bands and hard dark grooves. The crest crystal is a soft pale-pink mushroom
  with no facets, no readable outline and no white spike.
- **The void has crossed over from milky lavender to crushed neutral black.** The target asks for
  a lifted, plum-tinted black that keeps the truss faintly readable in the top corners.

### Crop by crop

- **hub.** Much improved: a brushed disc with a radial sunburst inside a bezel, and the cobalt
  sector is back. Still off: the bezel is neutral pale grey dominated by a circle of near-black
  rivets where the reference has warm gold-brown chrome with two thin circumferential highlight
  lines and no readable rivet ring; the dome's brightening is centred and symmetric where the
  reference puts a broad silver-white lobe toward ten o'clock and lets the lower-right quadrant
  fall to dark plum-grey; the sectors are pastel - dusty rose for hot magenta, slate for cobalt,
  mint for cyan, khaki for gold; and the thin gold hairline that outlines every sector in the
  reference is absent. Warm bloom from the rim also spills over the crop's top edge, and the
  target says a hub that glows is wrong.
- **rim_top.** The rim is one glowing gold tube about 14 px thick with a broad halo, against the
  reference's ~45 px stack of alternating bright bands and dark warm-brown grooves on hard
  boundaries with discrete bulbs sunk in the outer channel. The pegs read close, slightly dark.
  The crystal is a soft pink blob. The top corners are near-black neutral rather than dark violet.
- **floor.** The reflection exists now, which is the round's biggest single win, but it reflects
  the wrong way: thin hard-edged coloured lines instead of broad blurred smears, with the
  reflected bulbs reading as a row of discrete dashes and the reflected pillar as a bundle of
  separate wires. The gold column under the wheel is missing. The ring inlays are six or seven
  hairlines reading cyan and white, where the reference has two or three broad bright gold arcs.
  The base plate's top edge is a thin bright line rather than the reference's 20-35 px soft bar.
  The base drum's front face is a flat cool blue-grey with no tonal variation.
- **screen_left.** The worst crop. Muted mauve, soft wisps, navy-black top, lobes two to three
  times larger and softer than the source art's, white dots over everything, no coral, no
  cobalt. The fascia bands are broad matte olive-brown ribbons with no bright line and no dark
  grooves. The pillar is inverted in value against the wall.
- **truss.** The void is black with an even field of uniform white dots that reads as an outdoor
  starfield rather than glitter in stage air - no larger soft blobs, no magenta specks, no
  clustering near the lamps, and none of the reference's drifting violet debris. No cones. The
  flares are hard 2 px pink scratches where the reference's are soft magenta smears 40-60 px
  wide and three to five times wider than tall. The chords are too bright and read as neon tubes.
- **podium.** Largely unchanged from round 1 in the ways that matter. The desk band, the crop's
  brightest feature in the reference and a clipped lemon-white bar, is a dull bronze-olive rim
  with two small speculars. The gold base ring is absent. The gold ribs are dull bronze rather
  than bright lines with hard edges, so the podium does not read as a black form drawn with gold
  lines. The monitor is inverted: pale grey-lavender and brighter than the body, where the
  reference makes it the darkest object in the crop. No reflection under the podium.

### Checked and found innocent

- The source texture `T_LEDWall_Sky.png` (4096x1024) was pulled off disk and looked at. Navy
  zenith with its own faint stars, strong magenta midband, coral and peach cloud tops with hard
  lobes. The washed wall is how the texture is windowed and gained, not the art.
- The GLB material assignments were read directly. `Pillar_L_Core` is `MAT_Pillar_Body` alone,
  at base colour (0.09, 0.075, 0.11) and roughness 0.45. A diffuse surface at that albedo cannot
  render pale grey, so the pale pillar is a lighting defect and not a wrong material.
- `BEAM_TINTS_RIGHT` does hold the reference's amber-gold at indices 0 and 2, so the missing
  amber is the cones being invisible, not a missing tint.
- The start-up line reports 14 cones built (2 spots, 12 heads), so the head cones are
  constructed and drawn. They are too short and too faint, not missing from the pipeline.

### What round 2 asks for, in order

1. `src/lighting.rs` - cut the flat light and put it back as direction. `AMBIENT_INTENSITY` 0.28
   toward 0.08-0.12 and `RIM_LOOK_GAIN` 2.4 toward 1.2-1.5. Judge on the pillar: it must end up
   darker than the screen band beside it, with one strong gold vertical highlight right of its
   centre, a thinner cool one at its left edge, and near-black in between. The podium panels, the
   truss and the moving-head bodies should fall to near-black by the same change.
2. `src/screen.rs` - raise `SCREEN_EMISSION_GAIN` until the wall is the second-brightest thing in
   the frame after the wheel and keep its chroma while doing it. Slide `SCREEN_UV_WINDOW` down the
   texture so the coral and peach cloud tops land in the visible band and the navy zenith is
   mostly cropped off above the fascia. Shrink the window, or rescale the UVs, so the lobes come
   back to the source art's size and keep their hard edges and flat interior steps. Put the
   left/right split in here: coral-magenta to camera-left, cobalt-cyan to camera-right, either by
   sampling a different horizontal region of the 4096-wide texture per side or by grading the
   emission per side. Confine `star_field` to the wall's top or drop it.
3. `src/postfx.rs` - the head cones back. `BEAM_HEAD_LENGTH` 2.2 to roughly 4.0-5.0 so a cone
   reads 150-250 px on screen, and enough strength that each is plainly visible against the black
   void with soft edges. Keep the half-angle; round 1 already verified it. Confirm the amber lands
   in the top-right corner. Do not lengthen the two SPOT cones with them.
4. `src/postfx.rs` - un-fuse the bloom. Pull the wide tap back so each bulb keeps a 4-8 px halo
   and the rim's gold bands and dark grooves read individually again, and so the crest's facets
   and outline are readable inside a 25-40 px halo. The wheel-wide halo ring must go entirely.
   Then give the crest a hard 4-6 px white spike in a 12-20 px magenta halo.
5. `assets/scene.json` - re-judge the sectors after item 1, since a flat light term desaturates a
   diffuse surface and may be the whole cause. If still pastel, push `MAT_Sector_Pink`, `_Cyan`,
   `_Blue` and `_Gold` back toward full chroma and leave `_Cream` and `_White` alone. Find the
   geometry between two sectors and make it read as a bright gold hairline.
6. `assets/scene.json` - the podium. Desk band clipping to pale lemon with an 8-15 px halo and no
   smear onto the body, the gold base ring restored as a second bright line, the ribs raised in
   contrast against near-black panels, the monitor confirmed dark after item 1.
7. `src/postfx.rs` - the floor reflection. Raise the vertical blur well past 22 px, raise the
   horizontal blur too, and add taps, so no inverted geometry is recognisable and the bulb dashes
   become one continuous gold column under the wheel. Widen the base plate's top-edge glow to
   20-35 px. Check why the podium gets no reflection - `REFLECTION_SEARCH_PX` and
   `FLOOR_PLANE_TOLERANCE` are the two constants that would exclude it.
8. `src/scene.rs` - the hub bezel to warm gold-brown with two circumferential highlight lines and
   the rivets sunk, and the dome's bright lobe made directional toward ten o'clock with a dark
   plum-grey lower-right quadrant that keeps its brushed wedges.
9. `src/postfx.rs` - shorten the two SPOT cones so they die above the fascia and raise their
   length falloff so the base circle fades instead of terminating. There is a straight-edged
   translucent veil crossing the wall band and the floor at about frame x 1270 and a mirror of it
   on the left; no cone edge in the reference is a straight line across a wall.
10. `assets/scene.json` - the fascia as a pinstripe: a narrow bright gold line along its curve
    with the dark bands above and below staying dark.
11. `src/postfx.rs` - thin the sparkles out, vary their size to include the reference's 6-10 px
    soft blobs, get the magenta ones to appear, weight them toward the lamps, and keep them off
    the LED wall. Widen and soften the flares so each reads as a horizontal magenta smear rather
    than a scratch. Both stay deterministic at the shot's fixed time.
12. `src/postfx.rs` - lift the toe slightly and tint it plum-violet so the ceiling void is a dark
    violet that keeps the truss faintly readable, not a crushed neutral black.

Fix order matters again. Do item 1 alone and re-render before anything else. It lifts the
pillars, the podium, the truss and the moving-head bodies out of black, and it is the most
likely cause of the pastel sectors (item 5) and the flat fascia (item 10). None of those can be
judged until the set is dark again. Then item 2, the largest surface in the frame, then item 3,
which fills the upper half.

## Round 3

Shot `renders/r3.png`, crops `renders/crops_r3`, verdict `renders/verdict_r3.json`.
`cargo build --release` was clean and the shot wrote all seven files.

Judged by eye on the six crop pairs plus five extra pairs cut with `src/bin/crop.rs` into
`renders/x3/`: `sky_right` at 1252,240 420x400, `top_right` at 1100,0 572x340, `low_right` at
1050,600 620x341, `crest` at 740,0 220x220, `lower_wheel` at 660,560 380x280. No histogram, mean
or similarity score was computed.

**Converged: no.**

### What round 2 fixed

- The set is dark. Pillars, podium panels, truss and moving-head bodies are near-black instead of
  pale grey, so the reference's contrast structure - saturated coloured light on dark forms -
  exists in the frame now. This was round 2's item 1 and its most expensive defect.
- The LED wall has colour and a left/right split: magenta-pink to camera-left, violet-blue to
  camera-right.
- The head cones are back. `top_right` shows five reading clearly, and two of them are amber-gold,
  in the corner where the reference puts its only warm beams.
- The floor reflects, and `low_right` shows both the ring inlay arcs and a reflection under the
  pillar.
- The sector fan's cobalt is present and the fan is no longer pastel across the board.

### What the frame looks like now

It reads as the right kind of picture. A saturated night stage, a hot gold wheel, a coloured wall,
ten narrow cones under the truss, a dark set, a reflecting floor. What separates it from the
reference is value and structure, not layout.

1. **One glow covers every stacked-band detail the reference draws with a hard edge.** The bulb
   ring's bloom is still fused. The rim is two thin bright gold lines with a continuous glowing
   strip between them, about 20 px tall, wrapped in a warm halo that washes roughly 40 px up into
   the sector fan and out into the top corners as a brown haze. The reference rim is a ~45 px stack
   of alternating bright gold bands and hard dark warm-brown grooves, with discrete bulbs sunk in
   the outer channel carrying a 4-8 px halo each. Agent C ranks the sector fan plus the bulb ring
   first; this defect destroys half of that feature and desaturates the other half. The same
   failure repeats elsewhere: the fascia is a broad dark ribbon with no gold pinstripe, the podium
   desk band is a dark bronze rim where the reference clips it to lemon-white, and the floor's ring
   inlays are pale hairlines instead of broad bright gold arcs.
2. **The floor is a void the set stands in, not a lit stage floor.** Its reflection column is milky
   grey-pink where the reference has a warm gold one, and it carries a regular checkerboard stipple
   at about frame (480-600, 845-940) that reads as a rendering artifact rather than a blurred
   mirror. The plane itself is a dark grey-violet where the reference is a bright saturated
   magenta-violet. Agent C ranks the floor second and it carries the whole lower third of the frame.
3. **Round 2's cut to the flat light went one stop too far on the speculars.** Both pillars are now
   flat near-black fluted columns: correctly darker than the wall, but with no vertical gold
   highlight at all, so each reads as a hole rather than a form. The truss rim light has gone cool
   steel-blue where the reference lights the whole lattice violet-magenta. The hub dome is a flat
   dark grey disc with no ten-o'clock lobe.
4. **The wall shows the right art at the wrong gain and the wrong magnification.** Soft airbrushed
   wisps instead of hard-lobed cauliflower with flat interior steps, no cobalt at all on the left,
   no cyan-white tops on the right, and dimmer than the reference, which wants it second-brightest
   after the wheel.

### Regressions

- Both pillars lost their gold vertical highlight. Round 2 item 1 asked for a pillar darker than
  the screen **with** one strong gold highlight right of centre. It got the first half only.
- The truss rim light turned cool. In `top_right` the chords read steel-grey-blue.

### Round 2 asks that did not land

Items 4 (un-fuse the bloom, crest spike), 6 (podium desk band and base ring), 7 (podium
reflection), 10 (fascia pinstripe), 11 (anamorphic flares and varied sparkles) and 12 (plum toe).

### Crop by crop

- **hub.** The dome is a flat dark grey-violet disc: the sunburst is only just visible, the
  brightening is a faint centred glow, and it reads matte rather than brushed. The reference puts a
  broad silver-white lobe toward ten o'clock and lets the lower-right quadrant fall to plum-grey
  while keeping its wedges. The bezel is a pale gold ring dominated by a circle of near-black
  rivets; the reference bezel is smooth warm gold-brown chrome with two thin circumferential
  highlight lines and no readable rivet ring. The amber wedges read tan-orange, and the thin gold
  hairline the reference draws between every pair of sectors is absent.
- **rim_top.** The fused rim described above. Pegs are near-black balls with no specular and their
  gold stalks do not read. The crest is a soft pink chevron in an even magenta glow with no white
  core and no spike. The top corners are neutral dark with a brown haze rather than dark violet.
- **floor.** The reflection reads wrong in colour and in texture: milky grey-pink with a
  checkerboard stipple. The blown gold bar along the base plate's top edge is a thin bright line
  with one hot spot instead of a soft 20-35 px bar. No crisp gold inlays anywhere in the crop. The
  floor plane at the crop's left is dark grey-violet against the reference's bright magenta-violet.
- **screen_left.** The worst crop, for a different reason than round 2. A flat salmon-pink field
  with soft white wisps: no cobalt, no coral-to-cream hard lobes, no flat interior steps, and lobes
  two to three times larger and softer than the source art's. The three fascia bands are broad dark
  grey-brown ribbons with no bright gold line, the exact inverse of the reference's pinstripe. The
  pillar is correctly dark and completely unlit.
- **truss.** The void is near-neutral black with a uniform field of tiny white dots that reads as an
  outdoor starfield: no 6-10 px soft blobs, no magenta specks, no clustering near the lamps, none of
  the reference's violet confetti. Two thin steel-grey-blue arcs stand in for the reference's dense
  violet-lit lattice. The cones are the right count and roughly the right width but desaturated to
  grey-lavender and grey-teal, and each lens core renders as a small white rounded rectangle rather
  than a round blown disc with a halo. The flares are two or three thin diagonal pink scratches.
- **podium.** The body is near-black with thin gold rib highlights, a real improvement. The desk
  band is still a dark bronze-olive rim with pinpoint speculars where the reference makes it the
  crop's brightest feature, clipping to pale lemon-white. No gold base ring, no diagonal grid on the
  panels, no reflection under the podium, and the floor at the crop's left and bottom is nearly
  black where the reference has a bright violet plane with gold arcs crossing it.

### Checked and found innocent

- `renders/r3.png` is byte-for-byte the same size as `renders/r2_fixed.png`, so the shot is
  deterministic and r3 is the state the round-2 fixer left.
- The cone count and placement are right. postfx reports 38 cones (2 spots, 12 truss heads, 24 PAR
  cans) and `top_right` shows five reading clearly with amber in the corner. The cone defect is tint
  and lens shape, not geometry.
- `docs/scene_audit.md` line 252: `MAT_Gold_Trim` is shared by 21 objects, including `Wheel_Rim`,
  `Floor_Rings`, `Podium_Desk` slot 1, `Wall_Fascia` slot 1 and `Wheel_Pegs` slot 1. Brightening
  that material cannot separate the desk band, the inlays and the fascia from the rim, which is
  already too hot. Those need per-node overrides in `src/scene.rs`, where `HUB_RING_NODE` and
  `HUB_RIVET_NODE` already show the mechanism. This is most likely why round 2 items 6, 7 and 10
  went undelivered.
- `docs/scene_audit.md` line 295: `Wheel_Pegs` slot 0 is `MAT_Peg_Metal` (the balls) and slot 1 is
  `MAT_Gold_Trim` (the stalks), so the dark peg balls are that material and not a mis-slotted gold.

### What round 3 asks for, in order

1. `src/postfx.rs` - un-fuse the bulb-ring bloom. `BLOOM_WIDE_STRENGTH` 0.09 toward 0.03-0.05 and
   `BLOOM_BLUR_SPREADS[1]` 5.0 toward 3.0-3.5, keeping `BLOOM_STRENGTH` so the narrow halo survives.
   Judge on the `lower_wheel` pair: bright band, dark groove and bulb channel must each read
   separately, no cream veil may reach the sectors, and the wheel-wide halo and the brown haze in the
   top corners must both go.
2. `src/lighting.rs` - give the speculars back without lifting the set. Leave `AMBIENT_INTENSITY` at
   or below 0.18 and raise `RIM_LOOK_GAIN` 1.30 toward 1.8-2.1. Judge only on the pillar: darker than
   the screen band beside it, one strong vertical gold highlight right of its centre, a thinner cool
   one at its left edge, near-black between them. The podium ribs and the peg speculars should sharpen
   by the same change.
3. `src/postfx.rs` - the floor. Keep the reflection's own hue instead of tinting it by the floor, so a
   warm gold column runs from the base plate down to the frame edge, and raise
   `REFLECTION_STRENGTH` at the contact line. Fix the checkerboard stipple: the tap stride under
   `REFLECTION_TAPS` 41 over `REFLECTION_BLUR_PX` (10, 48) with `REFLECTION_SQUASH` 4.0 is above one
   pixel, so bring the stride sub-pixel or jitter the taps deterministically. Find why the podium is
   excluded - `REFLECTION_SEARCH_PX` 130 and `FLOOR_PLANE_TOLERANCE` 0.06 are the two constants that
   would do it.
4. `src/screen.rs` - the wall. Raise `SCREEN_EMISSION_GAIN` 0.85 until only the cloud tops clip and
   the wall is second-brightest after the wheel. Shrink `SCREEN_UV_WINDOW` (0.36, 0.14) so the lobes
   come back to the source art's size with hard edges, and posterise the sampled value so their
   interiors read as flat steps. Sample a different horizontal region of the 4096-wide texture per
   side rather than tinting the same region, so the left keeps coral over violet with cobalt above it
   and the right gets real cyan-white tops on cobalt.
5. `assets/scene.json` - the sectors. `MAT_Sector_Gold` is at (0.97, 0.30, 0.008), which is orange;
   Blender has (0.95, 0.64, 0.08). Put green back near 0.60 so the wedge reads amber-gold. Re-judge
   `MAT_Sector_Pink` and `MAT_Sector_Cyan` on the `lower_wheel` pair.
6. `src/scene.rs` - the gold hairline between sectors. `Wheel_Spokes` carries `MAT_Gold_Trim`; give it
   a per-node lift so it reads as a thin bright gold line, without raising the shared material.
7. `src/scene.rs` - the podium desk band and base ring as per-node golds on `Podium_Desk` and
   `Podium_Trim`, bright enough to clip warm and to sit over `BLOOM_THRESHOLD` for an 8-15 px halo
   with no smear onto the body. Same mechanism for `Floor_Rings`, so the inlays read as broad bright
   gold arcs and stay crisp over the blur.
8. `src/scene.rs` - the hub. Widen `HUB_LOBE_GAIN` (1.3, 0.78) so the ten-o'clock lobe reads near-white
   and the lower-right quadrant reads dark plum-grey with its wedges intact, lower the rough end of
   `HUB_ROUGHNESS_SCALE` (2.0, 1.15) to bring the brushed sheen back, warm `HUB_RING_NODE` toward
   gold-brown with two thin circumferential highlight lines, and raise `HUB_RIVET_NODE` toward the
   bezel so the rivets stop punching a dark dotted ring through it.
9. `src/postfx.rs` - the cones. Cut the per-cone strength (`BEAM_STRENGTH` 1.8,
   `BEAM_HEAD_STRENGTH_SCALE` 2.1) and put the loss into the tint's chroma, so the amber reads amber
   and the cyan cyan at each cone's brightest third. Give the lens cores a round blown profile with a
   halo one and a half to two diameters wide instead of a flat clipped quad.
10. `src/scene.rs` - the crest. Cut `CRYSTAL_LOOK_EMISSION` (4.6, 0.62, 5.8) until the facets and the
    outline read inside the halo, keep the shell near-white with the magenta in the core, then add the
    hard 4-6 px white spike inside a 12-20 px magenta halo running out of the top of the frame.
11. `src/lighting.rs` - the truss hue. `ENVIRONMENT_BAND_TOP` 0.2445 and `ENVIRONMENT_BAND_BOTTOM`
    0.2322 confine the violet-magenta to a narrow elevation, so a tube up at the truss ring sees a
    neutral probe. Widen the band upward or add a violet term above it. Keep the tubes nine parts
    silhouette to one part rim light; the fix is the rim line's colour, not filling the tube in.
12. `src/postfx.rs` - the flares. Lower `FLARE_THRESHOLD` 5.5 so the lens cores and the crystal all
    seed one, raise `FLARE_SPREAD` 9.0 so the long axis reaches 40-60 px, and cut `FLARE_ASPECT` 0.25
    so the short axis stays three to five times narrower. Horizontal, soft-edged, deterministic.
13. `assets/scene.json` - the fascia. Raise `Wall_Fascia`'s gold slot so its narrow line reads bright
    along the whole curve on both sides, keeping `MAT_Gold_Dark` dark above and below it.
14. `src/postfx.rs` - the sparkles. Separate the two populations so the large one reads as a 6-10 px
    soft blob and the small one stays 1-3 px, thin the small one out, let the magenta in
    `SPARKLE_TINTS` actually appear, and weight the density toward the lamps. Off the LED wall,
    deterministic.
15. `src/postfx.rs` - lift the toe slightly and tint it plum-violet so the ceiling void is a dark
    violet holding a faintly readable truss. Do this after item 1, which changes what the toe sees.
16. `assets/scene.json` - the pegs. Lift `MAT_Peg_Metal` (0.3, 0.31, 0.34) toward chrome and lower its
    roughness so each ball takes one small white specular on its upper left, and make `Wheel_Pegs`
    slot 1 read as a thin bright gold line along the stalk. Re-judge after item 2, which may supply
    the specular on its own.

Fix order matters. Do item 1 alone and re-render: the fused bloom is washing the sector fan, the
pegs, the rim's band stack and the top corners at once, so items 5, 15 and 16 cannot be judged until
it is cut. Then item 2, a single constant that may restore the pillar highlights, the podium ribs and
the peg speculars together. Then items 3 and 4, the two largest areas of the frame. Items 5 onward
are local and can go in any order.

Still not to chase, per `docs/look_target.md`: the wheel sits smaller and higher than in the painting
and its base plate fills most of the `floor` crop. The camera and the base come from the GLB. Judge
the floor on its gloss, its gold column and its crisp inlays.

## Round 4

Shot `renders/r4.png`, crops `renders/crops_r4`, verdict `renders/verdict_r4.json`.
`cargo build --release` was clean and the shot wrote all seven files. `cargo` needed
`export PATH="$HOME/.cargo/bin:$PATH"` first, as `docs/agent_plan.md` correction 4 says.

Judged by eye on the six crop pairs plus five extra pairs cut with `src/bin/crop.rs` into
`renders/x4/`: `crest` at 740,0 220x220, `lower_wheel` at 660,560 380x280, `top_right` at
1100,0 572x340, `low_right` at 1050,600 620x341, `sky_right` at 1252,240 420x400. Three 4x
zooms were cut as well, at frame 900,600, 1500,300 and 40,30, to identify a repeating texture.
No histogram, mean or similarity score was computed.

**Converged: no.**

### What round 3 fixed

- The floor is a lit stage floor now. Its plane reads bright magenta-violet, the gold ring
  inlay arcs are visible across it, the checkerboard stipple in the reflection column is gone,
  and the column under the wheel is warm instead of milky grey-pink. This was round 3's item 3.
- The podium desk band clips to pale gold and is the brightest thing in its crop, which round 2
  and round 3 both asked for and neither got.
- The truss rim light is violet-magenta instead of steel-blue, and the lattice reads as bright
  thin lines on a dark void. Round 3 item 11.
- The toe is lifted and tinted plum. The top corners are a dark violet that still holds the
  truss, not a crushed neutral black. Round 3 item 15.
- The sparkles have two populations now: 1 to 3 px dots plus 6 to 10 px soft blobs, pink and
  white, thinned out and no longer an even starfield. Round 3 item 14.
- `MAT_Sector_Gold` reads amber-gold rather than orange. Round 3 item 5.

### What the frame looks like now

It reads as the right picture. Three things separate it from the reference.

1. **A regular lattice of small soft dashes is woven over the whole bright half of the frame.**
   At 4x on the sector fan every wedge is covered by rows of short horizontal dashes about five
   pixels apart, so cream and gold wedges read as woven fabric rather than flat paint. The same
   lattice turns the halo around the wheel into a brown mesh disc, textures the LED wall left of
   the pillar, bands the base drum, and shows as faint diagonal ribbing even in the near-black
   top-left corner. The dashes' amplitude tracks the brightness underneath them and their
   direction follows the bright feature that seeds them. They sit over wheel geometry as well as
   over the wall, so this is a screen-space pass and not a material. Most likely the bloom blur
   is sampling at a tap stride well above one pixel, which replicates every bright feature as a
   comb of ghosts instead of smearing it - the same class of bug round 3 found in the reflection
   taps. This costs the most because it lands on agent C's rank-1 feature, the sector fan, and on
   the largest surface in the frame at the same time.
2. **The bulb ring is still one fused blown rope inside a wheel-wide halo.** Each bulb is a large
   soft blob fused to its neighbours, the rim behind it is two thin gold lines, and the halo
   washes about 40 px up into the lower sectors and spreads brown haze into the ceiling void. The
   reference rim is a stack about 45 px deep of bright gold bands alternating with hard dark
   warm-brown grooves, with discrete bulbs sunk in the outer channel each carrying a 4 to 8 px
   halo. Third round asking.
3. **The sky wall has the right layout and the wrong colour and value on both sides.** Left: a
   pale baby-pink field with white-grey cotton clouds under a cobalt cap covering the whole top
   of the crop, where the reference has coral, salmon and peach tops over magenta-violet with
   cobalt confined to the upper right. Right: a dark navy band with small pale-lavender clouds,
   plainly darker than the floor, where the reference has big cyan-white and pink lobes on bright
   cobalt and wants the wall second-brightest after the wheel. The lobes have hard edges now,
   which is right; they carry almost no chroma.

### Round 3 asks that did not land

Items 6 (gold hairline between sectors), 7 in part (the desk band landed, the base ring and the
floor inlays' gold did not), 8 (the hub), 10 (crest facets and the hard white spike), 12 (the
flares), 13 (the fascia pinstripe), and item 2's second half again (the pillars are dark but have
no gold highlight). The fascia, the base ring and the inlays are all shared-material asks routed
through `assets/scene.json`; round 3's own note says `MAT_Gold_Trim` is shared by 21 objects, so
they need per-node overrides in `src/scene.rs`. That is where round 5 should put them.

### Crop by crop

- **hub.** The dome is a flat pale lavender-white disc reading as glowing, sunburst only just
  visible, brightening centred and symmetric, no dark quadrant anywhere. The reference dome is
  violet-silver brushed metal with a broad silver-white lobe toward ten o'clock and a lower-right
  quadrant falling to dark plum-grey with its wedges intact. The bezel has the opposite problem:
  a saturated bright gold ring punched through by a circle of near-black rivets, against the
  reference's smooth gold-brown chrome with two thin circumferential highlight lines. Around it
  the wedges are separated by soft white glow rather than the reference's crisp gold hairline,
  the magenta washes toward salmon on its inner half, and the dash lattice covers the fan.
- **rim_top.** The fused rope described above. The pegs read as dark grey balls without a
  specular. The crest is a pale lilac blob with an even wide glow, no facet, no hard spike. The
  top corners are brown-hazed where the reference is near-black violet.
- **floor.** The floor plane and the gold column are much better. What is missing: the pillar
  meets the floor with a hard dark line and casts no reflection, the podium sits on a dark stain
  rather than its own smear, the column reads as stepped horizontal bands instead of a smooth
  vertical smear, and the ring inlays read pale cream-tan rather than gold.
- **screen_left.** Baby-pink field, white clouds, cobalt over the whole top. All three fascia
  bands are broad dark grey-brown ribbons with no bright gold line. The pillar is correctly
  darker than the wall and carries no gold highlight at all, only faint cool flutes.
- **truss.** Close. Violet-magenta lattice on a dark violet void, sparkles in two sizes, ten
  narrow cones in the right places with amber in the top-right corner. Off: cone chroma is thin -
  amber reads pale khaki, cyan reads grey-teal - the lens cores are small white capsules rather
  than round blown discs with a halo one and a half to two diameters wide, the flares are thin
  diagonal pink scratches, and the right of the crop is filled with the wheel's brown mesh haze.
- **podium.** The desk band is right. The body panels read maroon and glossy with vertical pink
  reflections of the wall running down them, where the reference has them near-black and matte
  with a faint diagonal grid. The gold base ring is a faint pale line rather than a second bright
  band, so the black form does not close at the bottom, and the desk band's halo streaks the full
  width of the crop instead of staying 8 to 15 px.

### Checked and found innocent

- The lattice is not a material or a texture. It appears over the sector fan, which is wheel
  geometry in front of the wall, and its amplitude follows screen brightness rather than any
  surface. The 4x zoom at frame 1500,300 shows the dim right-hand wall almost clean while the
  bright left wall and the fan are heavily patterned, which is what a brightness-driven pass
  does.
- The cone geometry is right for the third round: count, half-angle, direction and per-side
  placement all match, with two amber cones in the top-right corner. The cone defect is chroma
  and lens-core shape only.
- The sparkles no longer read as an outdoor starfield; the remaining white dots on the wall's
  blue band are a separate problem, on the wall itself.

### What round 4 asks for, in order

1. `src/postfx.rs` - kill the dash lattice. Bring the bloom tap stride to a pixel or below: more
   taps for the same spread, or blur at the downsampled resolution and upsample bilinearly, or
   jitter the taps deterministically. Judge on a 4x zoom of frame 900,600 - a cream wedge must
   read as flat cream and the halo around the rim must be a smooth gradient. Do this alone and
   re-render; it is over the sector fan, the wall and the void at once, so nothing local can be
   judged under it.
2. `src/postfx.rs` - un-fuse the bulb ring for real. Cut the wide bloom contribution further and
   lower the bulb emission until each bulb is a separate dash with its own small halo and the
   rim's bright bands and dark grooves read individually on the `lower_wheel` pair. No warm veil
   may reach the sectors and no brown haze may reach the top corners.
3. `src/postfx.rs` - the floor. Widen the reflection's object search so both pillars and the
   podium are included, keep the reflection's own warm hue, and make the column a smooth vertical
   smear.
4. `src/screen.rs` - the wall. Slide the sampled window down on both sides so the coral and peach
   tops land in the visible band, raise the right side's gain until the right wall is at least as
   bright as the left and second-brightest in the frame after the wheel, and keep the sampled
   chroma instead of desaturating the clouds toward white. Drop the stars from the blue band.
5. `src/scene.rs` - the hub. Make the dome's bright lobe directional toward ten o'clock, let the
   lower-right quadrant fall to dark plum-grey with its wedges intact, deepen the sunburst
   contrast, pull the bezel down to gold-brown with two thin circumferential highlight lines, and
   lift the rivets toward the bezel.
6. `src/scene.rs` - per-node golds, all three at once, since the shared `MAT_Gold_Trim` is why
   they keep failing: the hairline on `Wheel_Spokes`, the base ring on `Podium_Trim`, the arcs on
   `Floor_Rings`, and the pinstripe on `Wall_Fascia`'s gold slot with `MAT_Gold_Dark` staying dark
   above and below it.
7. `src/lighting.rs` - the pillar highlight. Raise the rim gain or widen the violet-magenta
   environment band so each pillar's front-inner face takes one bright warm vertical stripe just
   right of its centre and a thinner cool one at its left edge, with near-black between them, and
   without lifting the pillar's dark side.
8. `src/scene.rs` - the crest. Cut its emission until the facets and the outline read inside a 25
   to 40 px halo, keep the magenta in the core rather than the shell, and draw the spike as a hard
   4 to 6 px white line inside a 12 to 20 px magenta halo.
9. `assets/scene.json` - the podium panels. Raise their roughness and drop their albedo until they
   are near-black against the trim and stop mirroring the pink wall.
10. `src/postfx.rs` - the cones. Cut per-cone strength and put the loss into the tint's chroma so
    the amber reads amber at its brightest third, and give the lens cores a round blown profile
    with a halo one and a half to two diameters wide.
11. `src/postfx.rs` - the flares. Make the axis horizontal and the profile soft, long axis 40 to
    60 px, short axis three to five times narrower, and raise the threshold so the podium desk
    band keeps a tight halo instead of streaking the full crop width.
12. `src/postfx.rs` - fade every additive quad to zero at its boundary. A vertical straight edge
    at about frame x 1525 and a horizontal one meeting it draw a faint rectangle in the ceiling
    void, and nothing in the reference void is rectangular.

Fix order matters. Item 1 first and alone: the lattice is on the sector fan, the wall and the void
simultaneously, and items 5, 6 and 9 cannot be judged under it. Then item 2, which is washing the
rim's band stack and the lower sectors. Then 3 and 4, the two largest areas. Items 5 onward are
local.

Still not to chase: the wheel's scale and position, and the base plate filling the `floor` crop.
Both come from the GLB.

## Round 5

Shot `renders/r5.png`, crops `renders/crops_r5`, verdict `renders/verdict_r5.json`.
`cargo build --release` was clean and the shot wrote all seven files. `cargo` needed
`export PATH="$HOME/.cargo/bin:$PATH"` first, as `docs/agent_plan.md` correction 4 says.

Judged by eye on the six crop pairs plus nine extra pairs cut with `src/bin/crop.rs` into
`renders/j5/`: `crest` at 740,0 220x220, `fan` at 880,250 180x180, `lowright` at 1050,600
620x341, `skyright` at 1252,240 420x400, `base` at 600,720 480x221, `void` at 1250,0 400x200,
`band` at 200,690 300x70, `dome` at 760,340 180x180, `col` at 560,850 560x91. The dome pair and
the band pair were also read at 2x and 3x. No histogram, mean or similarity score was computed.

**Converged: no.** This was the last of the five rounds, so the list below is a handover rather
than an ask for a sixth pass.

### What round 4 fixed

- **The dash lattice is gone.** This was round 4's item 1 and its biggest complaint. At 2x on
  `renders/j5/fan.png` every wedge is flat paint, the halo round the rim is a smooth gradient, and
  neither the wall nor the near-black corners carry any ribbing. Closed.
- **The bulb ring is un-fused.** 96 discrete warm dashes sit in the outer channel, each with its own
  tight halo. No warm veil reaches the sectors and no brown haze reaches the top corners. Round 4
  item 2, and the fourth round it was asked for.
- **The brown mesh haze is off the ceiling void** and off the right of the truss crop.
- **No additive quad draws a rectangle in the void.** Round 4 item 12.

### What the frame looks like now

It reads as the right picture, and the remaining gap is value and chroma rather than structure.
Three large areas are dead or wrong, and one systemic fault lands on five features at once.

1. **The strip under the wheel is dead.** `renders/j5/col.png` at frame 560,850 is a flat near-black
   navy slab over a 20 px band of dull grey-mauve. `renders/j5/ref_col.png` at the same rectangle is
   a bright warm gold-and-magenta glossy floor with vertical light streaks running its full height.
   There is no gold column under the wheel anywhere in the frame. The reflection pass itself is
   working - the podium takes a smear on the left of the floor crop - but at the wheel it has nothing
   bright to mirror, because `Wheel_BasePlate`'s slot 0 is `MAT_Dark_Trim` and renders as one flat
   black with no gradient across it. `docs/look_target.md` region 3 calls that face "a dark chrome",
   which is a chrome with a gradient. This costs the most: it is agent C's rank-2 feature and it is
   the whole lower centre of the frame.
2. **The hub dome is a near-black disc.** At 2x, `renders/j5/dome2x.png` against
   `renders/j5/ref_dome2x.png`: the render's brightest point on the dome is a mid grey-lavender near
   the centre and its lower half falls to near-black, so the dome reads as a hole punched in the
   middle of the wheel. The reference dome is a mid-to-high violet-silver across its whole area with
   a broad silver-white lobe out to ten o'clock. Round 4 overshot: `HUB_TINT` was cut from 1.10 to
   0.62 and walked back only to 0.98 while `HUB_LOBE_GAIN` widened to a ratio of 25, so the extra
   contrast was bought by putting most of the disc's area near zero. `docs/look_target.md` region 1:
   "nothing in this crop goes to black". Round 4 asked for a dark quadrant and got a dark dome.
3. **The wall has the wrong hue on both sides and no cloud structure on the right.** Left: a flat
   high-chroma magenta-pink field with soft white and lilac puffs, near-uniform in value across the
   lower two thirds of `screen_left`, with no cobalt, coral, salmon or peach anywhere. Right
   (`renders/j5/skyright.png`): the upper band is flat electric indigo with no cloud at all beyond a
   few pale specks - the stars round 4 asked to be dropped - and the lower band is violet-magenta with
   soft white blobs. The reference has coral and peach cauliflower tops over violet with cobalt through
   the upper middle on the left, and big cyan-white and pink lobes over bright cobalt on the right. The
   lobe edges are hard now, which round 4 fixed; what is missing is the value range of a sunset.
4. **Every lifted gold reads as a matte olive-khaki ribbon.** The podium desk band is a pale
   khaki-cream strip rather than a blown lemon; the podium's ribs and base ring are the same dull tan
   with no highlight line; the two wall bands in `screen_left` are broad khaki-mustard ribbons about
   30 px deep with no bright core and no dark groove beside them; the floor inlays are pale cream-tan;
   the base plate's top edge is a dull khaki line. The reference draws every one of these as a thin
   saturated gold line with a hard dark band above and below. The uniform emissive in `NODE_LIFTS` is
   doing all the work and it has no gradient across a band's width, so a 25 px band gets one flat
   value; and its chroma is too shallow, so `Wall_Band_Mid` at `(0.96, 0.60, 0.17)` and `Podium_Top`
   at `(1.85, 1.10, 0.22)` both arrive closer to olive than to gold.

### Crop by crop

- **hub.** Dome near-black, as above. The sunburst has about eighteen thin hard spokes where the
  reference has about ten broad soft wedges, because `HUB_WEDGES` is 9.0 and nine cycles of a sinusoid
  draw eighteen bands. The bezel is a saturated brassy gold ring punched through by a full circle of
  near-black rivets; the reference bezel is warm violet-chrome with two thin continuous circumferential
  highlight lines and no rivet circle visible at all. Fifth round asking on the rivets. The wedges abut
  with only a faint dark seam where the reference draws a thin gold hairline down every boundary.
- **rim_top.** The bulbs are right. The rim is a thin gold hoop about 25 px deep where the reference is
  a stack about 45 px deep - dark groove, gold band, hard dark line, gold band, silver chrome band -
  with a hard boundary at every step. Dropping `Wheel_Rim`'s albedo to `(0.68, 0.40, 0.125)` un-fused
  the bulbs, which was the right trade, but it took the bevel contrast down with it. The pegs are flat
  dull grey balls with no specular. The crest is a soft pale-lilac mushroom with an even glow, no facet,
  no bevel and no hard white spike, and the flapper below it is a soft magenta stripe with no edges that
  runs past the rim into the fan.
- **floor.** As item 1. The base plate's front face is one uniform black, the floor to its right is flat
  matte grey-lavender, and neither pillar nor the podium puts a warm streak on it. The gold ring inlays
  are crisp across the left and centre and the vertical blur does not touch them, which is right; their
  hue is pale cream-tan, which is not.
- **screen_left.** As item 3, plus the two fascia bands as item 4 describes them. The pillar is a
  near-black cylinder with faint cool flutes and one thin magenta streak near its base, and it carries no
  gold highlight at all. Fourth round asking. Because it is black it also casts no reflection: in
  `renders/j5/lowright.png` it meets the floor on a hard dark line with nothing below it, where the
  reference runs a bright warm column down from the pillar's base.
- **truss.** The lattice reads as bright thin lines on a dark void, which is right, and the cones are in
  the right places with amber in the top-right corner. Off: the void carries about six faint specks
  against the reference's dozens, so round 4's thinning overshot; the void's black is brown rather than
  plum; the flares are thin hard diagonal pink scratches instead of soft horizontal streaks; the cones
  are flat translucent triangles with straight hard edges and thin chroma, amber reading pale khaki at
  its brightest third; the lens cores are small white capsules rather than round blown discs inside a
  halo one and a half to two diameters wide; and the right-hand tubes' rim highlights read cool
  steel-blue-white where the reference has violet-brown.
- **podium.** The desk band, the ribs and the base ring all read khaki, as item 4 describes. The body
  panels still mirror the wall as three broad vertical pink streaks and read glossy dark navy rather than
  near-black matte with a faint diagonal grid. Round 4 item 9.

### Round 4 asks that did not land

Item 3 (no reflection under the pillars, the podium or the base plate), item 4 (neither side of the wall
got its coral or its cyan, and the stars are still on the blue band), item 5 in the wrong direction (the
dome went from too bright to near-black, the rivets are unchanged), item 6 as look though not as geometry
(the per-node golds exist and every one reads khaki), item 7 (the pillar highlight, fourth asking), item 8
(the crest), item 9 (the podium panels), item 10 (cone chroma and lens cores), item 11 (the flares).

### What round 5 asks for, in order

1. `src/scene.rs` - add a `NodeLift` for `Wheel_BasePlate`'s `MAT_Dark_Trim` slot: metallic toward 0.7,
   roughness toward 0.15, a warm violet-tinted albedo, so the plate's front face reads as a dark chrome
   slab that catches the bulb ring and the blown gold edge above it and falls off downward. The
   reflection then has a warm gradient to mirror. Judge on `renders/j5/col.png` against
   `renders/j5/ref_col.png`: the strip must carry a warm vertical smear, not one flat value.
2. `src/scene.rs` - raise `HUB_TINT` until the dome's mid tone is a violet-silver rather than a
   plum-grey, and narrow `HUB_LOBE_GAIN`'s ratio back to about 4 to 6 at the same time so the extra
   level does not clip the lobe. The dark quadrant must be a dark plum-grey with its wedges readable,
   not near-black.
3. `src/screen.rs` - widen the wall's value range rather than its gain. Deep violet-blue in the cloud
   undersides and coral to peach in the tops on the left; cyan-white tops over cobalt on the right;
   posterised flat steps inside hard-edged lobes on both. Slide the right side's window until it holds
   cloud, and drop the specks from the blue band.
4. `src/scene.rs` - cut the emissive on `Wall_Band_Mid`, `Wall_Band_Up`, `Podium_Trim` and `Floor_Rings`
   to roughly half and let the specular draw the bright line, so each band has a value ramp across its
   width. Deepen the chroma of what is left - hold red, drop green and blue further - so the flat part
   reads gold rather than khaki. Keep `Podium_Top` over the bloom threshold but give it enough
   red-over-blue that it clips to a lemon rather than a cream.
5. `src/scene.rs` - the crest. Cut its emission until the facets and bevels read inside a 25 to 40 px
   halo, keep the magenta in the core and let the shell go violet-white, draw the spike as a hard 4 to
   6 px white line inside a 12 to 20 px magenta halo, and stop the flapper's glow at the rim's outer band.
6. `src/lighting.rs` - the pillar highlight, fourth asking. Raise the rim gain or widen the warm side of
   the environment band until each pillar takes one bright warm vertical stripe just right of its centre
   and a thinner cool one at its left edge, with near-black between them, and without lifting the dark
   side. Then check that the reflection appears under both pillars.
7. `src/scene.rs` - the rim's band stack. Bring the bevel contrast back without raising the rim's mean:
   lower the roughness so each band's bevel keeps a narrow highlight and the grooves stay dark, or split
   the slots so the groove carries `MAT_Gold_Dark`'s value. Drop the pegs' metallic toward 0.6 and their
   roughness toward 0.10 so each ball takes one small hard specular.
8. `src/scene.rs` - halve `HUB_WEDGES` to about 5 so ten alternating bands read, soften the wedge profile
   into gradients, bring the bezel from brassy toward gold-brown chrome, and raise the rivets' radiance
   until each reads as a variation in the bezel rather than a dark dot.
9. `src/postfx.rs` - raise the sparkle count back until the upper half of the frame carries a visible
   dust of both populations, put a violet tint in the void's toe so the black is plum rather than brown,
   pin the flare axis horizontal, soften its profile and set its long axis to 40 to 60 px.
10. `src/postfx.rs` - cut per-cone strength and put the loss into the tint's chroma so amber reads amber
    where it is brightest, soften the cone's radial falloff, and give each lens core a round blown profile
    inside a halo one and a half to two diameters wide.
11. `src/lighting.rs` - warm the right-hand environment band or raise `Rim_R`'s reach on the truss until
    the right-hand tubes' rim highlights read violet-brown rather than steel-blue.
12. `src/scene.rs` - raise `Wheel_Spokes`' radiance again and deepen its chroma at the same time, so the
    hairline is gold and darker than a cream sector yet clearly brighter than a magenta or cobalt one.
13. `assets/scene.json` - raise the podium panels' roughness and drop their albedo until they are
    near-black against the trim and no vertical wall reflection survives.

Items 1 and 2 first: they are the two largest dead areas, both are single-node entries, and both change
the frame's whole tonal range. Then 3, half the frame's area. Then 4, which lands on five features at
once. Items 5 onward are local.

### Still not to chase

The wheel's scale and position, the podium's position, and the base plate's height in the floor crop, all
of which come from the GLB. The reference's podium sits about 40 px higher in the frame than the render's,
so `renders/j5/band.png` and its reference twin do not line up; judge the podium structurally rather than
pixel for pixel. The truss lattice's density: the reference is an illustration with a deeper rig than
`60_Rig` holds, and the rim-lit-silhouette reading `docs/look_target.md` asks for is already correct. The
proportion of magenta to cream in the sector fan, which is material assignment in the GLB.
