# @hw/faenwald-battle-prototyp-v2

Faenwald battle prototype, second iteration. React + TypeScript + rspack, state in
`@preact/signals-react`, UI from `@hw/faenwald-uikit`.

```bash
yarn workspace @hw/faenwald-battle-prototyp-v2 dev        # rspack dev server, random free port
yarn workspace @hw/faenwald-battle-prototyp-v2 build      # bundle into dist/
yarn workspace @hw/faenwald-battle-prototyp-v2 typecheck  # tsc --noEmit
```

## Signals in components

rspack compiles TSX with swc, so the `@preact/signals-react-transform` Babel plugin is
not in the pipeline. Auto-tracking is therefore unavailable: a component that reads
`someSignal.value` during render must call `useSignals()` from
`@preact/signals-react/runtime` first, otherwise it never re-renders.

```tsx
function UnitCard() {
  useSignals();
  return <span>{round.value}</span>;
}
```

`useSignal`, `useComputed` and `useSignalEffect` install their own tracking and need no
extra call.

## Layout

- `src/state/` — signal stores, no React imports
- `src/App.tsx` — root component
- `src/*.module.css` — component styles, built on the uikit's `--uk-*` tokens

`@hw/faenwald-uikit` is consumed from its `dist/`. After editing the kit, rebuild it with
`yarn workspace @hw/faenwald-uikit build`.
