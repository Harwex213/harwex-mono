import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname } from "node:path";
import { createRenderer } from "@hw/excalidraw-convert";
import type { ImageFormat, RenderOptions } from "@hw/excalidraw-convert";
import { sceneToPromptGraph } from "./graph.js";
import type {
  GraphFile,
  GraphPicture,
  NodeType,
  PromptEdge,
  PromptGraph,
  PromptGraphOptions,
  PromptGraphResult,
  PromptNode,
} from "./graph.js";

type PromptFileOptions = PromptGraphOptions & RenderOptions & {
  /* Describe the images but write none. The links stay in the graph. */
  writeImages?: boolean;
};

type PromptFileResult = PromptGraphResult & {
  input: string;
  output: string;
};

function graphToJson(graph: PromptGraph): string {
  return `${JSON.stringify(graph, null, 2)}\n`;
}

/* `notes.prompt.json` is one graph named `notes`, not one named `notes.prompt`. */
function stemOf(file: string): string {
  return basename(file, extname(file)).replace(/\.(?:prompt|excalidraw)$/, "");
}

/* Writes the images the scene already carries. No browser is needed for these. */
async function flushPromptFiles(files: GraphFile[]): Promise<void> {
  for (const file of files) {
    await mkdir(dirname(file.file), { recursive: true });
    await writeFile(file.file, file.data);
  }
}

/*
 * Draws every dashed block through one renderer, because a renderer is one
 * browser launch. The format comes from the path the graph already links to, so
 * a link can never point at a file in another format.
 */
async function drawPromptPictures(pictures: GraphPicture[], options: RenderOptions = {}): Promise<void> {
  if (pictures.length === 0) {
    return;
  }
  const renderer = await createRenderer();
  try {
    for (const picture of pictures) {
      await mkdir(dirname(picture.file), { recursive: true });
      if (extname(picture.file).toLowerCase() === ".png") {
        const result = await renderer.renderToPng(picture.scene, options);
        await writeFile(picture.file, result.png);
        continue;
      }
      const result = await renderer.renderToSvg(picture.scene, options);
      await writeFile(picture.file, result.svg, "utf8");
    }
  } finally {
    await renderer.close();
  }
}

async function writePromptImages(result: PromptGraphResult, options: RenderOptions = {}): Promise<void> {
  await flushPromptFiles(result.files);
  await drawPromptPictures(result.pictures, options);
}

/*
 * Scene in, graph file out, with an image next to it for every dashed block and
 * for every picture the scene carries. The graph takes the place of the scene
 * when no other output is named: the scene is read in full before anything is
 * written, so a file can be its own output.
 */
async function writePromptFile(
  input: string,
  output: string = input,
  options: PromptFileOptions = {},
): Promise<PromptFileResult> {
  const source = await readFile(input);
  const result = sceneToPromptGraph(source, {
    ...options,
    graphDir: options.graphDir ?? dirname(output),
    namePrefix: options.namePrefix ?? stemOf(output),
  });
  if (options.writeImages !== false) {
    await writePromptImages(result, options);
  }
  await mkdir(dirname(output), { recursive: true });
  await writeFile(output, graphToJson(result.graph), "utf8");
  return { ...result, input, output };
}

export {
  drawPromptPictures,
  flushPromptFiles,
  graphToJson,
  sceneToPromptGraph,
  writePromptFile,
  writePromptImages,
};
export type {
  GraphFile,
  GraphPicture,
  ImageFormat,
  NodeType,
  PromptEdge,
  PromptFileOptions,
  PromptFileResult,
  PromptGraph,
  PromptGraphOptions,
  PromptGraphResult,
  PromptNode,
  RenderOptions,
};
