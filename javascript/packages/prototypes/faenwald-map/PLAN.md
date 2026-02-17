# Faenwald Map — Implementation Plan

## Overview

Canvas-based interactive map. React serves only as a shell — all heavy lifting happens in a single `useMapEngine` hook via `requestAnimationFrame`.

---

## Files

| File | Action |
|---|---|
| `src/types.ts` | New — shared types |
| `src/useMapEngine.ts` | New — core logic hook |
| `src/App.tsx` | Update — canvas + province info overlay |
| `src/App.module.css` | Update — canvas + overlay styles |

---

## src/types.ts

```ts
export interface Province {
  provinceId: string;
  provinceName: string;
}

// key = "#rrggbb" lowercase
export type ProvincesMap = Record<string, Province>;

export interface MapState {
  offsetX: number;
  offsetY: number;
  scale: number;
}
```

---

## src/useMapEngine.ts

### Asset loading

```ts
loadImage(src: string): Promise<HTMLImageElement>
loadProvinces(): Promise<ProvincesMap>   // fetch /assets/provinces.json
```

### Edge detection → `detectBorders(provincesImageData, provincesMap): OffscreenCanvas`

1. Iterate every pixel (x, y) of `map_provinces.png` ImageData.
2. Get color as `#rrggbb`.
3. Skip if color is `#ffffff` (no province) or not in `provincesMap`.
4. Compare with right neighbor (x+1, y) and bottom neighbor (x, y+1).
5. If neighbor color differs → both pixels are border pixels.
6. Write border pixels to an `OffscreenCanvas` (same WxH as provinces image) with black fill, rest transparent.

Result: a pre-rendered border overlay drawn once, reused every frame.

### Province pixel lookup → `getProvinceAtPixel(imageData, x, y): string | null`

Returns `#rrggbb` hex at (x, y) or `null` if white / out of bounds.

### Highlight overlay → `buildHighlight(imageData, color): OffscreenCanvas`

Called once on province selection:
1. Iterate all pixels.
2. Where color matches selection, write semi-transparent white (or gold).
3. Return OffscreenCanvas — stored in a ref, redrawn every frame until selection changes.

### Hook: `useMapEngine(canvasRef)`

**State** (plain mutable object, not React state — updated each frame):
```
mapState = { offsetX, offsetY, scale }
```

**React state** (triggers UI re-render):
```ts
const [selectedProvince, setSelectedProvince] = useState<Province | null>(null)
const [isLoading, setIsLoading] = useState(true)
```

**useEffect lifecycle**:
1. Load `map_base.jpg`, `map_provinces.png`, `provinces.json` in parallel.
2. Draw `map_provinces.png` onto an OffscreenCanvas → extract ImageData (kept in memory for pixel lookup).
3. Call `detectBorders()` → store `borderCanvas` ref.
4. Initial scale: fit image inside viewport while preserving aspect ratio. Center offset.
5. Start `requestAnimationFrame` loop → `renderFrame()`.
6. Attach event listeners (`wheel`, `mousedown`, `mousemove`, `mouseup`, `click`) to canvas.
7. Attach `ResizeObserver` to sync canvas dimensions with its CSS size.
8. Return cleanup: cancel RAF, remove listeners.

**renderFrame()**:
```
ctx.clearRect(...)
ctx.save()
ctx.translate(state.offsetX, state.offsetY)
ctx.scale(state.scale, state.scale)
ctx.drawImage(baseImg, 0, 0)           // base map
ctx.drawImage(borderCanvas, 0, 0)      // pre-computed borders
if (highlightCanvas) ctx.drawImage(highlightCanvas, 0, 0)  // selection
ctx.restore()
```

**Zoom (wheel)**:
```
worldX = (cursorX - offsetX) / scale
worldY = (cursorY - offsetY) / scale
scale *= factor  // 1.1 or 0.9, clamped to [minScale, 8]
offsetX = cursorX - worldX * scale
offsetY = cursorY - worldY * scale
```
`minScale` = fit-to-viewport scale computed at load time.

**Pan (drag)**:
- `mousedown` → set `isDragging = true`, record `lastX, lastY`
- `mousemove` → if dragging: `offset += delta`
- `mouseup / mouseleave` → `isDragging = false`

**Click → province selection**:
1. `imageX = (canvasX - offsetX) / scale`, `imageY = ...`
2. Check bounds.
3. `color = getProvinceAtPixel(imageData, imageX, imageY)`
4. Look up in `provincesMap`.
5. Call `buildHighlight(imageData, color)` → store in ref.
6. `setSelectedProvince(province)`.

---

## src/App.tsx

```tsx
const canvasRef = useRef<HTMLCanvasElement>(null)
const { selectedProvince, isLoading } = useMapEngine(canvasRef)

return (
  <div className={s.app}>
    {isLoading && <div className={s.loader}>Loading...</div>}
    <canvas ref={canvasRef} className={s.canvas} />
    {selectedProvince && (
      <div className={s.provinceInfo}>
        <h2>{selectedProvince.provinceName}</h2>
        <p>{selectedProvince.provinceId}</p>
      </div>
    )}
  </div>
)
```

---

## src/App.module.css

```css
.app    { position: relative; width: 100vw; height: 100vh; overflow: hidden; background: #111; }
.canvas { display: block; width: 100%; height: 100%; cursor: grab; }
.canvas:active { cursor: grabbing; }
.loader { position: absolute; inset: 0; display: flex; align-items: center; justify-content: center; color: white; }
.provinceInfo { position: absolute; bottom: 24px; left: 24px; background: rgba(0,0,0,.75); color: white; padding: 12px 16px; border-radius: 8px; pointer-events: none; }
```

---

## Key constraints

- Canvas pixel dimensions must match its CSS layout size (handled by ResizeObserver setting `canvas.width/height`).
- All map state (offset, scale) is mutable and lives outside React state to avoid re-renders in the hot path.
- `buildHighlight` is called only on selection change, not every frame.
- `detectBorders` runs once after asset load, on the main thread (acceptable for prototype; can move to Worker later).
