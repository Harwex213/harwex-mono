# tbs-ostrov-prototype-v1

Generator of hex islands, drawn as SVG. The board is a 5 × 5 rectangle of hexes
in axial coordinates; the generator decides which of the 25 cells are land and
which of the three types each land tile gets: **Луга**, **Лес**, **Горы**.

## Run

```bash
yarn workspace @hw/tbs-ostrov-prototype-v1 dev
```

The dev server listens on port 8160. `?seed=SOMETEXT` in the URL builds the
island that seed describes, so a link is enough to share one.

## How an island is generated

Everything comes from one seed, so the same text always gives the same island.

1. **Height.** Every cell gets a random value; two passes of neighbour averaging
   turn the speckle into blobs. A pull towards the middle of the board is mixed
   in, which is what sinks the rim.
2. **Land.** The tallest 9 to 16 cells become candidates. Only the largest
   connected group survives — the rest goes back to the sea — and that group
   then grows back to size by swallowing the tallest cell beside it. The island
   is therefore always one piece.
3. **Lake.** With a 60% chance one land cell that has land on all six sides is
   drowned. A hex ring stays connected once its middle is gone.
4. **Moisture.** A second noise field, plus a bonus for cells next to water. A
   lake counts for more than the salt ocean, so a lake usually sits in a ring of
   forest.
5. **Terrain.** The land is ranked twice. Height and distance from the water pick
   the mountains, so the range lands in the middle of the island instead of on
   the beach. The wettest of the rest becomes forest, and the dry remainder
   becomes meadows. Ranking instead of fixed thresholds keeps all three types on
   every island.

## Layout

The architecture follows `packages/lab/frontend-plain-architecture`.

```
src/
  main.tsx                  mounts the app, wires the store to the registry
  store/store.ts            signals only, no logic
  domain/
    registry.ts             the action types the UI is allowed to call
    registry-creator.ts     binds the store into every action
    island-state.ts         the actions themselves
    hex/                    axial coordinates, board shape, SVG geometry
    island/                 seeded rng, terrain types, the generator
  ui/
    app.tsx
    palette.ts              colours
    components/
```

A component reads state from the store through `useStore` and calls behaviour
through the registry slice it is handed as a prop.
