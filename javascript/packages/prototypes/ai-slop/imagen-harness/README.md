# imagen harness

An Electron app for making images on a node canvas. Notes go in, an agent writes
the image prompt, another agent generates the picture, and every step stays on
disk in a directory you pick.

The spec this was built from is `docs/01-spec/prompt.json`.

```bash
yarn install
yarn workspace @hw/imagen-harness dev
```

`dev` runs three processes and prefixes their output: `tsc` watching the Electron
side, `rspack` serving the renderer on `:5761`, and `app` — Electron, started once
the other two have something to load. `yarn workspace @hw/imagen-harness start`
builds and runs the same app without the watchers.

If Electron is missing its binary after an install, run its own installer once:
`node node_modules/electron/install.js`.

## Working directories, and getting back to them

A tab is a working directory. **+** in the top bar opens the directory picker,
and **⟲** next to it lists every directory the app has worked in before — newest
first, with the size of each canvas — so a canvas from last month is two clicks
away rather than a hunt through the file system. The same list is the startup
screen when no canvas is open.

Opening one from either list restores the whole thing: the nodes where they were
left, the prompts read back out of `prompts/`, the images off disk.

**×** on a row forgets the directory. That is a list entry and nothing else — the
files stay exactly where they are, and opening the directory again puts it back.
A directory that has been moved or deleted is shown struck through as *not on
disk*; it can be forgotten, but never reopened, because reopening would create it
again, empty.

The list lives in SQLite (`node:sqlite`, no native module) at
`harness.db` in the app's user data directory — one `workspaces` table keyed by
the directory, holding its name, when it was last opened, whether it is open now,
and how many nodes its graph holds. A `tabs.json` from an earlier version is
imported into it on first run and then removed.

## Inside a working directory

Creating one opens the directory picker, and the app then owns four things inside
it:

```
graph.json               the canvas: every node, its position, and the text nodes
prompts/<node-id>.md     one file per image prompt node
images/<node-id>.png     one file per image node
.claude/skills/          the two skills the agents read, rewritten on every open
```

`prompts/` and `images/` are flat, and a file is named after the node that owns
it. Deleting a prompt node or an image node deletes its file. The graph saves
about half a second after any change.

`harness.config.json` in the working directory is optional:

```json
{
  "magnificUrl": "https://mcp.magnific.com",
  "agentModel": "claude-sonnet-5"
}
```

## The five nodes

| Node | What it does |
| --- | --- |
| text | A box you write in. Wire it into either generator. |
| image prompt generator | Turns the notes and reference images wired into it into one prompt. Owns one prompt node; a rerun overwrites it. |
| image prompt | The written prompt, truncated, with **show more**. Only a generator makes one, and it cannot be unlinked from it. |
| image generator | Picks a model and a size, and generates. Every run adds a new image node. |
| image | Renders the picture. |

Wiring runs socket to socket: press the output on the right of a card and let go
on the input on the left of another. Every input that would take the wire lights
up while you drag, and a drop anywhere else — a card's middle included — wires
nothing.

A prompt generator takes notes and images: a picture wired in is read, and what
it shows is written into the prompt in words. An image generator takes notes,
prompts and images, so a picture can be the reference for the next one.

## Gestures and keys

- **wheel** pans, **Cmd**/**Ctrl** + wheel zooms at the cursor, and so does a
  trackpad pinch. Two fingers on a touchscreen pinch and pan together.
- **drag the background** to pan, **drag a node** to move it, **drag an output
  socket onto an input socket** to wire them.
- **right click** on the background to create a node or paste an image, on a node
  to copy or delete it, on a wire to erase it.
- **Cmd**/**Ctrl** + **1**, or **fit** in the zoom bar, frames every node.
- **press or drag the map** in the bottom-right corner to move the window there.
- **Cmd**/**Ctrl** + **C** copies the selected node's content — a text node's
  text, a prompt node's prompt, an image node's pixels.
- **Cmd**/**Ctrl** + **V** puts the clipboard image on the canvas as an image
  node.
- **Delete** or **Backspace** removes the selected node.
- **Cmd**/**Ctrl** + **0**, **+** and **−** work on the zoom.

## The map

The corner of the canvas holds a minimap: every card as a block coloured by what
it is — grey notes, violet generators and prompts, amber images — the wires
between them, and the window drawn over the top as a rectangle.

Press anywhere on it to put that spot in the middle of the window, and drag to
steer. That makes it the fast way across a wide graph: the image you made an
hour ago is one press away, however far off it sits.

The map is scaled to the cards, never to the window. A window dragged a long way
out would otherwise squeeze the whole graph down to a dot, so instead the
rectangle leaves the map and becomes an arrow pinned to the edge, pointing the
way back — the same trick a game plays with an off-screen marker. Pressing near
the cards brings the window straight to them.

**−** in the map's title bar puts it away, leaving a small **map** button in its
place, and that choice is remembered.

## Lost the canvas

Panning has no edges to stop at, so a canvas can be dragged until every card is
somewhere off screen. When that happens — no card with a pixel inside the
window — the canvas says **Nothing is in view** and offers **Return to content**,
which frames every node again. It is checked card by card, so a view parked in
the gap between two far-apart cards counts as lost too.

## How a run works

Both generators run through
[`@anthropic-ai/claude-agent-sdk`](https://code.claude.com/docs/en/agent-sdk),
with the working directory as the agent's cwd. Authentication comes from the
machine's Claude Code credentials: if `claude` works in your terminal, this
works.

The rules for where a file goes are not in the prompt — they are in the two
skills the app writes into `.claude/skills/`, and `settingSources: ["project"]`
is what lets the run pick them up. The app then checks the disk itself: a run
that ends without the file it was asked for is a failed run, whatever the agent
said.

The image runs talk to the [Magnific MCP server](https://www.magnific.com/mcp)
at `https://mcp.magnific.com`, which signs in through OAuth. Add it to Claude
Code once and complete the sign-in there:

```bash
claude mcp add --transport http magnific https://mcp.magnific.com
```

The prompt run may use Read, Write, Glob and Skill. The image run also gets Bash,
because Magnific answers with a URL that has to be downloaded.

## Layout

```
shared/types.ts         the graph, the runs — both sides speak it
shared/bridge.ts        what the renderer may ask the main process for
electron/main.ts        window, IPC, and the imagen:// protocol that serves images
electron/workspace.ts   graph.json, prompts/, images/
electron/workspaces.ts  the SQLite list of directories worked in
electron/agent/         the two runs, the skills they read, the Magnific config
src/state/              signals: the graph, the runs, the viewport, the framing
src/ui/                 canvas, cards, wires, menu, minimap, directory list
```

Images never travel over IPC to be displayed. `imagen://file?path=…` serves them
straight off disk, and the main process refuses any path outside the `images/`
directory of an open tab.

## Rough edges

- The spec asks for "ctrl+C for image → image node being created". Copy puts an
  image on the clipboard and **paste** makes the node, which is the half that is
  useful; the context menu has the same paste.
- Touch gestures are written against pointer events but have not been tried on a
  touchscreen.
- Nothing is undoable. Deleting a node deletes its file straight away.
- A failed image run removes the image node it had already placed, so the
  message stays on the generator.
- The recents list is not pruned. It grows until rows are forgotten by hand, and
  the dropdown shows the newest 40.
- Two windows are not expected. Run events are broadcast to every window, and
  two of them on one directory would fight over `graph.json`.
