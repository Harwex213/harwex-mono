# Faenwald Map UI

Canvas-based interactive world map for the Faenwald game prototype. React is a thin shell; all rendering and interaction runs on a
`MapEngine` class via `requestAnimationFrame`.

## Quick start

```bash
npm run dev      # Vite dev server with HMR
npm run build    # Production build
npm run preview  # Preview production build
```

## Tech stack

- **React 19** + **TypeScript 5.9** — UI shell only
- **Vite 7** with SWC plugin — build tooling
- **Canvas 2D API** — all map rendering
- `@preact/signals-react`, `clsx` — installed but not yet used

## Architecture

```
React (App.tsx)
  └─ useMapEngine hook
       └─ MapEngine (class, owns canvas lifecycle)
            ├─ Asset loading (images + JSON)
            ├─ requestAnimationFrame render loop
            ├─ Input handling (zoom, pan, click)
            └─ Event emitter → React state
```

**Key principle**: Map state (`offsetX`, `offsetY`,
`scale`) is mutable and lives outside React to avoid re-renders in the hot loop. Only `selectedProvince` and
`isLoading` are React state.

### Rendering pipeline (each frame)

1. Clear canvas
2. Apply transform: `translate(offset) → scale`
3. Draw `baseImg` (terrain)
4. Draw `borderCanvas` (pre-computed province borders)
5. Draw `highlightCanvas` (selected province overlay, if any)

### Province detection

Provinces are identified by unique RGB colors in
`map_provinces.png`. A click converts canvas coords to image coords, reads the pixel color, and looks it up in
`provinces.json` (~49 provinces).

### Border detection (`detect-borders.ts`)

Two-pass algorithm run once at load:

1. **Pass 1**: 8-connectivity neighbor comparison — find raw border pixels
2. **Pass 2**: Dilate borders by `BORDER_HALF_WIDTH` for visual thickness

Outputs a cached `OffscreenCanvas` + `dilatedMask` (prevents highlight bleeding onto borders).

## Project structure

```
src/
├── index.tsx              # React entry point
├── App.tsx                # Canvas host + province info overlay
├── App.module.css         # Full-viewport layout, loader, sidebar
├── use-map-engine.ts        # Hook bridging React ↔ MapEngine
├── map-data-source-types.ts               # TProvince, TProvincesMap, TMapState, TMapAssets
├── service/
│   ├── map-engine/
│   │   └── map-engine.ts   # Core engine (rendering, events, input)
│   ├── utils.ts           # Image loading, pixel color extraction
│   └── detect-borders.ts  # Border detection algorithm
└── model/
    ├── army.ts            # Army/unit type definitions (not yet integrated)
    └── army-constants.ts  # Supply constants (incomplete)

assets/
├── map_base.jpg           # Visual terrain map (~3.4 MB)
├── map_provinces.png      # Color-coded province regions
├── provinces.json         # Color hex → { provinceId, provinceName }
└── map.aseprite           # Source art file
```

## Path aliases

`@/*` maps to `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Event system

`MapEngine` emits typed events (`ASSETS_LOADED`,
`PROVINCE_SELECTED`) via a subscription callback. The hook translates these into React state updates.

## Conventions

- CSS Modules with `camelCaseOnly` class names
- Prefix types with `T` and enums with `E` (e.g., `TProvince`, `EMapEngineEvent`)
- Keep rendering logic in `MapEngine`, not in React components
- Pre-compute expensive operations (borders, highlights) once and cache as `OffscreenCanvas`
