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
   To carry on from an earlier session, `Load provinces…` after the map — see
   [Reopening an export](#reopening-an-export).
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

## Reopening an export

`Load provinces…` reads a previous export back in. Select the PNG, the JSON, or
both at once; dropping a manifest onto the window imports the whole drop. The base
map has to be open first, since the layer is sized from it — a dropped image on its
own is always taken as a new base map, never as a province layer.

Each half carries what the other cannot: the PNG holds the shapes, the manifest
holds the names, kinds and ids. Both are read before either is applied, so a broken
manifest leaves the layer as it was.

The rules it applies, all reported in a notice after the import:

- **Size must match the map.** A province image or manifest of another size is
  refused, because every province in it would land somewhere else.
- **Unlisted colours are adopted** as new provinces. Paint the manifest does not
  describe would otherwise export as `unregisteredColors`.
- **Unusable manifest entries are skipped** — no colour, or a colour another entry
  already claimed. Repeated or missing ids are renumbered rather than dropped.
- **Part-transparent pixels are dropped.** A canvas stores pixels premultiplied, so
  reading one back cannot return its original colour — `rgba(192,64,64,200)` comes
  out as `193,64,64` — and a province is identified by an exact colour, so such a
  pixel would invent a province matching no entry. Exports from this editor are
  always fully opaque or fully clear; this only fires on images from elsewhere,
  including anti-aliased province edges.

History is dropped on import: opening a document is not an edit, and the strokes on
the stack belong to pixels that no longer exist.

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

- No sessions are persisted: a reload starts empty, and the base map has to be
  picked again before its provinces can be reloaded.
- The bucket has no tolerance and ignores the terrain underneath, so coastlines
  have to be traced by hand rather than snapped to.
