# @hw/faenwald-uikit

UI kit over [Base UI](https://base-ui.com) primitives. Ships prebuilt ESM + `.d.ts` in `dist/` (built automatically on `yarn` install via `prepare`).

## Install

```jsonc
// consumer package.json
"dependencies": {
  "@hw/faenwald-uikit": "workspace:*",
  "react": "19.2.0",      // peer: ^19
  "react-dom": "19.2.0"   // peer: ^19
}
```

Preact apps skip react and alias instead (see battle-lab's rspack config):

```js
resolve: {
  alias: {
    "react": "preact/compat",
    "react-dom": "preact/compat",
    "react/jsx-runtime": "preact/jsx-runtime",
  },
}
```

## Use

```js
import { Switch, Tabs, cn } from "@hw/faenwald-uikit";
import "@hw/faenwald-uikit/theme.css"; // design tokens — once, at app entry
```

Components are namespaced parts: `<Switch.Root>`, `<Tabs.List>`, etc. Class names come precompiled (CSS Modules); pass `className` to extend.

## Requirements

- A CSS-aware bundler: emitted JS contains `import "./x.css"` side effects. rspack: `{ test: /\.css$/i, type: "css/auto" }`. No SSR/Node usage without a bundler.
- ESM only, no CJS build.
- Unused components tree-shake away (`sideEffects: ["**/*.css"]`).
- `@base-ui/react` is a regular dependency here — if your app also depends on it directly, keep the exact version in sync to avoid duplicate instances (broken portals/contexts).

## Develop

- `yarn dev` — component gallery (rspack dev server).
- `yarn build` / `rslib build --watch` — rebuild dist while consumers run.
- `yarn typecheck`.

New component: add `src/ui/<name>/`, re-export from `src/index.tsx`; a colocated `demo.tsx` (`export const meta = { title }` + default component) auto-appears in the gallery.
