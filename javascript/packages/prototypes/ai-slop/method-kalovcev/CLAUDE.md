# method-kalovcev

Satirical landing page for "Метод Каловцева" (slogan "Откат до базовых"). Deployed by `@hw/deploy` under `/method-kalovcev`.

- `yarn dev` serves on port 8170.
- Desktop and mobile run different WebGL2 shaders from `src/ui/shaders/`. `useMobile` (`max-width: 820px`) picks the pair in `shader-canvas.tsx`, and the same breakpoint holds the mobile CSS at the end of `styles.css`.
  - Desktop: `background.ts` is a molten fbm backdrop that follows the cursor. `liquid-image.ts` draws each photo with heat haze and a cursor ripple, every frame.
  - Mobile: `lava-lamp.ts` is six metaballs at half resolution and 30 fps. Scroll speed stretches them, a touch pulls them. `dither-image.ts` develops each photo from a Bayer-dithered duotone as it scrolls in, and a tap sends one ripple. It draws only when the scroll position changes or a ripple runs.
- Mobile drops `backdrop-filter`: a blur over the animated canvas re-renders every frame. Panels use near-opaque backgrounds instead.
- Mobile grids use `minmax(0, 1fr)`. A plain `1fr` column grows to fit a long display word such as «ПОДРОЧИТЬ» and pushes the text off screen.
- The photos in `src/assets/` came from the `image-gen` skill. They share one style prompt: a product on a black-marble pedestal, a #140d0a backdrop, amber rim light, magenta fill. Keep that prompt for new images so the edges melt into the page.
- `[data-reveal]` gets `is-in` from an IntersectionObserver outside React. Never put `data-reveal` on an element whose `className` React changes: a re-render drops `is-in` and the element turns invisible. Wrap it instead (see the ritual tiles).
- The ritual card uses `overflow: clip`, not `hidden`. With `hidden`, its glow pseudo-element makes the card scrollable, and focusing a tile scrolls the content sideways.
