import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { drawPromptPictures, flushPromptFiles, graphToJson, sceneToPromptGraph } from "../src/index.js";
import type { GraphFile, GraphPicture, ImageFormat, PromptGraphResult, RenderOptions } from "../src/index.js";

const USAGE = `
Convert Excalidraw scene JSON to a node graph a prompt can read.

Every block becomes a node carrying its text, an arrow becomes an edge, and a
block drawn inside another becomes its child. A block drawn with a dashed stroke
is a block schema: it becomes one picture of itself, and the blocks it holds go
into that picture instead of into the graph. Images the scene carries are
written next to the graph and linked from their node.

The graph replaces the scene in the file you pass. Keep the drawing somewhere
first, or write the graph elsewhere with --out or --out-dir.

Usage:
  yarn :excalidraw-prompt <input.json> [more.json ...] [options]
  yarn workspace @hw/excalidraw-to-prompt prompt <input.json> [options]

Options:
  -o, --out <file>          Write here instead, or "-" for stdout. Single input only.
  -d, --out-dir <dir>       Write under this directory instead, under the same name.
      --image-dir <dir>     Where images go. Default: <out dir>/<name>-images
      --image-format <fmt>  Format of the schema pictures: "svg" or "png". Default: svg
      --image-scale <n>     Pixel multiplier for png. Default: 1
      --padding <n>         Margin around each picture, in scene units. Default: 10
      --dark                Draw the pictures with Excalidraw's dark theme.
      --no-images           Keep the links, write no images.
      --timeout <ms>        Time allowed per picture. Default: 60000
  -q, --quiet               Only print errors.
  -h, --help                Show this message.
`.trim();

type ParsedArgs = {
  inputs: string[];
  out?: string;
  outDir?: string;
  imageDir?: string;
  imageFormat: ImageFormat;
  writeImages: boolean;
  options: RenderOptions;
  quiet: boolean;
};

/*
 * Yarn runs workspace scripts from the package directory, so the root
 * `:excalidraw-prompt` script forwards the caller's directory as
 * EXCALIDRAW_PROMPT_CWD. Relative paths resolve against it.
 */
function callerCwd(): string {
  return process.env.EXCALIDRAW_PROMPT_CWD ?? process.cwd();
}

function resolveFromCaller(value: string): string {
  if (isAbsolute(value)) {
    return value;
  }
  return resolve(callerCwd(), value);
}

function readString(flag: string, raw: string | undefined): string {
  if (!raw) {
    throw new Error(`${flag} expects a value`);
  }
  return raw;
}

function readNumber(flag: string, raw: string | undefined, min: number): number {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < min) {
    throw new Error(`${flag} expects a number >= ${min}, got "${raw ?? ""}"`);
  }
  return value;
}

function readFormat(flag: string, raw: string | undefined): ImageFormat {
  if (raw !== "png" && raw !== "svg") {
    throw new Error(`${flag} expects "png" or "svg", got "${raw ?? ""}"`);
  }
  return raw;
}

function parseArgs(argv: string[]): ParsedArgs | "help" {
  const parsed: ParsedArgs = {
    inputs: [],
    imageFormat: "svg",
    writeImages: true,
    options: {},
    quiet: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];

    switch (flag) {
      case "-h":
      case "--help":
        return "help";
      case "-o":
      case "--out":
        parsed.out = next === "-" ? "-" : resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "-d":
      case "--out-dir":
        parsed.outDir = resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "--image-dir":
        parsed.imageDir = resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "--image-format":
        parsed.imageFormat = readFormat(flag, next);
        index += 1;
        break;
      case "--image-scale":
        parsed.options.scale = readNumber(flag, next, 0.1);
        index += 1;
        break;
      case "--padding":
        parsed.options.padding = readNumber(flag, next, 0);
        index += 1;
        break;
      case "--dark":
        parsed.options.darkMode = true;
        break;
      case "--no-images":
        parsed.writeImages = false;
        break;
      case "--timeout":
        parsed.options.timeoutMs = readNumber(flag, next, 1000);
        index += 1;
        break;
      case "-q":
      case "--quiet":
        parsed.quiet = true;
        break;
      default:
        if (flag === undefined) {
          break;
        }
        if (flag.startsWith("-")) {
          throw new Error(`Unknown flag "${flag}"`);
        }
        parsed.inputs.push(resolveFromCaller(flag));
        break;
    }
  }

  if (parsed.inputs.length === 0) {
    throw new Error("No input file given");
  }
  if (parsed.out && parsed.inputs.length > 1) {
    throw new Error("--out takes a single input; use --out-dir for several");
  }
  return parsed;
}

/* `raw.excalidraw.json` is one drawing named `raw`, not one named `raw.excalidraw`. */
function stemFor(input: string): string {
  return basename(input, extname(input)).replace(/\.excalidraw$/, "");
}

/* The graph takes the place of the scene, unless it was sent somewhere else. */
function outputPathFor(parsed: ParsedArgs, input: string): string {
  if (parsed.out) {
    return parsed.out;
  }
  if (parsed.outDir) {
    return join(parsed.outDir, basename(input));
  }
  return input;
}

function countOf(amount: number, one: string, many: string): string {
  return `${amount} ${amount === 1 ? one : many}`;
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    console.log(USAGE);
    return;
  }

  /* Read every input first, so a bad path fails before a browser is launched. */
  const jobs = [];
  for (const input of parsed.inputs) {
    jobs.push({ input, source: await readFile(input), output: outputPathFor(parsed, input) });
  }

  /* One set of names for the whole batch: two scenes must not claim one file. */
  const reservedNames = new Set<string>();
  const converted: (PromptGraphResult & { output: string })[] = [];
  for (const job of jobs) {
    const toStdout = job.output === "-";
    const graphDir = toStdout ? callerCwd() : dirname(job.output);
    const stem = stemFor(job.input);
    const result = sceneToPromptGraph(job.source, {
      graphDir,
      imageDir: parsed.imageDir ?? join(graphDir, `${stem}-images`),
      imageFormat: parsed.imageFormat,
      namePrefix: stem,
      reservedNames,
    });
    converted.push({ ...result, output: job.output });
  }

  if (parsed.writeImages) {
    const files: GraphFile[] = converted.flatMap((entry) => {
      return entry.files;
    });
    const pictures: GraphPicture[] = converted.flatMap((entry) => {
      return entry.pictures;
    });
    await flushPromptFiles(files);
    await drawPromptPictures(pictures, parsed.options);
  }

  for (const entry of converted) {
    if (!parsed.quiet) {
      for (const warning of entry.warnings) {
        console.warn(`excalidraw-to-prompt: ${warning}`);
      }
    }
    if (entry.output === "-") {
      process.stdout.write(graphToJson(entry.graph));
      continue;
    }
    await mkdir(dirname(entry.output), { recursive: true });
    await writeFile(entry.output, graphToJson(entry.graph), "utf8");
    if (!parsed.quiet) {
      const parts = [
        countOf(entry.graph.nodes.length, "root node", "root nodes"),
        countOf(entry.graph.edges.length, "edge", "edges"),
        countOf(entry.pictures.length, "schema", "schemas"),
        countOf(entry.files.length, "image", "images"),
      ];
      console.log(`${entry.output} — ${parts.join(", ")}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`excalidraw-to-prompt: ${(error as Error).message}`);
  process.exitCode = 1;
});
