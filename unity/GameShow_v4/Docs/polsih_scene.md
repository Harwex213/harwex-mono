# Polishing SampleScene to match `studio_ref_v2.png`

Reference: `Assets/Art/Ref/studio_ref_v2.png`.
Scene under review: `Assets/Scenes/SampleScene.unity`, read live from the running editor.

Every number below is measured, either from the two images or from the scene itself.

---

## 1. The measured gap

These four numbers describe the whole problem. The scene is over-exposed, and at the same time it has no darkness.

1. The current frame is about 0.9 stops brighter than the reference: median pixel 0.102 against 0.055.
2. The current frame clips 2.26% of its pixels to white; the reference clips 0.30%.
3. On the wheel face alone the current frame clips 22.5% of pixels; the reference clips 0.95%.
4. The reference is genuinely black across 20.9% of its area; the current frame is black across only 3.1%.

The conclusion is not "make it darker". The bright parts are too bright *and* the dark parts are too bright, so the whole tonal range is compressed into the middle. Fixing the exposure alone would produce a grey scene. Light falloff has to come back first, then exposure.

---

## 2. The floor has no falloff — the single biggest difference

The reference floor is a pool of light. The current floor is an evenly lit brown plane. Sampling brightness across the bottom edge of each image proves it:

- Reference: `0.205, 0.052, 0.050, 0.096, 0.204, 0.085, 0.048, 0.037, 0.034` — a 6:1 ratio between the centre pool and the far edges.
- Current: `0.135, 0.142, 0.159, 0.168, 0.178, 0.157, 0.152, 0.149, 0.136` — a 1.3:1 ratio, which is flat.

The cause is a single light.

1. `SL_FloorSoft` is a baked Rectangle (area) light, 3.6 m above the floor centre, aimed straight down, intensity 1.2, range 7.
2. An area light of that size at that height deposits near-uniform light over the whole 16 m floor, which is exactly the flat result.
3. Drop its intensity to about 0.3, or disable it entirely, and let `SL_PodiumHalo` (Point, intensity 26, range 4.5, at the podium) create the pool on its own.
4. Verify after each change that the bottom-edge ratio moves toward 4:1 or better, because this ratio is the honest test of the fix.

---

## 3. Lighting defects on the set

Each item here is independent of the others.

1. The four `SL_Graze_Pil_*` spots run at intensity 32 with a 64° cone, which paints a blown yellow blob on each pilaster instead of the reference's thin vertical flute gradient.
2. Those four spots are set to **Realtime**, so they punch a live blob over the baked pilaster gradient rather than blending into it; set them to **Baked** and re-bake.
3. Narrow their cone from 64° to roughly 30° and cut intensity to about 10, so the light hugs the flutes the way the reference does.
4. `SL_Key_WheelL` and `SL_Key_WheelR` sit at intensity 7 and cause the 22.5% clipping on the wheel face; about 4 is the right starting point.
5. `SL_Fill_Wheel` sits at intensity 0.6, which is almost nothing, so the wheel has a harsh key-to-fill contrast; about 1.2 restores the reference's softer front modelling.
6. Nothing in the current frame casts a shadow onto the floor, but the reference shows a clear soft shadow of the wheel stretching toward the camera.
7. That shadow is missing because `SL_PodiumHalo` has `Shadows = None`, and because the two wheel keys sit at z = +1.3 in front of the wheel, so any shadow they cast falls away from the camera.
8. Add one shadow-casting spot high and behind the wheel (positive z is in front, so place it at negative z), or move a key behind the wheel, to throw the shadow toward the lens.
9. `shadowNormalBias` is 0.5 in `PC_RPAsset` and 0.4 on every light, which pushes shadows away from the surfaces that cast them and erases contact darkening; about 0.15 is a better value here.
10. The scene has no Directional light, which is correct — the reference is a windowless studio and needs none.

---

## 4. Baked GI quality

The bake is running at settings too coarse for a set whose whole look is smooth light gradients on walls.

1. `GI_Studio.lighting` sets `Indirect Output Scale` to 0.45, which halves every bounce and starves the arch recesses of the warm fill the reference shows; raise it to 1.0.
2. Bake resolution is 20 texels per unit, which is too coarse for long smooth gradients across a 16 m wall; 40 is a reasonable target.
3. The scene baked into two atlases, and the second one came out at only **512 × 512** while the first is 2048 × 2048.
4. `SM_Studio_FeatureWalls` — the entire pilaster and flute wall — is the object living in that 512 atlas, which is why its light reads as coarse mush.
5. Raise `Max Lightmap Size` to 4096, or lower `Scale In Lightmap` on `SM_Studio_Pilasters` (currently 2.5) and `SM_Studio_Wall` (currently 2.0), so everything fits one high-resolution atlas.
6. The wheel, the dice case and the slot cabinet are all non-static and contribute nothing to GI, so they neither receive bounce light nor bake a contact shadow.
7. Marking the wheel's podium disc as `Contribute GI` would bake a proper contact shadow under it, since the podium never moves even though the wheel spins.

---

## 5. Material defects

### 5.1 The floor

1. `ST_Floor` has `_BumpScale` set to **10**, ten times the normal value, which shatters the specular highlight into noise and is why a smoothness-1 floor reads as flat matte.
2. Set `_BumpScale` back to 1.0; this is a one-field change and the most visible material fix available.
3. `ST_Floor` reads smoothness from the base map's alpha channel, whose mean is 0.66, so the real surface smoothness is about 0.66 rather than the 1.0 shown on the slider.
4. The reflection probe `SL_RoomProbe` is only **256 px**, so even a corrected floor can only reflect a blurry environment; 512 px or 1024 px would let the floor show the soft sheen the reference has.

### 5.2 The gold

1. `ST_Gold` takes metallic and smoothness from `T_Studio_Gold_MG`, whose red channel is 1.0 everywhere and whose alpha spans only 0.718 to 0.843.
2. Both channels are therefore effectively flat, so every gold surface in the set has identical roughness and no highlight variation, while the reference gold shows streaks and breaks.
3. Adding variation to that alpha channel — brushed streaks, subtle wear — would give the gold the reference's read.
4. A metal is only as bright as what it reflects, so the dull olive-brown gold in the current frame is mostly a symptom of the 256 px probe and the dark room, not of the albedo.
5. `T_Studio_Gold_BC` averages `(0.77, 0.59, 0.27)` in sRGB, which is quite orange; a paler, more yellow gold would sit closer to the reference.

### 5.3 The quilted arch insets

1. `T_Studio_Quilt_BC` peaks at 7.5% grey and averages 6%, so the quilt is effectively pure black and the diamond pattern is invisible in the current frame.
2. The reference reads its quilt pattern through specular sheen and normal detail, not through albedo, so the fix is more sheen rather than more brightness.
3. Raise `ST_Quilt` smoothness from 0.45 to about 0.65, so a grazing highlight picks out each diamond.
4. Lift the quilt albedo slightly, to roughly 12% grey, so the pattern has something to catch light on.
5. Both quilt maps are only **256 × 256** while the wall they cover is 12 m wide, so the diamonds blur out entirely at that scale; re-author them at 1024.

### 5.4 Emissive surfaces are clipping

1. `CT_Bulb` emits `(4.2, 3.7, 2.6)`, which drives the flapper's bulb triangle to solid clipped white with visible aliasing; about 1.8 keeps it warm and readable.
2. `SL_PodiumBand_Gold` emits `(6.0, 4.8, 2.6)`, which renders the podium LED band as a flat white stroke instead of the reference's warm amber ring; about 2.8 is closer.
3. `Bloom` has `Clamp` set to 12, which lets those very hot pixels smear widely; about 4 keeps the glow tight like the reference.
4. `CT_Studs` on the wheel rim uses the non-emissive `CT_GoldMetal`, but the reference rim carries a ring of *lit* bulbs — this is the clearest single reason the wheel rim reads dull.
5. Give the rim studs their own emissive material at a low value, roughly `(1.2, 1.0, 0.7)`, so they read as pin lights rather than metal dots.

---

## 6. A geometry defect that reads as an artifact

1. `SM_Studio_Floor` has a second submesh assigned to `ST_Gold`: a 2048-triangle ring, 14.96 m across, lying 1 cm above the floor at y = +0.01.
2. That ring is the hard orange arc visible in the upper-left of the current floor, and it reads as a stray wireframe line rather than as decoration.
3. The reference floor carries no inlay at all, so this submesh should be hidden or given a very dark material.
4. Every `StudioSet` child is rotated 270.31° on Y, which is 0.31° off from square, and `Main Camera` carries a 0.05° roll — both are cosmetic but worth zeroing.

---

## 7. Camera framing

The reference shows the acrylic dice case at the left edge and the Golden Luck cabinet at the right edge. The current camera excludes both.

1. `BonusDice` projects to viewport x = **−0.38**, which is well off the left edge of the frame.
2. `GoldenLuck_SlotMachine` projects to viewport x = **0.97**, right on the right edge and effectively cropped away.
3. The camera sits at `(0, 2.07, 4.74)` with a 40° vertical field of view, which gives `depth × tan(hfov/2) = 2.46` at the dice case.
4. Bringing the dice case just inside the frame needs that product to reach about 4.77, so the framing has to widen by roughly a factor of two.
5. Field of view alone cannot do it: holding the camera still would need a 103° horizontal field of view, which would distort the set badly.
6. Pulling back alone cannot do it either: at 40° the camera would have to retreat to z ≈ 8.4, which is inside the back wall.
7. The workable combination is a camera at about z = 6.6 with a 50° vertical field of view, which puts both props at the frame edges the way the reference does.
8. Moving the two props inward and slightly toward the camera is the alternative, and it matches the reference more closely, where the dice case reads as a large foreground element cut off by the left edge.

---

## 8. Post-processing grade

The current grade fights the lighting instead of shaping it. Fix the lighting first, then revisit this section, because most of these values only make sense once the falloff is back.

1. `ColorAdjustments.saturation` is **+14**, which cannot recover colour on the 22% of wheel pixels that are already clipped to white — it only pushes more pixels into clipping.
2. Once exposure comes down, drop saturation to roughly +6, and judge the wheel colours again.
3. `ColorAdjustments.postExposure` is 0; about −0.5 gets the midtones toward the reference once the lights themselves have been reduced.
4. The profile has no `LiftGammaGain` and no `ShadowsMidtonesHighlights`, so nothing is crushing the blacks, which is why only 3.1% of the frame is truly black.
5. Add `Lift` with a slightly negative value, roughly `(-0.02, -0.02, -0.02)`, to pull the shadows down to the reference's 20% black area.
6. `Tonemapping` is set to `Neutral`, which clips highlights fairly hard; the reference's top 1% of pixels stops at 0.745, which is the signature of a filmic shoulder, so `ACES` is worth testing.
7. Switching to ACES will shift the whole grade darker and less saturated, so treat it as a decision point rather than a drop-in change.
8. `Vignette.intensity` is 0.2 and the current corners measure only 1.2–1.4× brighter than the reference's, so the vignette is a minor lever here and not the fix for the flat floor.

---

## 9. Renderer settings

1. `PC_Renderer` runs in **Forward+**, so the `Max Additional Lights = 4` setting in `PC_RPAsset` does not apply and all 19 lights reach every surface — this is already correct and needs no change.
2. MSAA is set to 2 and Forward+ supports it, but the flapper bulbs still show visible stair-stepping, so 4 would help.
3. SSAO runs at `Radius = 0.3` and `Intensity = 0.4`, which is a small radius for a room with deep 4 m arch recesses.
4. Raise the SSAO radius to about 0.8 and the intensity to about 0.7, so the arches and the wall-floor junction darken the way the reference's do.
5. `SL_RoomProbe` is set to `Custom` mode but also to `Refresh Mode = Every Frame`, which is a contradictory pair; set refresh to `On Awake`.

---

## 10. Suggested order of work

This group *is* ordered — each step changes what the next one should measure.

- First fix `ST_Floor._BumpScale` from 10 to 1, because it is one field and it immediately restores the floor's sheen.
- Then cut `SL_FloorSoft` to about 0.3 and re-measure the bottom-edge falloff ratio, targeting 4:1 or better.
- Then set the four `SL_Graze_Pil_*` lights to Baked, narrow them to 30°, and cut them to about 10.
- Then raise `Indirect Output Scale` to 1.0, raise bake resolution to 40, raise max lightmap size to 4096, and bake — the bake is slow, so batch every lighting change before running it.
- After the bake, pull the emissive values down (`CT_Bulb` to 1.8, `SL_PodiumBand_Gold` to 2.8) and set bloom clamp to 4, then check that total clipping has fallen below 1%.
- Then hide the gold floor inlay submesh and add the emissive rim studs.
- Then move the camera to about z = 6.6 at 50° field of view, and confirm both side props sit at the frame edges.
- Only then touch the grade: exposure −0.5, saturation +6, and a slight negative lift.
- Finally raise the reflection probe to 512 px and re-bake it, because the metals only settle once everything else is lit correctly.

---

## Appendix: how to check progress, and a warning about metrics

The numbers in this document diagnose the current gap. They must **not** become the acceptance test for the polish work.

This exact mistake has already cost this project once. In a previous look-dev loop on the prize-wheel scene, an agent scored rounds by clipped-pixel share, black level and histogram agreement with the reference. The scores improved while the image visibly got worse: blown wheel sectors, a moiré hub, striped brass. Cheap scalar metrics get optimised against, and the qualities they cannot see are the ones that carry the picture.

So use the numbers only as a coarse sanity check, in this order of authority:

- The deciding test is always region crops, placed side by side with the reference crop at the same on-screen size — the wheel face, the pilaster flutes, the podium and floor, the arch inset.
- Check saturation and hue per region explicitly, because those are what collapsed last time and no brightness metric will catch it.
- Check for texture aliasing and moiré on the rim studs, the hub sunburst and the quilt, because sharpening the specular response is what provokes them.
- Treat the two brightness numbers — clipping under about 1%, and a floor falloff ratio above about 4:1 — as a signal that something is roughly wrong, never as a target to hit.
- Keep every intermediate render, so a version can be pointed at and returned to.
