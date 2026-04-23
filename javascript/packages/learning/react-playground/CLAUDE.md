# React Playground

A learning sandbox for building and experimenting with non-trivial React UI components and patterns. Each feature is a self-contained prototype focused on a specific UI challenge.

## Goals

- Implement interesting/complex UI components from scratch to deeply understand browser APIs, React patterns, and CSS techniques
- Each experiment lives in its own folder and is independently routable
- Prioritize learning over production-readiness — it's okay to explore creative or low-level approaches

## Tech Stack

- **React 19** with TypeScript
- **Vite** + SWC for builds
- **CSS Modules** (camelCase locals) for styling — no CSS-in-JS
- **react-router-dom v5** for routing
- **@preact/signals-react** available for fine-grained reactivity
- **clsx** for conditional class names
- **@hw/utils** — shared workspace utilities

## Project Structure

```
src/
  index.ts                  # App entry point
  ui/
    router-di.ts             # Singleton Router — all features register routes here
    app.tsx                  # BrowserRouter + route rendering; imports each feature module
    wireframe/               # CSS layout prototype (sidebar + content grid)
    virtual-list/            # Custom virtual list (windowing) implementation
    virtual-list-demo/       # Demo/usage of virtual-list
    bottom-sheet/            # Mobile bottom sheet with touch-drag-to-dismiss
    three-side-slider/       # Three-panel image slider (auto-play, keyboard, touch scroll)
```

## Routing Convention

Each feature **self-registers** its route by importing `router` from `../router-di` and calling:

```ts
router.registerRoute("/my-feature", MyFeatureComponent);
```

The feature file must then be imported in
`app.tsx` so the side-effect runs. No central route config file — registration is co-located with the feature.

## Adding a New Feature

1. Create `src/ui/<feature-name>/` directory
2. Implement the component in `<feature-name>.tsx`
3. Register the route at the bottom of the file: `router.registerRoute("/feature-name", FeatureComponent)`
4. Add a CSS Module `<feature-name>.module.css` for styles
5. Import the feature file in `app.tsx` (side-effect import)

## Code Style Rules

- **TypeScript strict** — no `any`, type all props with interfaces
- **CSS Modules only** — no inline styles, no Tailwind, no styled-components
- **CSS custom properties** for design tokens (colors, spacing) — define on a wrapper element via a `.variables` class
- **memo + FC** pattern for components: `const Foo: FC<Props> = memo(() => { ... })`
- Extract custom hooks from components when logic is non-trivial
- Co-locate types, data, hooks, and subcomponents in the same file if the feature is small enough; split into separate files only when the file gets large
- Section comments (`// ── Section Name ───`) to visually separate regions within a file

## Commands

```bash
yarn start   # dev server (Vite)
```

Path alias `@` resolves to `src/`.
