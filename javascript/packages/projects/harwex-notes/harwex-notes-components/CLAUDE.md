# harwex-notes-components

React component library for `@hw/harwex-notes`. Source-only: `exports.ts` is the package entry and the consumer's rspack compiles the `.tsx`. There is no build step for the library.

## Layout

```
exports.ts                      public API, one grouped export
src/components/<name>/
  <name>.tsx                    the component
  <name>.css                    its styles (BEM-ish class names, prefixed with the component name)
  <name>.demo.tsx               default-exports a `TDemo` for the playground
dev/                            the playground; never imported by the library
```

## Adding a component

1. Create `src/components/<name>/` with the three files above.
2. Add the component to `exports.ts`.
3. Do not edit anything under `dev/`. The playground finds `*.demo.tsx` files by name, so parallel branches each adding a component do not conflict.

## Playground

- `yarn dev` starts it on port 8150. Another worktree at the same time: `PORT=8151 yarn dev`.
- The URL hash selects a demo: `http://localhost:8150/#example-button`.
- A demo owns its state (signals at module level or `useState`); the playground passes nothing in.

## Conventions

- Follow `javascript/CLAUDE.md` and the UI conventions of `harwex-notes/CLAUDE.md`: `T`-prefixed types, `import type` after value imports, JSX text as `{"..."}`, one plain CSS file per component.
- Components read colors from the `--color-*` CSS variables the host app defines, with a fallback: `var(--color-text, #1d1c1a)`. The playground defines the same variables in `dev/playground.css`.
- Components do not know about the harwex-notes store or registry. They take data and callbacks as props.
- `react`, `react-dom` and `@preact/signals-react` are peer dependencies; add nothing else without asking.
