### Code style conventions

#### Javascript conventions

- Always end statements with `;`
- No single-line `if` statements: always braces, body on its own line (`if (!unit) return;` → `if (!unit) {\n  return;\n}`). Same for `else` and loops.
- No single-quote string literal
- Export the file's public API via one grouped named export at the end (`export { myFunc1, myFunc2 };`) instead of inline `export` on declarations. Private helpers stay unexported.

#### CSS conventions

- No single-line CSS rules: one declaration per line, closing brace on its own line (`.bf a:hover { color: var(--text-primary); }` → `.bf a:hover {\n  color: var(--text-primary);\n}`). Applies wherever CSS lives.

### Development workflow conventions

#### Frontend App Default Tech Stack

If you need to setup new frontend app use this default tech stack until other being mentioned:
- react
- rspack
- typescript
- preact/signals

### Frontend App Default architecture

If you need to setup new frontend app use this default architecture until other being mentioned:
Package: `@hw/frontend-plain-architecture-v2`. Relative path: `javascript/packages/lab/frontend-plain-architecture`.

#### Typescript

- Use `setup-tsconfig` skill if you need to create or change typescript config for the particular package

#### `yarn :static` script

Поднимает статический сервер ([http-server](https://github.com/http-party/http-server)) в текущей директории (`$INIT_CWD`) на случайном свободном порту (`-p 0`).

Скрипт глобальный (имя с `:` — вызывается из любого workspace):

```bash
cd packages/some-app/dist
yarn :static
```

Use case: to run local dev server for frontend project which don't rely on built-in bundler dev server.

#### Deploying a site

A frontend package goes to the VPS when its `package.json` has `"hwDeploy": { "route": "/some-site" }`. The site is then served under that path, so its bundle must load files by relative paths (rspack's default `publicPath: "auto"` does). `@hw/deploy` (`packages/infrastructure/deploy`) finds such packages, builds them with their workspace dependencies, and ships all of them in one nginx image:

```bash
yarn workspace @hw/deploy scan     # list the sites and their routes
yarn workspace @hw/deploy bundle   # build them into out/html/
DEPLOY_HOST=user@host yarn workspace @hw/deploy deploy
```
