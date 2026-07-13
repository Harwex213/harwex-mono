# ai-slop

This folder contains AI-generated prototype packages — a throwaway sandbox.

Do **not** investigate or mirror conventions, patterns, or architecture from
anywhere else — not the wider monorepo, and **not the sibling prototype folders
here**. Do not read other prototypes to infer dependency versions, setup, or
structure. Everything you need is in this file. Treat each folder as isolated and
greenfield — pick whatever stack/structure fits the task, and use the latest
stable version of any dependency. The only hard constraint is staying a valid
Yarn workspace member, because Yarn drives the whole monorepo.

Skip the "let me check existing conventions first" step entirely. Just build.

## package.json rules

Yarn 4.1.1 (Berry) owns dependency management (`packageManager: yarn@4.1.1`,
`nodeLinker: node-modules`). Every prototype needs a `package.json` that:

- `"name": "@hw/<kebab-name>"` — unique across the monorepo.
- `"private": true` — nothing here is ever published.
- `"type": "module"` — ESM only.
- **Pin exact versions** — no `^`/`~`. The repo sets `defaultSemverRangePrefix: ""`.
- Reference other workspace packages with `"workspace:*"` (e.g. `"@hw/utils": "workspace:*"`),
  never a file path or a registry version.
- This folder is matched by the root `packages/**/*` workspace glob — no extra
  registration needed, but run `yarn` after adding/renaming a package so the lockfile updates.

Canonical starter — copy this, don't go looking for an example:

```json
{
  "name": "@hw/<kebab-name>",
  "private": true,
  "type": "module",
  "version": "0.0.0",
  "scripts": {}
}
```

Add exact-pinned deps as needed. Get the current version from the registry
(`yarn npm info <pkg> version`) or Context7 — never by copying a sibling.

## Commands

- Install / sync lockfile: `yarn` (from anywhere in the repo).
- Never use `npm` or `pnpm`, and never hand-edit `yarn.lock`.
- Run a package script from its folder: `yarn <script>` (e.g. `yarn start`).
