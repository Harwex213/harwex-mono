# frontend-plain-architecture

A one-page live casino aggregator, built to force a layered frontend where every
UI state is reachable without a browser interaction. The point of the app is the
architecture, and the proof of the architecture is `tests/`: 21 tests hold 24
screenshot baselines, and most of those tests are three lines long.

Stack: React 19, TypeScript, Preact signals, rspack, Playwright.

## Layers

Arrows point the only way a dependency is allowed to go.

```
ui ──▶ store        (reads signals)
ui ──▶ registry     (calls actions)
registry ──▶ domain ──▶ store
registry ──▶ api    (empty for now)
model ◀── everyone  (types and pure functions)
```

| Layer | Folder | What it is | What it may not do |
| --- | --- | --- | --- |
| ui | `src/ui/` | React components | import a domain function, hold state, run a rule |
| store | `src/store/` | `signal` and `computed` | know about React or the api |
| domain registry | `src/registry/` | plain object of store-bound actions | contain logic |
| domain | `src/domain/` | `(store, input) => void` functions | import React or the api |
| api | `src/api/` | I/O, unimplemented | — |
| model | `src/model/` | entity types, pure helpers | import any other layer |
| fixtures | `src/fixtures/` | the seed lobby, until the api exists | — |
| testing | `src/testing/` | named scenarios | ship in the app entry |

Two supporting layers are not in the original list: `model` holds the types and
pure functions that both the store and the domain need, and `fixtures` holds the
seed data that the api layer will replace.

### store

`createStore()` builds every signal inside a function, so nothing is created at
module scope. Two stores never share state, which is why every test can have its
own. Writable signals hold the state; computed signals hold everything derived
from it — `visibleTables`, `stats`, `providerFacets`, `categoryCounts`. No
component keeps state of its own, and `useState` appears nowhere.

### domain

Every domain function has the same shape:

```ts
function joinTable(store: Store, tableId: TableId): void;
```

It reads signals, decides, and writes signals back. It never touches React, and
it never returns a value. `src/domain/index.ts` collects all fourteen of them in
one record — that record is the complete list of what a user can do.

### domain registry

`createRegistry({ store, api })` walks that record and binds the store to each
function. The result is a plain object:

```ts
registry.setCategory("blackjack");
registry.joinTable("blackjack-vip-3");
```

The type is derived from the domain record, so a new domain function appears on
the registry with no extra wiring. The registry is also the composition root: it
is the only layer that will know about both the api and the domain, so when
`src/api/` lands, it awaits the call and hands the payload to a domain function.

### ui

`AppProviders` puts the store and the registry into two React contexts.
`useStore()` and `useRegistry()` read them. A component that reads `.value` calls
`useSignals()` first; a component that only takes props does not — see
`StatusPill.tsx`.

The UI does not repeat domain rules. "Take a seat" stays clickable on a full
table, and the domain answers with an error notice. That keeps one rule in one
place, and it is why the refusal paths are themselves screenshot states.

## Why screenshot tests are cheap here

A test needs an app in a given state. Because the UI takes its store from
context, `src/harness.tsx` is the app entry with one line added: a named scenario
runs against a fresh store before React mounts.

```ts
const store = createStore(createLobbySeed());
const registry = createRegistry({ store, api: createApi() });
scenarios[name].setup?.({ store, registry });
```

So a test is:

```ts
test("table-joined", async ({ page }) => {
  await openScenario(page, "table-joined");
  await expect(page).toHaveScreenshot("table-joined.png");
});
```

No network stub, no clicking a path to the state, no component-level rig. A
scenario reaches its state by calling registry functions, so a baseline can never
show a state the app cannot reach.

Determinism comes from four places:

- The seed is a fixture, so the lobby never changes between runs.
- `data-screenshot="true"` on `<html>` kills every animation, transition and
  caret. `harness.html` ships with it; `helpers.ts` sets it on the app page.
- `ReadyFlag` sets `data-app-ready` after React commits and the fonts load.
  Tests wait for that attribute, never for a timeout.
- `playwright.config.ts` pins the viewport, locale, timezone and scale factor.

`tests/app.spec.ts` covers the other direction. It clicks through the real app
entry and asserts the loop end to end: a click calls a registry function, the
domain function mutates a signal, and the computed signals repaint the page.

## Commands

```bash
yarn dev            # rspack dev server on http://localhost:8130
                    #   /              the app
                    #   /harness.html?scenario=table-joined
yarn build          # production build into dist/
yarn typecheck      # app sources, then tests and the playwright config
yarn test           # screenshot tests against the committed baselines
yarn test:update    # rewrite the baselines
yarn test:report    # open the last HTML report
```

`yarn test` starts the dev server itself, and reuses one that is already running.

## Adding a scenario

1. Add the name to `SCENARIO_NAMES` in `src/testing/scenario-names.ts`.
2. Add the entry to `scenarios` in `src/testing/scenarios.ts`. The record is
   typed by that name union, so a missing entry is a type error.
3. Run `yarn test:update`, then look at the new PNG before committing it.

`tests/scenarios.spec.ts` loops over the names, so no test file changes.

## Baselines

Baselines live in `tests/__screenshots__/<platform>/<spec>/<name>.png` and were
recorded on darwin/arm64. Font rendering differs per platform, so a Linux CI run
needs its own set under `tests/__screenshots__/linux/`.

Playwright is pinned to 1.61.1 because that is the version whose Chromium
(revision 1228) is already installed locally.

## What the api layer will change

`src/api/index.ts` fixes the shape of the I/O and rejects every call. When it is
implemented, three things change and nothing else: the app entry loads the lobby
through it, the registry awaits it, and `src/fixtures/lobby.ts` becomes test-only
data. The store, the domain and the UI stay as they are.
