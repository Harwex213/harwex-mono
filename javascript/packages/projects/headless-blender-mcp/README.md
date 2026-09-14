# @hw/headless-blender-mcp

A headless Blender behind the Blender MCP tool set: a library for a host that
embeds Blender, and a `stdio` MCP server for Claude Code and Codex.

Blender runs as
`blender --online-mode --background <file.blend> --command blender_mcp --port N`
— the [blender_mcp](https://projects.blender.org/lab/blender_mcp) add-on's own
background server. The tools carry upstream's names and run upstream's
tool-code, so an agent sees the tool set it already knows. The tool-code, the
RST documentation and docutils are vendored under `vendor/blender-mcp`; see the
README there.

The server is not tied to a `.blend`. It starts with no file open, and the
agent names one with `open_blend_file`, so a single registration serves every
project.

## Requirements

- Blender with the `blender_mcp` add-on enabled. Point at the executable with
  `--blender`, or `HEADLESS_BLENDER_BIN`; on macOS the usual place is found on
  its own.
- A `python3` on PATH for the three documentation tools, or
  `HEADLESS_BLENDER_PYTHON`.
- `yarn workspace @hw/headless-blender-mcp build` once, so `dist/` exists. The
  MCP configs point at `dist/cli/main.js`.

## The CLI

```
headless-blender serve   [--blend <file.blend>] [--blender <path>] [--python <path>] [--no-create]
headless-blender config  <claude|codex> [--blend <file.blend>] [--name <name>]
headless-blender install [--dir <bin-dir>] [--force]
headless-blender skill   [--path]
```

`serve` speaks MCP over stdin and stdout. Stdout carries nothing but the
protocol: notices go to stderr, and Blender's own output is collected, not
inherited. `--blend` pins the server to one file and opens it at startup —
writing a starter scene when it is missing. Without it no Blender runs until
the agent calls `open_blend_file`.

`install` writes a `headless-blender` launcher into the first writable
directory on PATH — `~/.local/bin` when there is a choice — and prints where it
landed. The launcher is a two-line shell script that runs the built CLI with
the Node that installed it, because an MCP host started from the Dock has a
short PATH and a Node installed by nvm is not on it.

`skill` prints `skills/blender-mcp/SKILL.md`. It holds only what the tool
schemas cannot say: how a background Blender differs from one in a window, and
which calls fail there. Feed it to the agent before it starts modelling.

During development, `yarn workspace @hw/headless-blender-mcp cli …` runs the
same commands through `tsx` without a build.

## Registering it

Claude Code, into `.mcp.json` or `~/.claude.json`:

```bash
headless-blender config claude          # the `mcpServers` block
headless-blender config claude --add    # the `claude mcp add-json` line
```

Codex, into `~/.codex/config.toml`:

```bash
headless-blender config codex >> ~/.codex/config.toml
```

Both write `node <abs>/dist/cli/main.js serve`, which needs nothing on PATH.
Pass `--command headless-blender` to use the installed launcher instead.

Pass `--blend <file.blend>` to pin one server to one file. Register such a
server once per file, each under its own `--name`.

## The library

```ts
import { claudeCodeMcpConfig, codexMcpToml, createSession, serveStdio } from "@hw/headless-blender-mcp";

// The configs, without the CLI.
const config = claudeCodeMcpConfig({});                                  // any file, opened later
const toml = codexMcpToml({ blendPath: "/models/chair.blend", serverName: "chair" });

// One background Blender, its tools, and the scene work around them.
const session = createSession({});
await session.start();
await session.open("/models/chair.blend");
await session.execute("import bpy\nbpy.ops.mesh.primitive_cube_add()\nresult = {}\n", true);
const outline = await session.outline();
const glb = await session.exportModel();
await session.save();
await session.stop();

// Or hand the same tools to a client over stdio.
await serveStdio(createSession({}));
```

`session.tools()` hands back the tool definitions, so a host that already has
an MCP server — or no MCP at all — can register or call them itself.
`session.open` closes the file the session held, so one session never leaves
more than one Blender behind.

## The tools

The upstream Blender MCP set, against the open file:

- `execute_blender_code` — Python in the live Blender, `result` comes back.
- `get_objects_summary`, `get_object_detail_summary`.
- `get_blendfile_summary_{datablocks,path_info,missing_files,of_linked_libraries,usage_guess}`.
- `render_thumbnail_to_path`, `render_viewport_to_path` — the picture is
  returned to the model as well as written.
- `get_python_api_docs`, `search_api_docs`, `search_manual_docs` — the bundled
  RST, searched by upstream's own Python.
- `execute_blender_code_for_cli` and a `_for_cli` variant of every summary —
  a fresh `blender --background` on some other file. When that file is the one
  the session holds open with unsaved changes, a copy is saved and used, so the
  second Blender sees what the agent sees.

Two tools are not upstream's:

- `open_blend_file` — opens a `.blend` and makes it the file every other tool
  works on. Upstream has a Blender with a file already in it; here the agent
  chooses.
- `save_blend_file` — there is no window, so nothing writes the file on its
  own.

Every live tool answers `No .blend is open` until `open_blend_file` runs. The
documentation tools and the `_for_cli` tools do not need one and work from the
first call.

Not available in background mode: the screenshot and `jump_to_*` tools, which
need a UI, and deferred completion through `check_is_finished`.

## Unsaved changes

`bpy.data.is_dirty` cannot be trusted: a `--background` Blender never maintains
it. The session tracks unsaved changes itself — anything that runs code marks
the scene dirty, `save_blend_file` clears it, opening a file clears it — and
that flag is what decides whether a `_for_cli` call gets a synced copy.
