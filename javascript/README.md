### Monorepo via Yarn workspaces

- в `.yarn` лежит используемый релиз yarn'а + кэш
- в `.yarnrc.yml` содержится конфиг yarn'а

### Useful scripts

#### `:static`

Поднимает статический сервер ([http-server](https://github.com/http-party/http-server)) в текущей директории (`$INIT_CWD`) на случайном свободном порту (`-p 0`).

Скрипт глобальный (имя с `:` — вызывается из любого workspace):

```bash
cd packages/some-app/dist
yarn :static
```

Use case: быстро отдать статику (билд, html-демо) без своего dev-сервера.
