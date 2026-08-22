---
name: vanilla-proto
description: Conventions and scaffolding for vanilla-js UI prototypes (no bundler, native ESM, pub/sub store, factory components). Use when creating a new prototype in vanilla js.
disable-model-invocation: true
---

# Vanilla-js prototype

Canonical starting files: `templates/` next to this file.

## No-bundler rules

- Native ESM only: relative imports with explicit `.js` extension. No bare specifiers — the browser can't resolve them.
- No npm packages, no import maps. Platform APIs + own code only. Use CDN runtime libs, but ask user before usage.
- Use `yarn :static` to run static http-server
- New packages under `packages/**` auto-register in the yarn workspace; no root config edits.

## Structure

```
packages/lab/<name>/
  package.json          # @hw/<name>, "type": "module", dev + test scripts
  index.html            # links src/styles.css, loads src/index.js as module
  src/
    index.js            # composition root: create store, create components, mount
    store.js            # canonical pub/sub store (copy from templates/, don't share across prototypes)
    types.d.ts          # AppState + domain types
    styles.css          # @import per-component css, :root CSS vars, reset
    state/              # pure logic: initial state + action functions
      <domain>.js
      <domain>.test.js
    components/
      <name>.js         # one component per file
      <name>.css        # styles next to the component
```

## Store

Copy `templates/src/store.js` verbatim into each prototype. Contract:

- `get()` — current state.
- `set(fn)` — mutate state inside `fn`; returning a value replaces state wholesale (reset). Notifies all subscribers.
- `subscribe(fn)` — called immediately and on every `set`; returns unsubscribe.

One store per app, created in `index.js`, passed down explicitly.

## State logic

- Pure action functions in `src/state/`: `(state, payload) => void | newState`. No DOM, no store, no side effects.
- Components dispatch via `store.set((s) => action(s, payload))`.
- Every state module gets a `node:test` file next to it. Run with `yarn test`.

## Components

Contract (see `templates/src/components/counter.js`):

- Factory `createX({ store, ...deps })` returning `{ el, destroy }`.
- Static skeleton via `el.innerHTML` template literal; element refs via `data-*` attributes + `querySelector`.
- Render = `store.subscribe` callback writing to the refs. `destroy` = unsubscribe.
- CSS in a sibling `<name>.css`, registered via `@import` in `styles.css`. Class names prefixed with the component name.

Allowed deviations:

- Dynamic lists / repeated elements: build with `createElement` or `<template>` instead of innerHTML.
- Nested components: a parent may create child factories; its `destroy` must call every child's `destroy`.

Everything else (classes, Web Components, virtual DOM imitations) — no.

## Types

- Types live in `src/types.d.ts` (interfaces, unions). No `.ts` runtime code — nothing compiles it.
- Runtime code references them via JSDoc: `/** @param {import("../types").AppState} s */`. Annotate the state contract and non-obvious signatures; don't annotate ceremonially.

## SOLID mapping

- **S** — one module, one concern: state logic ≠ components ≠ composition root. A component owns its DOM subtree only.
- **O** — extend via registry objects (keyed config maps) instead of editing if/switch chains when variants appear.
- **L/I** — every component satisfies the same minimal `{ el, destroy }` contract; factories take only the deps they use.
- **D** — dependencies arrive as factory parameters (`{ store }`), never as imported singletons.

## Scaffolding a new prototype

1. Copy `templates/` contents to `packages/lab/<name>/`.
2. Replace `PROTO_NAME` in `package.json` and the title in `index.html`.
3. Rename the example `counter` state/component to the first real feature or delete it.
4. `yarn test` must pass; start with `yarn dev`.

## Verification

After changing state logic — `yarn test` in the package. DOM/visuals are verified by the human in the browser; don't add DOM test harnesses.

Code style: `javascript/CLAUDE.md` applies
