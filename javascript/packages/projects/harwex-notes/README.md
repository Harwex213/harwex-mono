# @hw/harwex-notes

A local web workbench over one folder on disk. The left panel is a JetBrains-style
lazy file tree; the right side is a tab bar over an editor pane that changes its
surface to match the file it opened.

| Extension | Surface | Save |
| --- | --- | --- |
| `.excalidraw` | Excalidraw canvas | autosave, 800 ms debounce |
| `.md` `.markdown` | CodeMirror 6 + rendered preview | `Cmd/Ctrl+S` |
| `.txt`, anything else | CodeMirror 6, no language mode | `Cmd/Ctrl+S` |
| `.html` `.htm` | sandboxed `<iframe srcdoc>`, source toggle | `Cmd/Ctrl+S` |

No database, no auth, no cloud. The filesystem is the model.

## Run it

```bash
cd javascript
yarn install
cd packages/projects/harwex-notes
yarn dev
```

`yarn dev` starts both halves and prefixes their output. The API answers on
`127.0.0.1:5788`; the web dev server takes a free port and prints it, and proxies
`/trpc` to the API.

| Script | What it does |
| --- | --- |
| `yarn dev` | API and web dev server together |
| `yarn dev:api` | just the tRPC server (`node server/index.ts`) |
| `yarn dev:web` | just the rspack dev server |
| `yarn build` | production bundle into `dist/` |
| `yarn typecheck` | `tsc --noEmit` over the browser and the server project |
| `yarn test` | `node --test` over the path containment rules |

## Where the notes root comes from

`./notes-root` inside this package, which holds committed sample content so the
app has something to show on a fresh clone. Point it somewhere else with an
absolute path:

```bash
NOTES_ROOT=/Users/me/notes yarn dev
```

Every path that crosses the wire is relative to that root and POSIX-separated.
The server is the only place that ever sees an absolute path, and
`server/workspace.ts` is the only thing between it and the rest of the disk: zod
rejects `..` segments, absolute paths, and NUL, then `resolveInRoot` compares
real paths so a symlink cannot point out of the root either. That function has
its own test file.

## Layout

```
docs/plan.html          the build plan this was written from
index.html              rspack template; sets EXCALIDRAW_ASSET_PATH
rspack.config.mjs       web bundle, font copy, /trpc proxy
scripts/dev.mjs         runs the API and the web dev server together
shared/                 zod contract and the extension -> editor mapping
server/                 standalone tRPC server over one folder
src/                    React 19 + @preact/signals-react frontend
notes-root/             committed sample content, one file of each kind
```

## Not in the prototype

Create, rename, delete, and move in the tree; filesystem watching and
external-change push; search; git; multi-root workspaces; embedded images in
Excalidraw scenes; relative asset resolution inside the HTML preview (the frame
gets `allow-scripts` and nothing else, so it sits on an opaque origin).
