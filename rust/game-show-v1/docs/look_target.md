# Look target — decomposition of `docs/wheel_stage.png`

This file describes what the renderer must produce. Agent C wrote it by looking at the
reference image and at six crops of it. No histogram, mean, or other summary statistic was
computed, by instruction: this scene has been degraded before by tuning to numbers.

Every look-dev round compares a rendered crop against the matching reference crop in
`renders/ref_crops/`. Those files are:

| File | Region in the frame |
| --- | --- |
| `renders/ref_crops/hub.png` | x 700, y 300, 300x300 |
| `renders/ref_crops/rim_top.png` | x 620, y 110, 460x210 |
| `renders/ref_crops/floor.png` | x 420, y 760, 620x180 |
| `renders/ref_crops/screen_left.png` | x 0, y 240, 420x400 |
| `renders/ref_crops/truss.png` | x 150, y 0, 500x260 |
| `renders/ref_crops/podium.png` | x 130, y 600, 390x300 |

Positions below are given in frame pixels when they refer to the whole image, and in crop
pixels when they refer to one crop. Crop pixels count from the crop's own top-left corner.

## The reference is a painting, not a Blender render

The image is painted or generated, not rendered from `wheel_stage.blend`. Three things in
it cannot come from the scene data in `docs/agent_plan.md`:

- The light table gives both spots the same violet colour `(0.72, 0.36, 1)`. The reference
  shows two warm amber-gold cones in the upper right. The amber has no source in the scene.
- The reference has about ten visible beam cones, one per moving head. The scene has two
  spot lights. The cones must be additive geometry in `postfx`, coloured per fixture, not
  a by-product of the two spots.
- The reference is dusted with sparkles and carries horizontal anamorphic flare streaks.
  Neither exists in the scene. Both belong to `postfx`.

Treat the reference as the target and the scene data as the source of geometry and material.
Where they disagree on light colour, the reference wins, because the reference is what the
render is judged against.

## Region 1 — `hub`

**Hues.** A cool violet-silver dome inside a warm gold-brown chrome bezel, surrounded by
saturated wedges: magenta, cream, cobalt, cyan, amber, white, violet.

**Brightest pixels.** A broad soft silver-white lobe on the dome, running from the dome
centre out toward ten o'clock, roughly crop (95-150, 95-145). A narrower bright wedge runs
toward two o'clock. The outer bezel is brightest along its upper-left arc. The cream and
white sectors read near-white in the crop's upper-left corner.

**Glow.** Almost none. Each sector carries a thin bright hairline down its length, and that
hairline has a halo only 1 to 3 px wide. The bloom must not wash the hub. A hub that glows
is wrong.

**Lit versus shadowed metal.** The dome's lit lobe reads near-white. The dome's lower-right
quadrant reads as a dark plum-grey and still shows its brushed wedges. Nothing in this crop
goes to black. The contrast is wide but the shadow keeps detail.

**Reflection shape and opacity.** The dome shows no reflected object. It shows an
anisotropic radial sunburst: eight to ten alternating light and dark wedges converging on
the centre, plus one concentric groove circle at about 55% of the dome radius. A faint warm
tint sits around the dome's lower edge, bounced off the gold bezel. The bezel itself carries
two thin continuous highlight lines running around its circumference and a dark blurred band
between them. All of this reads as tinting, not as a mirror.

## Region 2 — `rim_top`

**Hues.** Warm gold on the rim bands. Magenta, cream, cobalt, cyan, amber, violet on the
sectors. A magenta-violet crystal at top centre. Near-black violet sky in the top corners.

**Brightest pixels.** Three kinds, in order.
1. The crystal core at about frame (838, 120), a white-pink chevron, with a vertical white
   spike running up out of the frame.
2. Two elongated specular streaks on the top gold band, near frame x 700 and frame x 1000,
   where the band turns toward the beams.
3. The chrome peg balls, each with one small white specular on its upper-left, and the bulb
   dashes sunk in the outer gold channel.

**Glow.** Three widths, and getting all three right matters.
- The crystal has the widest glow in the frame: a soft magenta halo about 25 to 40 px in
  radius. Its white spike is a hard core 4 to 6 px wide wrapped in a magenta halo 12 to 20 px
  wide.
- The bulb dashes have a small warm halo, 4 to 8 px.
- The peg speculars have almost no halo, 1 to 2 px.

**Lit versus shadowed metal.** The rim is a stack of concentric bands. Each band alternates
bright gold against a dark warm brown groove, and the boundary between them is a hard line,
not a soft gradient. The inner chrome band reads bright silver where it faces up and left.
The apex of the rim reads slightly cooler and dimmer than the rim at ten o'clock and two
o'clock.

**Reflection shape and opacity.** The polished bands mirror a dark blurred smear of the
ceiling void, and they pick up pink from the screen along the rim's upper left. Opacity is
moderate. The gold base colour still shows through everywhere, so the reflection tints the
metal rather than replacing it.

**Structure to preserve.** The pegs sit on short gold stalks that point radially outward
from the sector ends, and each stalk carries a thin bright line. The bulbs are separate
geometry sunk in the outer rim channel. Pegs and bulbs must not be conflated.

## Region 3 — `floor`

**Hues.** A magenta-violet floor cut by warm gold streaks. The wheel base plate is a very
dark chrome slab with a blown-out gold top edge. A cyan-teal patch sits at the crop's left
edge.

**Brightest pixels.** A horizontal blown-out gold band along the top edge of the base plate,
crop y 70 to 95. A white-pink hot spot at the base centre, about frame (850, 835), is the
brightest single point in the crop. A warm gold reflection column runs down from it, crop
x 290 to 420, and reaches the crop's bottom edge.

**Glow.** Broad and soft. The gold band's glow spreads 20 to 35 px vertically and blurs into
the floor. After the crystal, this is the widest glow in the frame.

**Lit versus shadowed metal.** The base plate's front face is a dark chrome that reads almost
black-violet directly under the blown gold edge. That edge is hard and the contrast across it
is the highest in the crop. The legs behind the plate are dark, and each shows one narrow
bright gold highlight on its leading edge.

**Reflection shape and opacity.** This region is about the reflection, so it is the one to
get right first.
- Reflections are stretched vertically and heavily blurred. The floor is glossy, not
  mirror-sharp.
- No inverted geometry is recognisable. The wheel's shape cannot be read in its reflection.
  Only a vertical column of gold is visible where the wheel is, and vertical magenta streaks
  where the beam pools are.
- Opacity is high at the contact line, where the reflection nearly matches the object's own
  brightness. It falls off over roughly 60 to 110 px. Faint streaks then continue to the
  frame's bottom edge.
- Two or three thin bright gold arcs cross the floor. Those are the `Floor_Rings` inlays.
  They stay crisp and the vertical blur does not touch them. Crisp inlays over a blurred
  reflection is the signature of this region.

## Region 4 — `screen_left`

**Hues.** A painted sunset. Cobalt and royal blue at the upper right. Magenta-violet through
the middle. Coral, salmon, and peach cloud tops at the left.

**Brightest pixels.** The cloud tops at the crop's left, roughly crop (60-260, 60-140), which
read cream-peach and approach white. A thin hot white streak crosses the middle-left at about
crop (250-380, 330-360). A violet beam pool spills in from the crop's upper-right corner.

**Glow.** The bright cloud cores carry a soft halo 10 to 20 px wide. The beam pool in the
corner is a broad soft wedge with no hard edge anywhere.

**Cloud shape.** The clouds are painterly. Their lobes are hard-edged cauliflower shapes and
their interiors are flat colour steps. They are not soft photographic gradients. A sky shader
that produces smooth fractal noise will read wrong here even at the right colour. Aim for
banded, posterised lobes.

**Lit versus shadowed metal.** Two gold fascia bands cross the crop, one near the top and one
near the bottom, each a gentle arc sloping down to the left. Each is one thin bright gold line
with a dark band above it and below it, so the fascia reads as a high-contrast pinstripe. The
pillar is a dark violet-brown chrome cylinder. It carries one strong vertical gold highlight
just right of its centre and a thinner cooler highlight at its left edge. Its dark side is
darker than the screen behind it, so the pillar reads as a silhouette drawn with two bright
stripes.

**Reflection shape and opacity.** The screen is matte and shows no reflection at all. The
pillar shows a weak vertically stretched blur of the screen's colour, and the pillar's
highlights carry the sky hue.

**Relative brightness.** The screen is brighter and more saturated than everything except the
wheel. It must not be dimmed into a backdrop.

## Region 5 — `truss`

**Hues.** A near-black violet void. A lattice of desaturated warm-grey and violet-brown
tubes. Magenta and violet cone light. Cyan on one or two lenses.

**Brightest pixels.** The moving-head lenses. Four read clearly in this crop, at about crop
(166, 102), (111, 159), (280, 173) in cyan, and (186, 225). Each is a blown-out warm-white
ellipse 14 to 20 px across with a hard core. A magenta flare sits at about crop (400, 98).

**Glow.** Each lens has a blown core, then a halo about one and a half to two lens diameters
wide, then its cone. The magenta flares are different: they are anamorphic, three to five
times wider than tall, 40 to 60 px across, with a soft magenta halo. Those horizontal streaks
are a signature of the image and they cannot come from an isotropic bloom.

**Lit versus shadowed metal.** The truss is edge-lit only. Each tube shows one thin bright rim
highlight on the side that faces a lamp and falls to near-black on the other side. The truss
therefore reads as a tangle of bright thin lines on black, not as a set of solid tubes. This
is the most important fact about the region: the truss is about nine parts silhouette to one
part rim light. A truss rendered with full-form shading will look wrong even at the right
colour.

**Reflection shape and opacity.** The curved band across the crop's upper left is the polished
fascia above the screen. It mirrors a blurred violet and magenta smear of the lamps at low
opacity, and the same anamorphic magenta smears appear on it, elongated along the band. The
moving-head bodies are matte dark grey with only a small specular on their shoulders.

**Sparkles.** A fine dust of bright specks covers the whole crop: dozens of white and magenta
dots 1 to 3 px across, plus larger soft blobs 6 to 10 px across. They read as glitter in the
air. They appear across the whole upper half of the frame, not only here.

## Region 6 — `podium`

**Hues.** A dark chocolate-black body. Warm gold trim. One blown-out yellow band. A
plum-violet floor. Magenta and coral clouds behind.

**Brightest pixels.** The yellow-gold desk band, crop (120-350, 100-135), which is frame
(250-480, 700-735). It is the brightest thing in the crop and clips to a pale lemon-white
across its middle. Next brightest is the gold ring on the podium base, crop (130-390,
240-265), then small speculars on the vertical trim ribs.

**Glow.** The yellow band's halo is 8 to 15 px, the tightest of the frame's three hot
features. It must not smear across the podium body.

**Lit versus shadowed metal.** Contrast is very high. The body panels are near-black and hold
a faint violet-brown diagonal grid that is only just readable. The gold trim reads bright
against them with a hard edge. Each vertical gold rib carries one bright highlight line and
one dark side. The podium therefore reads as a black form drawn with gold lines. The monitor
at the podium's back left is a black wedge with a thin bright gold top edge, and it is the
darkest object in the crop.

**Reflection shape and opacity.** The podium's own reflection is short and dark: a soft dark
violet smear plus one warm gold streak from the base ring, extending about a third of the
podium's height and then dissolving. Its edges are blurred vertically and no inverted shape
is recognisable. The floor just to the right of the podium is much brighter than the
reflection, so the reflection reads as a dark stain rather than a mirror.

## Whole frame

### Light directions

The wheel rim's brightest speculars sit on its upper left, and the hub's bright lobe points
toward ten o'clock. Both put the strongest light above the wheel, slightly to camera-left,
and in front of it. The pillars carry their highlights down their front-inner faces, which
agrees. The truss tubes are rim-lit from below and in front, and the source for that is the
wheel's own bulb ring rather than any lamp. The floor's brightest area sits directly under the
wheel, so the wheel's bulb ring plus the front key dominate what reaches the floor.

### Light colour, left versus right

The two sides do not match, and the mismatch is load-bearing.

- Left: magenta and violet, plus one cyan-blue beam. The left screen shows coral clouds on
  violet. The left pillar's highlights are warm gold over a violet bounce.
- Right: the only warm beams in the frame, two amber-gold cones in the upper right, plus cyan
  and violet cones. The right screen is cooler and bluer, with cyan-white cloud tops on
  cobalt.

So the frame reads magenta and coral on the left, cobalt and cyan on the right, with an amber
accent in the top-right corner.

### Beam cones

About ten cones read clearly, roughly five per side, and two or three more lenses flare
without showing a cone. All originate at moving-head lenses hanging under the truss ring, in
an arc across the upper half of the frame between about y 90 and y 300.

All cones point downward. The ones nearer the frame edges lean outward as well, roughly 20 to
35 degrees off vertical, and no two are parallel.

Each cone is narrow. It starts about one lens diameter wide, 15 to 20 px, and widens to only
55 to 75 px after 180 px of travel, which is a half-angle of about 8 to 10 degrees. That
agrees with the scene's spot cone of 0.38397 rad. Cone edges are soft, but each cone still
reads as a cone with a discernible boundary, not as a diffuse smudge.

Cones are brightest over their first third and fade to nothing well before the floor. None of
them lands a pool of light on the floor. Only the two in the upper right brush the fascia.

Colour by side: the left cones are lavender-magenta except for one cyan-blue; the right cones
are two amber-gold, two lavender-magenta, and one or two cyan.

### Vignette

Gentle, and asymmetric. The two top corners are near-black, but that darkness is the unlit
ceiling void rather than a filter. The bottom-left corner is a dark plum and the bottom-right
corner is a fairly bright violet floor, so there is no symmetric radial darkening in the
image at all.

Target a mild vignette only: enough to keep the far left and far right edges of the screen
band dimmer than each screen's centre, and enough to stop the floor brightening toward the
bottom corners. A strong vignette will kill the bright bottom-right floor, which the reference
keeps bright, and that is a visible failure.

### Floor reflection length

Two measurements, because the two objects behave differently.

- The wheel. Its reflection is a vertical gold column running from the base plate's contact
  line at about frame y 832 down to the frame's bottom edge at y 941, so about 110 px. The
  wheel stands about 825 px tall above the floor in the frame, from the base at y 832 to the
  crest tip at y 5. The reflection is therefore about an eighth of the object's height, and
  the frame cuts it off rather than the reflection fading out.
- The podium. Its reflection runs 70 to 90 px under a podium about 215 px tall, so about a
  third of its height, and it does fade out before the frame's bottom edge.

Practical target: reflection strength high at the contact line, decaying over something
between a tenth and a third of the object's screen height depending on how bright the object
is, with strong vertical blur throughout.

### Colour grade

A magenta-violet cast lies over everything. Gold sits on every metal highlight. Cyan is held
back to the right screen and a few beams.

Blacks are lifted and tinted plum. They are never neutral and never fully crushed. Even the
darkest ceiling void keeps a violet tint.

Highlights clip, and they clip warm. The hot cores read pale lemon or pale pink, not neutral
white.

Saturation is high. The sector colours are near-fully saturated, and only the cream and white
sectors are desaturated. Midtone contrast is punchy, and the run from a lit metal edge to its
shadow side is short.

## Ranked priority for look-dev

The five features that make this image read as this image, most important first.

1. **The sector fan and the bulb ring.** Forty-eight saturated wedges converge on a polished
   hub, and a gold band ringed with a channel of blown-out warm bulbs encloses them. This is
   the subject. Muddy sector colours, a dark bulb channel, or a hub without its brushed
   radial sunburst cannot be compensated for anywhere else.
2. **The floor as a blurred vertical mirror.** A glossy dark floor smears a gold column under
   the wheel and magenta streaks under the beams, and crisp gold ring inlays cut across it.
   This carries the whole lower third of the frame.
3. **Ten narrow beam cones from the truss, coloured by side.** Magenta-violet on the left,
   amber-gold plus cyan on the right. They fill the upper half and they are what makes the
   image read as a lit stage.
4. **The painterly sunset screen.** Coral clouds on violet at the left, cyan-white clouds on
   cobalt at the right, hard-lobed and flat-stepped, matte, and brighter than everything
   except the wheel.
5. **The crest crystal and its white spike.** A magenta-violet translucent chevron at the top
   of the wheel, with the frame's widest halo and a hard white spike running out of the top
   edge. It is small, it is the only thing above the wheel, and it anchors the vertical axis.

## Note for whoever writes `src/bin/crop.rs`

The reference crops in `renders/ref_crops/` were cut with `sips`, because the Rust helper did
not exist yet. `sips` has a trap: `--cropOffset 0 0` is ignored and the crop falls back to
centre-cropping. `sips` also silently skips the crop when the offset plus the size reaches the
image bound. All six crops above were verified: each has the requested pixel size and shows
the expected content. The Rust helper should reproduce these exact rectangles so that a
rendered crop and a reference crop line up pixel for pixel.
