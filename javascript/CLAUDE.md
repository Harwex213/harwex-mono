### Code style conventions

#### Javascript conventions

- Always end statements with `;`
- No single-line `if` statements: always braces, body on its own line (`if (!unit) return;` → `if (!unit) {\n  return;\n}`). Same for `else` and loops.
- No single-quote string literal
- Export the file's public API via one grouped named export at the end (`export { myFunc1, myFunc2 };`) instead of inline `export` on declarations. Private helpers stay unexported.

#### CSS conventions

- No single-line CSS rules: one declaration per line, closing brace on its own line (`.bf a:hover { color: var(--text-primary); }` → `.bf a:hover {\n  color: var(--text-primary);\n}`). Applies wherever CSS lives.

### Development workflow

#### `yarn :static` script

Поднимает статический сервер ([http-server](https://github.com/http-party/http-server)) в текущей директории (`$INIT_CWD`) на случайном свободном порту (`-p 0`).

Скрипт глобальный (имя с `:` — вызывается из любого workspace):

```bash
cd packages/some-app/dist
yarn :static
```

Use case: to run local dev server for frontend project which don't rely on built-in bundler dev server.
