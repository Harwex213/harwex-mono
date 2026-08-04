# Civitas map editor

Paints a province map over a terrain image and exports the pair a grand-strategy
map needs: an indexed-by-colour province PNG and a JSON manifest describing every
province in it. Inspired by how EU-style province maps are authored.

Stack: rspack, TypeScript, React, `@preact/signals-react`.

```bash
yarn dev        # dev server on an OS-picked port
yarn build      # bundle to dist/
yarn typecheck
```

## Workflow

1. **Load a map** — `Load map…`, or drop a png/jpg/webp anywhere on the window.
   `assets/map.png` is served at `/assets/map.png` in dev, so the `Sample` button
   skips the file picker.
2. **Outline a province** with the brush. Every province owns one exact RGB, and
   the first one is created for you.
3. **Fill it** with the bucket. The fill spreads through the connected run of
   identical pixels on the province layer and stops at your own strokes — the
   source image has no borders to stop it, so close the outline first.
4. Repeat with `+ New` per province. `Picker` makes the province under the cursor
   active again when you come back to it.
5. **Export** — writes `<map>-provinces.png` and `<map>-provinces.json`.

## Controls

| | |
|---|---|
| wheel | zoom at the cursor |
| space + drag, middle drag | pan |
| right drag | erase, whichever tool is active |
| `B` `G` `E` `I` | brush, bucket (**g**round fill), eraser, p**i**cker |
| `[` `]` | brush size |
| `N` | new province |
| `V` | hide/show the province layer |
| `0` `+` `-` | fit, zoom in, zoom out |
| `⌘Z` / `⌘⇧Z` | undo / redo |

## Export format

The PNG is the province layer alone at map resolution, transparent where nothing
is painted. Colours are written bit-exact: brush tips are rasterised as integer
spans rather than filled paths, so no pixel is ever a blend of two provinces and
the image can be read back by colour lookup.

```json
{
  "format": "civitas.province-map",
  "version": 1,
  "map": { "source": "map.png", "width": 5120, "height": 3402 },
  "provinces": [
    {
      "id": 1,
      "name": "Province 1",
      "kind": "land",
      "hex": "#98d7ab",
      "rgb": [152, 215, 171],
      "pixelCount": 844511,
      "bounds": { "x": 2432, "y": 892, "width": 995, "height": 849 },
      "centroid": { "x": 2929, "y": 1316 }
    }
  ],
  "painted": { "pixelCount": 857116, "coverage": 0.049199, "unregisteredColors": [] }
}
```

Geometry is measured from the exported pixels at export time, so it cannot drift
from the image. `centroid` is the centre of mass, which is where a label or a unit
marker belongs — the centre of the bounding box can fall outside a curved
province. `unregisteredColors` lists paint whose province is gone from the
registry; it should stay empty.

## Implementation notes

- The province layer keeps a `Uint32Array` mirror of its pixels as the source of
  truth and uploads only dirty rectangles to its canvas. Hover lookup, flood fill
  and the export scan read the mirror, so none of them pay for a `getImageData`
  on a 17-megapixel canvas.
- Undo snapshots the 256px tiles a stroke touched, not the whole layer: a full
  frame of this map is ~70 MB. Depth is 40 strokes.
- The map image and the layer live outside the signal graph — they are large
  mutable objects no component renders. Components react to `layerRevision`
  instead.

## Not implemented

- Reopening a previous export. Loading an existing province PNG plus manifest back
  into the editor is the obvious next step, and nothing in the format blocks it.
- No sessions are persisted: a reload starts empty.
- The bucket has no tolerance and ignores the terrain underneath, so coastlines
  have to be traced by hand rather than snapped to.
