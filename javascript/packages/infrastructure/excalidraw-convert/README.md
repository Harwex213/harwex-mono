# @hw/excalidraw-convert

Converts Excalidraw scene JSON to SVG, PNG, or Markdown, from the command line or from
code.

## How it works

`@excalidraw/excalidraw` exports `exportToSvg` and `exportToBlob`, and both need a DOM.
The package bundles them for the browser with esbuild, loads that bundle into a headless
Chromium through Playwright, and calls the export there.

The page is served from a synthetic origin by a Playwright route handler, and every other
request is aborted. Excalidraw's hand-drawn fonts come from the installed package on disk,
so a render never reaches a CDN and never depends on the network.

SVG is the better default: Excalidraw inlines the fonts it used into the file, so the
output is self-contained, stays sharp at any size, and diffs as text.

## Pictures

`:excalidraw-image` is a global script — run it from any directory. Relative paths resolve
against the directory you run it in.

```bash
cd packages/projects/harwex-notes/docs
yarn :excalidraw-image raw.json                        # -> raw.svg
yarn :excalidraw-image raw.json --format png --scale 2 # -> raw.png at 2x
yarn :excalidraw-image *.json --out-dir ../images      # a batch, one browser
```

Options:

| Flag | Meaning |
| --- | --- |
| `-o, --out <file>` | Output file. Single input only. |
| `-d, --out-dir <dir>` | Write each output under this directory. |
| `-f, --format <fmt>` | `svg` or `png`. Default: the extension of `--out`, else `svg`. |
| `-s, --scale <n>` | Pixel multiplier for PNG. Default: 1 |
| `-p, --padding <n>` | Margin around the scene, in scene units. Default: 10 |
| `--frame <id\|name>` | Crop to one frame element. |
| `--dark` | Render with Excalidraw's dark theme. |
| `--no-background` | Leave the background transparent. |
| `--background <css>` | Background color. Overrides the scene's own. |
| `--timeout <ms>` | Time allowed per scene. Default: 60000 |
| `-q, --quiet` | Only print errors. |

## Markdown

`:excalidraw-markdown` reads a scene the way a reader does, and writes the text out.

```bash
cd packages/projects/harwex-notes/docs
yarn :excalidraw-markdown raw.json                          # -> raw.md + raw-images
yarn :excalidraw-markdown raw.json -o spec.md --title Notes
yarn :excalidraw-markdown raw.json -o - --no-images         # to stdout, nothing drawn
```

Four rules turn a board into a document:

- **A block with text becomes an article.** The text is the block's own label.
- **Several rows turn the first row into the title.** One row stays a plain paragraph.
  The rest of the rows are the body, kept as they are, so bullet lists survive.
- **Arrows set the order.** An arrow reads as "the block it leaves comes before the block
  it enters". A block waits until every block pointing at it is written, so a chain of
  arrows stays together instead of interleaving with another chain. A block with no arrow
  into it starts a chain, and position — top to bottom, then left to right — breaks the
  ties. A loop of arrows falls back to position.
- **A block that holds other blocks becomes a picture.** The blocks it holds go into that
  picture instead of into the text, and an arrow drawn to one of them points at the
  picture. A frame is not a holder: it groups the canvas, so it nests nothing and is never
  drawn.

Nesting is measured by overlap, not by strict containment: a block counts as held when 70%
or more of its area lies under a bigger block. A pane drawn slightly outside its wrapper is
still caught, and two boxes that merely touch are not.

Options:

| Flag | Meaning |
| --- | --- |
| `-o, --out <file>` | Output file, or `-` for stdout. Single input only. |
| `-d, --out-dir <dir>` | Write `<name>.md` under this directory. |
| `--title <text>` | Document title above the articles. Articles then start at `##`. |
| `--image-dir <dir>` | Where pictures go. Default: `<markdown dir>/images` |
| `--image-format <fmt>` | `svg` or `png`. Default: `svg` |
| `--image-scale <n>` | Pixel multiplier for PNG. Default: 1 |
| `--padding <n>` | Margin around each picture, in scene units. Default: 10 |
| `--dark` | Draw the pictures with Excalidraw's dark theme. |
| `--no-images` | Keep the links, skip drawing the pictures. |
| `--timeout <ms>` | Time allowed per picture. Default: 60000 |
| `-q, --quiet` | Only print errors. |

A picture is named after the label of the block it came from. A block with no label falls
back to the markdown file's own name — `spec.md` gives `spec-diagram-1.svg`.

## Library

```ts
import { excalidrawToSvg, renderExcalidrawFile, renderMarkdownFile } from "@hw/excalidraw-convert";

const svg = await excalidrawToSvg(sceneJson);
await renderExcalidrawFile("docs/raw.json", "docs/raw.png", { scale: 2 });
await renderMarkdownFile("docs/raw.json", "docs/spec.md", { title: "Notes" });
```

Each of those launches and closes its own browser. For more than a couple of scenes, hold
a renderer instead — it pays for one browser launch and one bundle build:

```ts
import { createRenderer } from "@hw/excalidraw-convert";

const renderer = await createRenderer();
try {
  for (const scene of scenes) {
    const { png, width, height } = await renderer.renderToPng(scene, { scale: 2 });
  }
} finally {
  await renderer.close();
}
```

`sceneToMarkdown` is the markdown conversion on its own. It draws nothing and touches no
files: every picture it asks for comes back in `images`, carrying the sub-scene and the
path it belongs at. Hand that array to `drawMarkdownImages`, or render it yourself.

```ts
import { drawMarkdownImages, sceneToMarkdown } from "@hw/excalidraw-convert";

const { markdown, images } = sceneToMarkdown(sceneJson, { markdownDir: "docs" });
await drawMarkdownImages(images, { imageFormat: "svg" });
```

`parseScene` accepts every shape an `.excalidraw` payload comes in: the file format, a
clipboard payload (`type: "excalidraw/clipboard"`, which carries no `appState`), a
`{ data: { ... } }` wrapper, or a bare element array. Deleted elements are dropped.

## Notes

- Playwright is pinned to 1.61.1, which matches the `chromium-1228` already in
  `~/Library/Caches/ms-playwright`. Changing the version costs a browser download.
