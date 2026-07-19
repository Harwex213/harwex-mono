### Code style

- No single-line `if` statements: always braces, body on its own line
  (`if (!unit) return;` → `if (!unit) {\n  return;\n}`). Same for `else` and loops.

### Development workflow

#### `yarn :static` script

Поднимает статический сервер ([http-server](https://github.com/http-party/http-server)) в текущей директории (`$INIT_CWD`) на случайном свободном порту (`-p 0`).

Скрипт глобальный (имя с `:` — вызывается из любого workspace):

```bash
cd packages/some-app/dist
yarn :static
```

Use case: to run local dev server for frontend project which don't rely on built-in bundler dev server.
