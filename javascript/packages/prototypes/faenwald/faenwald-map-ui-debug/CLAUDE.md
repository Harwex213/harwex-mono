# Faenwald Map UI

Canvas-based interactive world map for the Faenwald game prototype. React is a thin shell around a `MapEngine` class that owns all canvas rendering via `requestAnimationFrame`.

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
- **Radix Primitives** — accessible behavior for Dialog, Select, Tooltip, Popover
- **clsx** — conditional class merging
- **@hw/faenwald-core** — game data types and logic (workspace dependency)

## Architecture

```
React (App.tsx)
├─ useMapEngine hook
│    └─ MapEngine (class, owns canvas lifecycle)
│         ├─ Asset loading (images + JSON + game context)
│         ├─ requestAnimationFrame render loop
│         ├─ Input handling (zoom, pan, click, hover)
│         └─ Event emitter → React state
├─ EventTimeline (turn/phase navigation + event cards)
└─ DebugPanel (dev tools)
```

**Key principle**: Canvas state (`offsetX`, `offsetY`, `scale`) is mutable inside `MapEngine` to avoid React re-renders in the hot loop. Only selection and loading state bridge to React.

### Rendering pipeline (each frame)

1. Clear canvas
2. Apply transform: `translate(offset) → scale`
3. Draw `baseImg` (terrain)
4. Draw `borderCanvas` (pre-computed province borders)
5. Draw hovered province border (yellow outline)
6. Draw selected province highlight (orange tint)
7. Draw province centers (debug, optional)
8. Draw army icons (shield SVG paths on province centers)

### Province detection

Provinces are identified by unique RGB colors in `map_provinces.png`. A click converts canvas coords to image coords, reads the pixel color, and looks it up in the provinces map (~49 provinces).

### Border detection (`detect-borders.ts`)

Two-pass algorithm run once at load:

1. **Pass 1**: 8-connectivity neighbor comparison — find raw border pixels
2. **Pass 2**: Dilate borders by `BORDER_HALF_WIDTH` for visual thickness

Outputs a cached `OffscreenCanvas` + `dilatedMask` (prevents highlight bleeding onto borders).

## Project structure

```
src/
├── index.tsx                    # React entry point
├── utils.ts                     # localStorage helpers, useLocalStorageState
├── api/
│   └── api.ts                   # RPC client (loadGameContext, saveGameContext)
├── core/
│   └── map-engine/
│       ├── map-engine.ts        # Core engine (rendering, events, input)
│       ├── map-engine-core.ts   # Highlight/border canvas builders
│       ├── map-engine-debug.ts  # Province center rendering
│       ├── map-types.ts         # TMapState, TMapAssets, EMapEngineEvent
│       ├── use-map-engine.ts    # Hook bridging React ↔ MapEngine
│       ├── detect-borders.ts    # Border detection algorithm
│       └── utils.ts             # Image loading, pixel color extraction
└── ui/
    ├── App.tsx                  # Canvas host + overlays
    ├── App.module.css           # Full-viewport layout
    ├── tokens.css               # Design tokens (primitives + semantic)
    ├── debug-panel/
    │   ├── debug-panel.tsx
    │   └── debug-panel.module.css
    ├── event-timeline/
    │   ├── event-timeline.tsx
    │   └── event-timeline.module.css
    ├── selected-province/
    │   ├── selected-province.tsx
    │   └── selected-province.module.css
    └── kit/                     # UI kit components
        ├── index.ts             # Barrel export
        ├── button/              # Primary/secondary/ghost, sm/md
        ├── icon-button/         # Square icon-only button, sm/md
        ├── input/               # Text/number with optional label
        ├── checkbox/            # Custom-styled with hidden native input
        ├── card/                # Translucent overlay container
        ├── scroll-area/         # Horizontal/vertical with styled scrollbar
        ├── dialog/              # Radix Dialog wrapper
        ├── select/              # Radix Select wrapper
        ├── tooltip/             # Radix Tooltip wrapper
        └── popover/             # Radix Popover wrapper

assets/
├── map_base.jpg               # Visual terrain map
├── map_provinces.png          # Color-coded province regions
└── map.aseprite               # Source art file
```

## Path aliases

`@/*` maps to `src/*` (configured in both `tsconfig.json` and `vite.config.ts`).

## Design tokens

Two-layer CSS custom property system in `src/ui/tokens.css`:

- **Layer 1 — Primitives**: raw values named by what they are (`--color-gray-800`, `--space-4`, `--radius-sm`)
- **Layer 2 — Semantic**: purpose-driven names referencing primitives (`--bg-surface`, `--text-primary`, `--border-accent`)

Loaded globally via `<link>` in `index.html`.

## UI kit

Reusable components in `src/ui/kit/`, imported via `@/ui/kit`:

- **Hand-rolled**: Button, IconButton, Input, Checkbox, Card, ScrollArea
- **Radix-backed**: Dialog, Select, Tooltip, Popover

Each component is a `.tsx` + `.module.css` pair in its own directory.

## Conventions

- CSS Modules with `camelCaseOnly` class names
- **Always use design tokens from `src/ui/tokens.css`** — never use raw hex colors, rgba values, padding/spacing literals, font sizes, or border-radius values directly in CSS modules. Use the corresponding `var(--*)` token instead. If a needed token doesn't exist, add it to `tokens.css` first
- Use UI kit components from `@/ui/kit` instead of raw HTML elements for buttons, inputs, checkboxes, cards, dialogs, selects, tooltips, and popovers
- Prefix types with `T` and enums with `E` (e.g., `TProvince`, `EMapEngineEvent`)
- Keep rendering logic in `MapEngine`, not in React components
- Pre-compute expensive operations (borders, highlights) once and cache as `OffscreenCanvas`
