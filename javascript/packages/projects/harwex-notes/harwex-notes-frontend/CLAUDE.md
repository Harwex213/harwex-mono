# harwex-notes

A notes viewer: a file tree on the left, tabs on top, a document viewer in the middle. React + rspack + TypeScript + `@preact/signals-react`. 

## Architecture

Five layers, one direction of dependency. State lives in signals in the store. Every state change happens in a domain action that takes `(store, api)`. The registry binds those actions and is the only thing UI may call. The api is the outer boundary and the only place that knows where data comes from. Dependencies point one way. UI imports the registry and the store, the registry imports domain actions, domain actions import the store and the api, and the store imports nothing from the layers above it. File names and folder contents will change; the seams below should not.

```
main.tsx  →  createStore()  +  createApi()  →  createRegistry(store, api)  →  <App registry={registry} />
```

### 1. Store (`src/store/`)

- The store is a plain object of signals, built by `createStore()`. It is created once in `main.tsx` and handed to React through `StoreProvider` / `useStore()`.
- The store holds **state only**. No methods, no logic that talks to the api.
- State is split into slices (`fs`, `tabs`, `documents`, ...). Each slice is a `createXxxState()` factory that returns an object of `signal(...)`s. `TStore` is `ReturnType<typeof createStore>`; never write the store type by hand.
- Derived data lives in `store.derived` as `computed(...)` values built from the slices. Anything a component would otherwise `useMemo` belongs here. Pure helpers that feed a `computed` (tree flattening, sorting) sit next to it in the store file, not in the UI.
- Signal contents are treated as immutable: `readonly` arrays, `Readonly<Record>`, replaced whole (`signal.value = [...old, x]`), never mutated in place.
- Async state is modelled as discriminated unions (`{ status: "loading" } | { status: "ready"; ... } | { status: "error"; message }`), not as parallel boolean flags.

### 2. Domain actions (`src/domain/`)

- All state changes happen in **actions**: plain functions with the signature `(store: TStore, api: TApi, ...args) => void | Promise<void>`. Even actions that do not need `api` keep the parameter (`_api`) so the registry can bind uniformly.
- Actions are grouped per slice in `xxx-state.ts` files. An action may touch several slices (deleting a node also drops its tabs and documents); it does so by calling private helpers, not by reaching into UI.
- Inside actions: read with `.peek()`, write with `.value =`. Reading `.value` inside an action is a bug (it subscribes for nothing).
- Public actions end with `Action` (`openNodeAction`). Helpers that are shared between action files but are not exposed to UI have no suffix (`ensureDocument`).
- Every async action that talks to the api follows the same shape: guard on a busy flag, set busy / clear error, `try` the api call and write results into the store, `catch` into an error signal as a message string, `finally` clear busy. Errors never escape to React.
- Constants that are product rules (`MAX_OPEN_TABS`) live in the action file with a one-line comment saying *why*.

### 3. Registry (`src/domain/registry.ts`, `registry-creator.ts`)

- The registry is the only thing UI uses to change state. It is the set of actions with `store` and `api` already bound (`func.bind(null, store, api)`), so a component calls `registry.openNodeAction(nodeId)` and never sees `store` or `api`.
- Adding an action means three edits: write it in a `*-state.ts` file, add it to `rawRegistry` in `registry-creator.ts`, add its bound type (`TXxxAction = (...args) => ...`) and a field in `TAppRegistry` in `registry.ts`. Keep the type file free of imports from store or domain files except pure data types.
- The `TAppRegistry` type is written by hand on purpose. It is the public contract of the domain layer; it should not be inferred.

### 4. Api (`src/api/`)

- `types.ts` is the boundary: it re-exports the data types (`TFsNode`, `TDocument`, ...) from `@hw/harwex-notes-protocol` and adds the `TApi` interface. Everything else in the app imports data shapes from here, never from the protocol package or a concrete api implementation.
- Data shapes and their zod schemas live in `@hw/harwex-notes-protocol`, shared with `@hw/harwex-notes-backend`. A change to a data shape starts in the protocol package.
- `TApi` methods are async and return the **full new state** (for example the whole node list after a mutation) rather than a delta. Domain actions replace store signals with what the api returned; they do not compute the mutation twice.
- The api validates its own invariants and throws `Error` with a user-readable message. Domain shows that message as is.
- Two implementations exist. `createTrpcApi(url)` talks to the backend over tRPC and is the default. `createMockApi()` is in-memory data with fake latency and no persistence; `yarn dev:mocked` / `yarn build:mocked` (`rspack --env mocked`) select it through the `__API_MOCKED__` define. Nothing outside `src/api/` and `main.tsx` should know which one is active.
- Domain and UI must not depend on `mock-data.ts` or on mock-only details.

### 5. UI (`src/ui/`)

- Components get data from `useStore()` and change data through `registry`. They never import from `src/domain/*-state.ts` or `src/api/mock-*`.
- Every component that reads a signal calls `useSignals()` first, then reads `.value` in render. Never `.peek()` in render.
- A component declares **only the registry slice it needs** as a local type (`type TTabsBarRegistrySlice = { activateTabAction: TActivateTabAction; ... }`) and types its `registry` prop with that slice. The parent passes the full registry down. This keeps components honest about what they can do and lets them render with a partial registry in isolation.
- `useState` / `useRef` / `useEffect` are for ephemeral view state only: hover, focus, open menu position, DOM measurements. Anything another component might need, or anything that survives a re-mount, goes in the store.
- Pure rendering helpers (markdown parser, rough-line path generation) sit in their own `src/ui/<feature>/` module, know nothing about the store, and are unit-testable without React.
- Rendering of a document is dispatched on `document.kind`. A new document kind means: a new member in the `TDocument` union (`api/types.ts`), a new branch in the viewer pane, a new viewer component, and a new `TFsNodeKind` if it is a new file type.
- Styling is one plain CSS file with BEM-ish class names (`tab`, `tab--active`, `tab__close`) and design tokens as CSS variables on `:root`. No CSS modules, no CSS-in-JS. Follow the CSS rules from `javascript/CLAUDE.md`.
- Text nodes in JSX are written as expressions (`{"Click me"}`), not bare text.

## Conventions

- Type names start with `T` (`TStore`, `TFsNode`, `TAppRegistry`). Factories start with `create` (`createStore`, `createMockApi`, `createRegistry`).
- Type-only imports use `import type`, listed after value imports.
- Comments explain a product rule or a non-obvious constraint (why the browser swallows a middle click, why a subtree collapses with its parent). They do not restate the code.
- Magic numbers are named constants at the top of the file (`MENU_WIDTH_PX`, `TREE_LATENCY_MS`), with units in the name.
- No new dependencies without asking. This package is intentionally dependency-light; keep it that way.

## When changing things

- New feature: start from the store shape (which signals, which `computed`), then actions, then registry, then UI. Not the other way round.
- If a component needs to compute something from several signals, add a `computed` to `store.derived` instead of computing in render.
- If two actions need the same store manipulation, extract a private helper in the domain file; do not call one public action from inside another unless the semantics really are "do that action" (`openNodeAction` on a folder calls `toggleFolderAction` on purpose).
- Keep `main.tsx` as the only place that wires concrete implementations together (`createStore`, `createMockApi`, `createRegistry`, root render, initial `loadTreeAction`).
