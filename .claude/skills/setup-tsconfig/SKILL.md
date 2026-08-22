---
name: setup-tsconfig
description: Write or fix tsconfig.json for a package under javascript/packages — lib, frontend, or node. Use when adding a TypeScript package, when a package hand-rolls its own compilerOptions instead of extending @hw/typescript-config, or when tsc or typed ESLint does not pick up the package files.
---

# Setup tsconfig

The shared presets live in `javascript/packages/infrastructure/typescript-config`:
`base.json`, `node.json`, `preact.json`, `react.json`. A package tsconfig extends one preset and adds
`include`. It never copies compilerOptions.

## 1. Pick the preset

| Project type | Preset | Signs |
| --- | --- | --- |
| Lib, source-only | `base.json` | `"exports": "./exports.ts"`, no build step, consumed by a bundler or `tsx` |
| Lib, built to `dist` | `node.json` + local `outDir` | ships `.d.ts`, has a `build` script |
| Frontend, Preact | `preact.json` | `preact` in dependencies |
| Frontend, React | `react.json` | `react` in dependencies |
| Node app, CLI, server | `node.json` | runs under `node` or `tsx`, uses `node:` imports |

What each preset gives:

- `base.json` — `ESNext` target and module, `moduleResolution: bundler`, `strict`,
  `noUncheckedIndexedAccess`, `verbatimModuleSyntax`, `isolatedModules`, `ES2024` lib only.
  It does not set `noEmit`.
- `node.json` — base plus `NodeNext` module and resolution, `types: ["node"]`,
  `noEmit: false`, `outDir` (see the trap in section 4).
- `preact.json` — base plus `jsx: react-jsx`, `jsxImportSource: preact`, DOM libs,
  `types: ["preact"]`.
- `react.json` — base plus `jsx: react-jsx`, DOM libs, `types: ["react", "react-dom"]`.

## 2. Write the tsconfig

Put it at the package root, next to `package.json`. `include` is required — see the
`exclude` trap in section 4.

Lib, source-only:

```json
{
  "extends": "@hw/typescript-config/base.json",
  "include": [
    "./src/**/*",
    "exports.ts"
  ]
}
```

Lib, built to `dist`:

```json
{
  "extends": "@hw/typescript-config/node.json",
  "compilerOptions": {
    "rootDir": "./src",
    "outDir": "./dist",
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": [
    "./src/**/*"
  ]
}
```

Frontend, Preact:

```json
{
  "extends": "@hw/typescript-config/preact.json",
  "include": [
    "./src/**/*"
  ]
}
```

Frontend, React:

```json
{
  "extends": "@hw/typescript-config/react.json",
  "include": [
    "./src/**/*"
  ]
}
```

Node app:

```json
{
  "extends": "@hw/typescript-config/node.json",
  "include": [
    "./src/**/*"
  ]
}
```

Path aliases are per package. Add both keys, because `base.json` no longer sets `baseUrl`:

```json
"compilerOptions": {
  "baseUrl": ".",
  "paths": {
    "@/*": ["./src/*"]
  }
}
```

## 3. Wire up package.json

- Add the dev dependency: `"@hw/typescript-config": "workspace:*"`.
- For `node.json`, also add `"@types/node"`. The preset sets `types: ["node"]`, and the
  build fails without it. It currently resolves through the hoisted root copy, so declare
  it anyway instead of relying on hoisting.
- For `react.json`, the same applies to `"@types/react"` and `"@types/react-dom"`. The root
  `resolutions` pin them to 19.2.0.
- Set `"type": "module"`. Every preset emits ESM.
- Add a script: `"typecheck": "tsc --noEmit"`. It needs `typescript` in the package
  dependencies, otherwise `yarn typecheck` cannot find the binary.
- Run `yarn` from `javascript/` after changing dependencies.

## 4. Traps

**Inherited relative paths resolve against the preset, not your package.** TypeScript
resolves a relative path against the config file that declared it. Two consequences:

- `exclude: ["node_modules", "dist"]` from `base.json` points at the preset package's own
  folders. A package without `include` therefore compiles its own `node_modules`. Always
  set `include`.
- `outDir: "dist"` from `node.json` points at
  `packages/infrastructure/typescript-config/dist`. Any package that emits must set its own
  `outDir: "./dist"`. Check `tsc --showConfig` if output lands nowhere.

**`base.json` does not set `noEmit`.** A bare `tsc` in a lib or a React frontend writes
`.js` files next to the sources. Typecheck with `tsc --noEmit`, or set `"noEmit": true`
in the package config.

**`node.json` uses NodeNext resolution.** Relative imports need the `.js` extension
(`import { a } from "./a.js"`) — error TS2835 otherwise. The other presets use
bundler resolution, where extensionless imports are correct.

**`verbatimModuleSyntax` is on.** Type-only imports must be written `import type { X }`.

**A local `files` key replaces the inherited one.** `base.json` declares
`files: ["./@types/index.d.ts"]`. Do not add a `files` key for ambient types; put the
`.d.ts` under `src/` and let `include` pick it up.

**Typed ESLint reads this tsconfig.** `@hw/eslint-config` passes the package
`tsconfig.json` as the parser project. Every linted file must be covered by `include`, or
the parser errors on it. Test and spec files are usually listed in the eslint `ignores`
instead.

## 5. Verify

Run from `javascript/`, so the hoisted binary is used:

```bash
node_modules/.bin/tsc --noEmit -p packages/<path>/tsconfig.json
```

For a package that builds, also run it without `--noEmit` and confirm the output landed in
the package's own `dist`:

```bash
node_modules/.bin/tsc -p packages/<path>/tsconfig.json
find packages/<path>/dist -type f
```

If the package has a lint setup, run `yarn workspace @hw/<name> lint` too. It proves that
`include` covers the files ESLint parses.
