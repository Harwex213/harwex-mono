# modelgen harness

An Electron app for building 3D models with an agent. Every tab is one model:
one `.blend` file on disk, one headless Blender running behind it, and one
agent session that models in that Blender through the Blender MCP tool set.
The agent is Claude Code or Codex, chosen per model. The tab shows the model
live in a 3D viewer next to the chat.

The specs this was built from are `docs/01-spec.json` and
`docs/02-improvement/02-spec.json`.

```bash
yarn install
yarn workspace @hw/modelgen-harness dev
```

`dev` runs three processes and prefixes their output: `tsc` watching the
Electron side, `rspack` serving the renderer on `:5762`, and `app` — Electron,
started once the other two have something to load.
`yarn workspace @hw/modelgen-harness start` builds and runs the same app
without the watchers.

## What it needs

- **Blender 5.1** with the [Blender MCP](https://projects.blender.org/lab/blender_mcp)
  extension installed and enabled. The app starts
  `blender --online-mode --background <file.blend> --command blender_mcp --port N`
  per tab, which is the extension's own background server.
- **A `python3` on the PATH**, for the three documentation tools. Nothing has
  to be installed into it: the slice of the blender_mcp repo those tools need —
  the tool modules, their 25 MB of RST docs and docutils — ships under
  `vendor/blender-mcp/`, together with the tool-code the other tools run inside
  Blender. `vendor/blender-mcp/README.md` says where it came from and how to
  refresh it. Set `MODELGEN_PYTHON` to choose another interpreter.
- **A login for at least one of the two agents.** Claude Code runs on the
  [Claude Agent SDK](https://platform.claude.com/docs/en/api/agent-sdk/overview),
  which drives the `claude` CLI with the login that CLI holds. Codex runs on
  the [Codex SDK](https://developers.openai.com/codex/sdk), which drives the
  `codex` CLI with the ChatGPT account it is signed into (`codex login`).
  Neither uses an API key; the subscription behind the CLI is what gets used.

Paths are set in the settings dialog (the gear in the tab bar) and stored in
the app's SQLite. The defaults come from `BLENDER_PATH` (else
`/Applications/Blender.app/Contents/MacOS/Blender`), `CODEX_PATH` (else the
`codex` bundled with the SDK) and `CLAUDE_CODE_PATH` (else the `claude` found
on this machine — `~/.claude/local/claude`, then the PATH — else the one
bundled with the SDK).

The model and the reasoning effort are not settings either: they belong to one
file, so they sit above the composer input and are kept with the tab. Default
means whatever the agent's own config says, and a tab reopened later comes back
with the pair it was given. Each agent has its own model list; a tab holding a
slug that is not in its agent's list keeps it and marks it, so a model retired
from the list, or released after it was written, is never swapped out behind
your back.

## The viewer

The left half of a workspace renders the glTF the main process exports from the
tab's Blender after every code block. Two panels sit over it:

- **Objects** — the collection and object tree, read from Blender with
  `get_objects_summary`, so it is the tree Blender's own outliner draws:
  nested collections, object types, what is hidden or excluded. Lights and
  cameras are listed but cannot be selected, because the export leaves them
  out. Pressing a mesh selects it in the viewer and brings it into view.
- **Materials** — the scene's materials, one row each however many meshes
  carry them, with sliders that only touch the viewer's copy.

`Screenshot` puts the whole view into the message, `Region` a rectangle of it.
`W`, `R` and `S` switch the gizmo between move, rotate and scale.

## Tabs

**+** opens the new-model dialog: type a path, or pick one with the system
chooser — a new file name, or an existing `.blend` to keep working on. A
missing file is created from Blender's startup scene without the cube, so a
camera and a light are already there for previews. `~` and a missing
`.blend` extension are filled in.

Opening a tab starts its Blender. Tabs run side by side: every tab has its own
process and its own port, and agents in different tabs work at the same time.

**×** closes a tab, but only when the file is saved and no run is in flight;
otherwise the reason shows as a notice. The header has **Save**, and the
agent is told to save at the end of every task. Open tabs are written to
SQLite and come back on the next start, each with its Blender and its chat.

If Electron dies without stopping its Blenders, each Blender notices its
parent is gone and exits on its own.

## The workspace

Left: the model. Right: the chat, with the composer at the bottom.

The right half has three states:

- **Clear** — no agent yet, and nothing but the choice of one: Claude Code or
  Codex. The choice belongs to the model, so it is asked once per tab.
- **Empty** — the agent is chosen, the conversation has not started. The model
  and the effort are open, above the input.
- **In progress** — the conversation has started. The agent, the model and the
  effort are fixed: the session the next message resumes was built by that
  three, and swapping one halfway would change what the agent is. The header
  counts the tokens the conversation has spent, **Clear** starts a clean
  session on the same agent, and **Close** ends the conversation and hands the
  choice of agent back.

The first message describes the model. Later messages ask for changes; the
conversation continues, so "make it taller" means what it should. The
composer is multi-line (Cmd/Ctrl + Enter sends) and takes pictures: drop
them, paste them, choose them with **+ image**, or press **Screenshot** in the
viewer to put the current view into the message. Pictures are saved next to
the `.blend` in a `<name>.refs/` directory — the agent's working directory —
so the agent can load them as textures.

Each run prints two messages. The **progress** message is rewritten while
the agent works: the latest reasoning summary on top, then one line per tool
call (name, its first line, ✓ or ✗). The **final** message is the agent's
answer, with the preview it rendered beside it. Previews are stored in
SQLite, not on disk; a run that ends without one gets a preview rendered by
the app. Pictures the agent generated with `image_gen` during the turn show in
the same message.

## The 3D viewer

A three.js view of a glTF that the main process exports from the tab's
Blender on open, after every code block the agent runs, and after Save.

- wheel zooms, left-drag orbits, right-drag pans.
- click a mesh to select it; the gizmo appears. **Move**, **Rotate**,
  **Scale** (or G, R, S) switch its mode; Esc deselects.
- **Material slots** lists every mesh with its materials: colour, metalness,
  roughness, opacity, wireframe. Pressing a mesh name selects it.
- **Frame** brings the whole model into view.
- Nothing done in the viewer reaches the `.blend`. Gizmo moves and material
  edits are try-outs in the viewer's copy. **Reset** loads the model again as
  the file has it.

## The agents

Every tab is one session of one agent; the session id lives in SQLite next to
the agent that owns it, and the next message resumes it, so "make it taller"
means what it should. Everything around the agent — the MCP tools, the skills,
the chat messages, the preview, the token count — is the same either way.
`electron/agent/driver.ts` is the line between the two: the runner drives that
interface, and `codex.ts` and `claude.ts` are all that differ.

Both agents reach the web: they search it, fetch pages and download files into
the working directory, which is how a CC0 texture set from ambientCG or an
HDRI gets into a model. Both also have a way to make a picture when nothing
real fits — Codex its built-in `image_gen`, Claude Code the `magnific` MCP
server — and the skills say to reach for it last, not first.

Codex only reaches outside tools through MCP, so the harness *is* an MCP
server: an HTTP endpoint on the loopback interface with one unguessable path
per run, handed to Codex through its config as the server `modelgen`. The tools
carry the Blender MCP names and do what those tools do:

| Tool | How the harness runs it |
| --- | --- |
| `execute_blender_code` | sent to the tab's Blender over the add-on's TCP protocol |
| `get_objects_summary`, `get_object_detail_summary`, `get_blendfile_summary_*` | the vendored `*_toolcode.py` files, sent the way the MCP server sends them |
| `render_thumbnail_to_path`, `render_viewport_to_path` | tool-code as above; the PNG is stored as the preview and returned to the agent as an image |
| `search_api_docs`, `search_manual_docs`, `get_python_api_docs` | the upstream tool functions, run in a short-lived `python3` on the vendored RST |
| `*_for_cli` | a fresh `blender --background`, as upstream's `blender_cli.py` does |

Claude Code holds the same `modelgen` server over the same HTTP endpoint, plus
`magnific`, and the built-in tools a run needs: `Bash`, `Read`, `Write`,
`Edit`, `Glob`, `Grep`, `WebFetch`, `WebSearch`. It reads no settings from the
machine, so the user's own global `CLAUDE.md`, written for their code, stays
out of a modelling run.

A headless turn has nobody to answer a permission prompt, which is a reason to
decide in advance, not a reason to wave everything through. The run gets:

- `permissionMode: "auto"` — what the allowlist does not cover goes to a
  classifier rather than being granted. Deny-by-default (`dontAsk`) was tried
  first and is stricter, but it also refused the texture downloads the skills
  ask for, so the classifier is what keeps a run from dead-ending on a host
  nobody listed.
- The OS sandbox, with Bash inside it. Writes land in the working directory
  and nowhere else: `echo hi > /tmp/x` comes back `operation not permitted`.
  This is the same box Codex gets from its `workspace-write` sandbox.
- `Write` and `Edit` scoped to the working directory. A run needs nothing
  wider — the textures it downloads go there, and the `.blend` and the renders
  are written by Blender, not by these tools.
- A read-deny list over the credential stores (`~/.ssh`, `~/.aws`, `~/.gnupg`,
  `~/.config/gh`, the two CLIs' own tokens). Reads are otherwise open, because
  Blender, its libraries and the model's directory sit all over the disk and a
  read allowlist is a list nobody can finish.

None of that contains `execute_blender_code`, and it is not meant to. That
tool runs arbitrary Python in a Blender the harness starts unsandboxed, which
is what modelling *is* here. The sandbox raises the floor; the tool is the
door, and it is open by design.

The instructions are the two skills under `skills/`, read on every run. Codex
gets them as `AGENTS.md` in the tab's working directory; Claude Code gets them
appended to its system prompt:

- `skills/blender-mcp/SKILL.md` — every tool of the Blender MCP server, with
  parameters, return shapes and working practices, written from the
  blender_mcp repo. It also says which tools do not exist in background mode
  (screenshots, `jump_to_*`).
- `skills/modelgen-harness/SKILL.md` — how a run in this app goes: inspect
  first, build in named steps, materials per surface, `image_gen` for
  references, render a preview, save.

### Codex's own home

Runs use their own Codex home, `codex-home/` under the app's user data.
Codex always reads `$CODEX_HOME/AGENTS.md` and has no switch to skip it, so
the user's global `~/.codex/AGENTS.md` is kept out this way: the app's home
holds a symlink to the user's `auth.json` (one login, token refreshes land in
the same file), a copy of the user's `config.toml` taken on every run (model
and preferences follow), and no AGENTS.md. Codex sessions and `image_gen`
output of harness runs live there too.

Per run, Codex is started with a workspace-write sandbox that reaches the
network, no approvals, live web search, `project_doc_max_bytes` raised so the
skills fit, the harness's tools set to auto-approve, and every MCP server from
the user's `config.toml` switched off — a second Blender server would only
confuse the agent about which scene it is editing. Model and reasoning effort
come from the user's config unless the tab overrides them.
`MODELGEN_DEBUG=1` prints every agent event to the app's stderr.

## Layout

```
shared/types.ts, bridge.ts   what the renderer and the main process both speak
shared/agents.ts             the two agents, their models and their efforts
electron/main.ts             window, IPC, the modelgen:// protocol for models and pictures
electron/db.ts               SQLite: tabs, messages, images, agent sessions, settings
electron/blender/            process per tab, TCP client, tool-code loader, docs, CLI, export
electron/agent/              tools, the MCP server the agents talk to, the run loop, skills
electron/agent/driver.ts     what the runner asks of an agent, and gets back
electron/agent/codex.ts      the Codex driver
electron/agent/claude.ts     the Claude Code driver
skills/                      the two skills the agent reads
src/state/                   signals: tabs, messages, attachments, settings
src/ui/                      tab bar, dialogs, workspace, chat, composer, viewer
```

Models and pictures never travel over IPC to be displayed. `modelgen://model`
serves the exported glTF of an open tab; `modelgen://image` serves a picture
out of SQLite.

## What a turn costs

The chat header counts the tokens a conversation has spent, and counts the
ones that are worth counting: the content the model read for the first time.
The prompt it re-read from cache is in the tooltip instead, because every tool
call sends the whole prompt again and that number says more about the length
of the turn than about the work in it. A five-step turn on one cube reads
about 350 000 cached tokens and perhaps 11 000 new ones; one total would have
called that a cube worth 360 000 tokens.

What a Claude request carries before any work happens, measured on a turn that
called no tools at all:

| | tokens per request |
| --- | ---: |
| the `claude_code` preset, the two skills, the 18 `modelgen` tools | 24 700 |
| the 117 `magnific` tools | 43 200 |
| total | 67 900 |

Magnific is a whole media platform — speech, music, voice, the gallery, the
account balance — and a modelling agent wants one thing from it. Its tool
definitions are in the system prompt of every request whether it is used or
not. The SDK defers MCP tools behind tool search when that is switched on, but
the switch is not reachable from the SDK's options, and `McpServerToolPolicy`
sets permissions rather than what is loaded. So the cost stands, knowingly.

## Rough edges

- Requests to one Blender run one at a time on its main thread. A long render
  blocks the export the viewer waits for until it is done.
- Background Blender has no window. Operators that read
  `bpy.context.active_object` need the window override the skills describe;
  the app's own glTF export uses it.
- The agent sees the previews it renders but not the viewer. Use **Screenshot**
  to show it what you see.
- Pictures from Codex's `image_gen` are found by scanning the app Codex home's
  `generated_images` for files newer than the turn. Two turns in two tabs at the same moment would
  both pick up each other's pictures. Pictures Claude Code makes through
  `magnific` are files it downloads itself, so the chat shows them only once
  they are in a render.
- Two windows are not expected. Events go to every window.
