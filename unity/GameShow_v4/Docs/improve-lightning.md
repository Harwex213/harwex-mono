Current render of the scene:
![](./current_render.png)

Desired render of the scene:
![](./desired_render.png)

Render after the exposure pass:
![](./after_render.png)

## What changed

The set was underexposed while the wheel was not. A global exposure lift was tested and
rejected: it blew out the wheel and turned the arch panels into flat grey. The fix raises the
set lights instead and leaves the wheel keys alone.

Lights (`SampleScene`, `Studio Lighting` group):

| Light | Before | After |
| --- | --- | --- |
| `SL_BayWash_*` (6) | 16, range 4.5 | 34, range 5.5 |
| `SL_FeatureWash_*` (2) | 8, range 9 | 18, range 10 |
| `SL_Graze_Pil_*` (4) | 32, range 5.5, 64° | 95, range 6.0, 60° |
| `SL_PodiumHalo` | 26, range 4.5 | 48, range 5.0 |
| `SL_FloorSoft` | 1.2, range 7 | 1.8, range 8 |
| `SL_RoomProbe` | intensity 1.9 | intensity 2.7 |

`GI_Studio.lighting`: `indirectScale` 0.45 -> 0.85.

`SampleSceneProfile.asset`: `WhiteBalance.temperature` 3 -> 20, `tint` 0 -> 2;
`ColorAdjustments.postExposure` 0 -> -0.15, `contrast` 1.2 -> 1.3, `saturation` 14 -> 18,
`colorFilter` -> (1.0, 0.95, 0.87).

GI was rebaked after each light change. The `PodiumHalo` and `FloorSoft` ranges were widened
first and pulled back again — a wide range flattens the floor pool into an even wash, and the
desired look needs the pool to fall off towards the edges.

## Measured against the target

Region means from a 1920x1080 camera capture, R channel:

| | before | after | desired |
| --- | --- | --- | --- |
| frame luminance median | 35.2 | 48.6 | 42.9 |
| floor, front | 63.1 | 84.1 | 81.9 |
| arch panel | 22.6 | 35.7 | 28.9 |
| pilaster | 39.8 | 57.7 | 63.5 |

## Not addressed

The wheel face still reads lemon-yellow where the target reads gold. That is not exposure:
`SL_Key_WheelL` / `SL_Key_WheelR` move the wheel face by about 2% across a 7 -> 2.2 intensity
sweep, so the wheel is lit almost entirely by light probes and the reflection probe. Its colour
is a material and texture question.

The podium LED ring reads as a thin white line; the target has a thick warm glow. That is the
`SL_PodiumBand_Gold` emission colour plus the bloom threshold, not scene exposure.

Faint streak artifacts sit on the ceiling above the wheel. They were always there and the
brighter set makes them easier to see — they look like lightmap UV seams on
`SM_Studio_Ceiling`.
