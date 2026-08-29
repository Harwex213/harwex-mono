# tbs-ostrov-prototype-2

A generator workbench for a hex map of islands, 400x400 by default — 160 000
hexes — and adjustable from 40x40 up to 800x800. The left column tunes the
generator, the middle draws the result, the right column reports what came out.
Every knob regenerates on the spot, so a slider drag shows its effect while the
pointer is still down.

Map size drags the island count along with it, in proportion to the area. That
parameter counts cores, not density, so leaving it alone would turn a map twice
as wide into mostly open sea. The slider moves visibly rather than the scaling
being hidden, and the share of land stays near 15% across the whole range.

Drag to pan, scroll to zoom, click an island to isolate it. Run it with `yarn dev`.

## Architecture

Follows `packages/lab/frontend-plain-architecture`:

- `src/store/store.ts` — every piece of mutable state, as `@preact/signals-react`
  signals grouped by area. Components read signals directly through `useStore`.
- `src/domain/*` — the actions. Each one takes the store as its first argument
  and is a plain function, so it can be called from a test without React.
- `src/domain/registry-creator.ts` — binds the store into every action once at
  start-up. `src/domain/registry.ts` declares the resulting call signatures.
- `src/ui/*` — components. A component takes only the slice of the registry it
  actually calls, so its dependencies are visible in its own props type.

Nothing in `src/domain` imports React, and nothing in `src/ui` writes to a signal
without going through the registry.

## How a map is generated

`src/domain/generator/map-generator.ts`, in order:

1. **Cores.** `islandCount` anchors are scattered by best-candidate sampling, so
   they spread out instead of clumping. Each anchor grows into a chain of
   `lobes` overlapping blobs. One blob alone always comes out a circle; a chain
   gives bays and peninsulas.
2. **Height.** Every hex takes the strongest core's falloff, multiplied by a
   fractal noise field. `coastRoughness` sets how hard the noise bites into the
   round core; `edgeMargin` fades the height to zero near the border, so no
   island is cut off by the edge of the map.
3. **Land.** A hex above `seaLevel` is land. Connected land is labelled into
   islands, and blobs under `minIslandSize` are flooded back to water.
4. **Terrain.** A second noise field gives moisture. Height decides the band —
   beach, plains, hills, mountains, snow — and moisture splits the lowlands into
   plains, forest and marsh. Peaks also need room behind them, so a six-hex
   island never comes out capped in snow.

The map is a rectangle of pointy-top hexes in `odd-r` offset layout.
`src/domain/hex/coords.ts` converts to axial for neighbour and distance maths,
`src/domain/hex/layout.ts` converts to pixels and back, and
`src/domain/hex/camera.ts` holds the pan and zoom maths.

## What 160 000 hexes changed

Three things that were fine on a small map are not fine on this one, and the
shape of the code is mostly a response to them.

- **The map is typed arrays, not objects.** `THexField` holds one array per
  property. As one object per hex the same map is tens of megabytes and a slow
  pass for the garbage collector on every regeneration. Generating a map went
  from about 350 ms to under 30 ms on the same settings. `readCell` reads one hex
  back out as an object for the inspector.
- **The renderer draws only what is on screen.** A whole 400x400 map at a
  readable zoom would be a 7716x6655 canvas, which the browser will not allocate.
  The canvas is viewport-sized and the camera decides which cells to draw. Zoomed
  out past a few pixels per hex the viewport blits a slice of an offscreen
  picture of the whole map instead, because at that zoom "what is on screen" is
  every cell there is. That picture has its own pixel budget: an 800x800 map is
  drawn coarser than a 400x400 one, and the switch to live cells then happens at
  a correspondingly lower zoom.
- **Bulk drawing is one `fill()` per hex.** Collecting the map into a few large
  `Path2D` objects and filling those looks like the obvious optimisation and is
  about twenty times slower: building a path of 160 000 hexes costs over a
  second, while drawing them one at a time costs about sixty milliseconds.
