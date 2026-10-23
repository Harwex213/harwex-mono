# resume-old-timoha

Joke cyberpunk resume site: Старый and Тимоха apply together for one HR manager vacancy at one salary. Deployed by `@hw/deploy` under `/resume-old-timoha`.

- `yarn dev` serves on port 8180.
- Candidate data lives in `src/domain/candidates.ts`. The two special-skill sections (pigeon vape juice king, soldering master) live in `src/domain/talents.ts` and render through `talent.tsx`.
- Shaders are WebGL2 in `src/ui/shaders/`. `use-mobile.ts` (`max-width: 820px`) switches them to lite mode: lower resolution and 30 fps.
  - `background.ts` animates a generated photo of a cyberpunk skyline: `src/assets/city.jpg` on desktop, `city-portrait.jpg` on mobile. It adds a slow camera drift with pointer parallax, neon bloom, twinkling windows, drifting haze and ripples on the river. On top it draws a holographic STONKS chart with candles that always trends up, plus rising green rain and arrows. `shader-canvas.tsx` passes `water`: the texture y where the river starts in each photo. The ripples stay weak because the balcony railing overlaps the river. An earlier fully procedural skyline looked flat; the photo plate replaced it.
  - `hologram-image.ts` draws every photo: a scan-line reveal, periodic glitch bursts, and a ripple under the pointer or a tap. It renders only while the canvas is on screen.
- The photos in `src/assets/` came from the `image-gen` skill, with the friends' real photos as references. The shared style: cinematic cyberpunk painting, magenta and cyan rim light, rain, near-black `#07060d` background.
- Mobile drops `backdrop-filter` and uses near-opaque panels, as in `method-kalovcev`.
- `.glitch` draws its copies with `inset: 0`. Put it on an element without padding, or the copies shift away from the text.
