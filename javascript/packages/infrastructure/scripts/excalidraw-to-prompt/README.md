# @hw/excalidraw-to-prompt

Turns an Excalidraw board into a node graph a prompt can read: text, connections and
pictures, and nothing else. A scene carries coordinates, colors, stroke widths, seeds and
version counters, and a model needs none of them.

## Install it on the system

`bin/excalidraw-to-prompt` is the launcher. Link it into a directory on your PATH once,
and the command works in every directory, in every shell:

```bash
ln -s ~/Projects/harwex-mono/javascript/packages/infrastructure/scripts/excalidraw-to-prompt/bin/excalidraw-to-prompt ~/.local/bin/excalidraw-to-prompt
excalidraw-to-prompt spec.excalidraw.json
```

The link name is the command name, so `ln -s ... ~/.local/bin/e2p` gives you `e2p`
instead. The launcher follows the link back to the package, runs the script through the
workspace's own `tsx`, and passes the directory you called it from, so relative paths
resolve there. A shell that never read your profile has no nvm on its PATH, so the
launcher looks up the newest node nvm installed before it gives up.

## Usage

**The graph replaces the scene in the file you pass.** The drawing is gone once the
command has run, so keep it in git first, or send the graph elsewhere with `--out`. A
second run on the same file fails instead of writing anything: a graph carries no
`elements`, so there is nothing left to convert.

Inside the repo, `:excalidraw-prompt` is the same converter as a yarn script. Relative
paths resolve against the directory you run it in, as they do for the command.

```bash
cd packages/projects/harwex-notes/docs
yarn :excalidraw-prompt spec.excalidraw.json          # spec.excalidraw.json is now the graph
yarn :excalidraw-prompt spec.json -o - --no-images    # to stdout, nothing written
yarn :excalidraw-prompt *.json -d ../prompts          # a batch, one browser, scenes kept
pbpaste | yarn :excalidraw-prompt --no-images         # clipboard JSON in, graph to stdout
```

When no input path is given, the converter reads one Excalidraw scene from stdin. The
graph goes to stdout unless `--out` or `--out-dir` is set (`--out-dir` names it
`stdin.json`). Empty or whitespace-only stdin is a successful no-op: the command writes
no graph and reports that nothing was done on stderr. `--quiet` suppresses that report.

Options:

| Flag | Meaning |
| --- | --- |
| `-o, --out <file>` | Write here instead, or `-` for stdout. Single input only. |
| `-d, --out-dir <dir>` | Write under this directory instead, under the same name. |
| `--image-dir <dir>` | Where images go. Default: `<out dir>/<name>-images` |
| `--image-format <fmt>` | Format of the schema pictures: `svg` or `png`. Default: `svg` |
| `--image-scale <n>` | Pixel multiplier for PNG. Default: 1 |
| `--padding <n>` | Margin around each picture, in scene units. Default: 10 |
| `--dark` | Draw the pictures with Excalidraw's dark theme. |
| `--no-images` | Keep the links, write no images. |
| `--timeout <ms>` | Time allowed per picture. Default: 60000 |
| `-q, --quiet` | Only print errors. |

## Three rules turn a board into a graph

- **A block becomes a node.** The node carries the block's text and nothing else. A block
  drawn inside another block becomes its child, so the nesting survives. An arrow becomes
  an edge, and the label on the arrow becomes the edge's text.
- **A dashed block is a block schema.** It becomes one picture of itself, written next to
  the graph, and the blocks it holds go into that picture instead of into the graph. An
  arrow drawn to one of them points at the schema. Only a dashed stroke marks a schema: a
  dotted one is an ordinary block.
- **An image goes to disk.** Excalidraw keeps a picture inline, as a data URL in the
  scene's `files`. Every image element is written out as its own file, and its node links
  to it.

The output is one object with two arrays:

```json
{
  "nodes": [
    {
      "id": "login-flow",
      "type": "frame",
      "text": "Login flow",
      "children": [
        { "id": "signup-form", "type": "block", "text": "Signup form\nemail + password" },
        { "id": "account-created", "type": "block", "text": "Account created" }
      ]
    },
    { "id": "account-screen", "type": "schema", "text": "Account screen", "image": "spec-images/account-screen.svg" },
    { "id": "brand-mark", "type": "image", "text": "brand mark", "image": "spec-images/brand-mark.png" },
    { "id": "rate-limit-5-attempts", "type": "text", "text": "Rate limit: 5 attempts" }
  ],
  "edges": [
    { "from": "signup-form", "to": "account-created", "text": "submit" },
    { "from": "account-created", "to": "account-screen" }
  ]
}
```

An id is the first row of the node's text, slugged, so an edge reads on its own. A node
whose text is taken already, or which has no text, gets a numbered id instead. `type` is
one of `block`, `schema`, `image`, `text` and `frame`. `text`, `image`, `link` and
`children` are left out when the block has none, so an empty field never costs a token.

## Details worth knowing

- **Nesting is measured by overlap, not by strict containment.** A block counts as held
  when 70% or more of its area lies under a bigger block. A pane drawn slightly outside its
  wrapper is still caught, and two boxes that merely touch are not. The innermost holder
  wins, so the graph comes out as the board was drawn.
- **A text drawn over a block is that block's label.** Excalidraw only binds a label to a
  block when the text was typed into the block itself. One loose text lying alone inside an
  unlabeled block is read as its label; several stay separate nodes.
- **A frame is a node.** Its name is its text, and the elements assigned to it are its
  children. A frame is never a schema, and it is dropped from the pictures — a frame there
  would crop the picture it appears in.
- **An arrow with no binding lands on the nearest block**, within 48 scene units of its
  endpoint. An arrow whose head sits at its start reads backwards, as Excalidraw draws it.
  An arrow that starts and ends on the same node is dropped, which is also what happens to
  the arrows inside a schema.

## Library

```ts
import { sceneToPromptGraph, writePromptFile, writePromptImages } from "@hw/excalidraw-to-prompt";

await writePromptFile("docs/spec.excalidraw.json");                      // in place
await writePromptFile("docs/spec.excalidraw.json", "docs/spec.prompt.json");
```

The scene is read in full before anything is written, so a file can be its own output.

`sceneToPromptGraph` is the conversion on its own. It draws nothing and touches no files:
every dashed block comes back in `pictures`, carrying the sub-scene and the path it belongs
at, and every image comes back in `files` as the bytes to write. `warnings` holds what the
scene asked for and could not give — an image with no entry in `files`, most often, which
is what a clipboard payload looks like.

```ts
const result = sceneToPromptGraph(sceneJson, { graphDir: "docs" });
await writePromptImages(result, { padding: 20 });
```

`drawPromptPictures` draws the pictures alone, through one browser, and
`flushPromptFiles` writes the images alone, without one. The picture format comes from
the path the graph already links to, so a link can never point at a file in another format.

## Notes

- The pictures are rendered by `@hw/excalidraw-convert`, which runs Excalidraw's own
  exporter in a headless Chromium. A board with no dashed block never launches it.
