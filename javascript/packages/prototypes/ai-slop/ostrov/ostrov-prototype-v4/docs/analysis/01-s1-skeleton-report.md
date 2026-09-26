# S1 — skeleton and build pipeline

Package `@hw/ostrov-prototype-v4`, worktree `ostrov-prototype-01`. The build pipeline is green and the hash
router switches between four placeholder pages. Everything below is the contract the later subtasks build on.

## 1. Files created

```
ostrov-prototype-v4/
  package.json
  tsconfig.json
  rspack.config.mjs
  index.html
  README.md
  docs/analysis/01-s1-skeleton-report.md      (this file)
  src/main.tsx
  src/types/assets.d.ts
  src/store/store.ts
  src/store/route-state.ts
  src/domain/registry.ts
  src/domain/registry-creator.ts
  src/domain/route-actions.ts
  src/core/types.ts
  src/core/exports.ts
  src/ui/app.tsx
  src/ui/app.css
  src/ui/palette.ts
  src/ui/pages/main-menu-page.tsx
  src/ui/pages/island-page.tsx
  src/ui/pages/world-page.tsx
  src/ui/pages/battle-page.tsx
```

Nothing else was created. `docs/01-spec.json` and `docs/01-spec-images/` were not touched.

## 2. Commands and exit codes

All run with cwd `javascript/`.

| command | exit code | result |
| --- | --- | --- |
| `yarn` (first attempt) | 1 | `YN0018: tsx@npm:4.20.6: The remote archive doesn't match the expected checksum` — see §6 |
| `yarn` (after the cache repair) | 0 | `node_modules/@hw/ostrov-prototype-v4` is a symlink to the package; `yarn.lock` gained the `@hw/ostrov-prototype-v4@workspace:…` entry (+46 lines) |
| `yarn workspace @hw/ostrov-prototype-v4 typecheck` | 0 | no diagnostics |
| `node_modules/.bin/tsc --noEmit -p packages/prototypes/ai-slop/ostrov/ostrov-prototype-v4/tsconfig.json` | 0 | the tsconfig is correct independently of the script |
| `yarn workspace @hw/ostrov-prototype-v4 build` | 0 | `dist/index.html`, `dist/main.4c1834651c627c44.js` (196 KB), `dist/main.66d0db653e65c894.css` (1.2 KB); whole `dist/` 204 KB |

`dist/` was deleted after the check, so the next `build` starts clean.

Final `git status --short`:

```
 M javascript/.yarn/cache/tsx-npm-4.20.6-78231068b5-16396df25c.zip
 M javascript/.yarn/install-state.gz
 M javascript/yarn.lock
?? .claude/skills/coordinator/
?? javascript/packages/prototypes/ai-slop/ostrov/ostrov-prototype-v4/
?? javascript/packages/prototypes/ai-slop/ostrov/ostrov-prototype-v5/
```

`.claude/skills/coordinator/` and `ostrov-prototype-v5/` were already untracked before S1 started.

## 3. Store shape

`src/store/store.ts`:

```ts
type TStore = {
  readonly route: TRouteState;
};

const createStore = (): TStore => {
  return {
    route: createRouteState(),
  };
};
```

`TStore` is written by hand, not inferred, so a slice that does not exist yet cannot be read by accident.
The file carries the comment `S3 adds game and ui, S5 adds anim, and derived arrives with them`.

`src/store/route-state.ts`:

```ts
type TPage = "menu" | "island" | "world" | "battle";

type TRoute = {
  readonly page: TPage;
  readonly viewedPlayerId: string | null;
};

type TRouteState = {
  readonly page: Signal<TPage>;
  readonly viewedPlayerId: Signal<string | null>;
};
```

It also exports the two pure route helpers `parseHash(hash: string): TRoute` and
`hashFor(page: TPage, playerId: string | null): string`, which are exact inverses.

## 4. Registry shape

`src/domain/registry.ts`:

```ts
type TNavigateAction = (page: TPage, playerId?: string | null) => void;

type TAppRegistry = {
  navigate: TNavigateAction;
};
```

`src/domain/registry-creator.ts` binds through the same `func.bind(null, store)` reduce as the template.
`src/domain/route-actions.ts` holds `navigateAction(store, page, playerId = null)`: it writes both signals and,
only when the hash actually differs, `window.location.hash`. `viewedPlayerId` is forced to `null` on any page
other than `island`.

Each page component declares its own registry slice type (`TIslandPageRegistrySlice` and so on) and types its
`registry` prop with that slice, as the harwex-notes conventions require.

## 5. Route table

| hash | `route.page` | `route.viewedPlayerId` |
| --- | --- | --- |
| `#/` or empty or unknown | `menu` | `null` |
| `#/island` | `island` | `null` |
| `#/island/:playerId` | `island` | `playerId` |
| `#/world` | `world` | `null` |
| `#/battle` | `battle` | `null` |

`main.tsx` installs exactly one `hashchange` listener. The listener parses the hash and calls
`registry.navigate(...)`. Writing back the identical hash fires no further `hashchange`, so the loop terminates;
an unknown hash falls back to `#/` in one extra pass. `app.tsx` picks a page from `store.route.page.value`.

## 6. Deviations from the plan

1. **A corrupt cache archive blocked `yarn`.** `javascript/.yarn/cache/tsx-npm-4.20.6-78231068b5-16396df25c.zip`
   was a 131-byte **Git LFS pointer**, not a zip, committed in `a0a00012 step`. `javascript/.gitattributes`
   excludes `javascript/.yarn/cache/**` from LFS, so nothing ever smudged it back into a real archive and every
   fetch of `tsx@4.20.6` failed with `YN0018`. Fix: delete the file and let `yarn` re-download it from the
   registry. The cache entry is now a real 169 KB zip matching the `yarn.lock` checksum. This is the one change
   outside the package besides `yarn.lock`, plus `.yarn/install-state.gz`, which yarn rewrites on every install.
   It repairs a pre-existing repository defect; without it no install in this worktree can succeed.
2. **Stub parameters carry a leading underscore.** `base.json` sets `noUnusedParameters: true`, so
   `createRng(seed: number)` with a throwing body does not compile. Every stub in `src/core/exports.ts` therefore
   writes `_seed`, `_island` and so on. The types are exactly the ones specified. S2 drops the underscore when it
   starts using a parameter. This is noted in the file header.
3. **Three constants in `src/core/exports.ts` hold real data instead of an empty cast.** `HEX_SIZE_PX` is `56`,
   `BUILDING_ORDER` and `TECH_ORDER` are the orders named in the plan (§2 of the contract, §3.3 and §3.5 of the
   plan). They are fixed data, not something S2 has to derive. `INITIAL_RESOURCES`, `BIOMES`, `BUILDINGS` and
   `TECHS` are empty casts, since their contents are the spec yield tables that S2 owns.
4. **`registry-creator.ts` casts through `unknown`.** `Record<string, Function>` and `TAppRegistry` do not
   overlap enough for a direct assertion once the registry has a single entry, so the return is
   `registry as unknown as TAppRegistry`. The template got away with a direct cast only because it has eight
   entries.
5. **No dev-hook line in `main.tsx`.** Plan §2 says to add the `installDevHook` call, but `src/dev/dev-hook.ts`
   belongs to S8 and does not exist. S8 adds both the file and the one call at the end of `main()`.
6. **`tsconfig.json` keeps `include: ["./src/**/*"]`.** `scripts/probe.ts` is not typechecked. Plan §2 allows
   either; leaving the probe out keeps `typecheck` green while `scripts/` is still empty. S8 may add
   `"./scripts/**/*"` when it writes the probe.
7. **`package.json` declares `probe` and `serve` before their inputs exist.** `probe` runs
   `tsx scripts/probe.ts` (S8 writes the script) and `serve` runs `python3 -m http.server 8401 --directory dist`
   (needs a `build` first). Both are in the plan; neither is runnable yet.

## 7. Notes for the next implementers

- `src/core/exports.ts` is the only file the layers above may import from inside `src/core/`. S2 moves the bodies
  into the per-topic files and turns `exports.ts` into re-exports; the names and signatures must not change.
- Colours live twice on purpose: CSS variables on `:root` in `src/ui/app.css` and the same values as TS constants
  in `src/ui/palette.ts` (`PALETTE`, `PLAYER_COLOURS`) for the canvas layers. Change both together.
- `src/types/assets.d.ts` declares `*.png`, `*.webp` and `*.svg` as URL string modules; the matching rspack rule
  is `{ test: /\.(png|jpe?g|webp|svg)$/i, type: "asset/resource" }`.
- `devServer.port: 0` stays, with its comment. Port 8401 is only for the probe's `python3 -m http.server`.
