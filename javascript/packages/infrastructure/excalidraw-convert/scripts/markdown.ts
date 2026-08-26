import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { drawMarkdownImages, sceneToMarkdown } from "../src/index.js";
import type { ImageFormat, MarkdownImage, RenderOptions } from "../src/index.js";

const USAGE = `
Convert Excalidraw scene JSON to Markdown.

A block with text becomes an article, and its first row becomes the title when it
has more than one. Arrows set the order of the articles. A block that holds other
blocks becomes a picture instead, and the blocks it holds go into that picture.

Usage:
  yarn :excalidraw-markdown <input.json> [more.json ...] [options]
  yarn workspace @hw/excalidraw-convert markdown <input.json> [options]

Options:
  -o, --out <file>          Output file, or "-" for stdout. Single input only.
  -d, --out-dir <dir>       Write <name>.md under this directory.
      --title <text>        Document title placed above the articles.
      --image-dir <dir>     Where pictures go. Default: <markdown dir>/images
      --image-format <fmt>  "svg" or "png". Default: svg
      --image-scale <n>     Pixel multiplier for png. Default: 1
      --padding <n>         Margin around each picture, in scene units. Default: 10
      --dark                Draw the pictures with Excalidraw's dark theme.
      --no-images           Keep the links, skip drawing the pictures.
      --timeout <ms>        Time allowed per picture. Default: 60000
  -q, --quiet               Only print errors.
  -h, --help                Show this message.
`.trim();

type ParsedArgs = {
  inputs: string[];
  out?: string;
  outDir?: string;
  title: string;
  imageDir?: string;
  imageFormat: ImageFormat;
  drawImages: boolean;
  options: RenderOptions;
  quiet: boolean;
};

/*
 * Yarn runs workspace scripts from the package directory, so the root
 * `:excalidraw-markdown` script forwards the caller's directory as
 * EXCALIDRAW_CONVERT_CWD. Relative paths resolve against it.
 */
function callerCwd(): string {
  return process.env.EXCALIDRAW_CONVERT_CWD ?? process.cwd();
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
    title: "",
    imageFormat: "svg",
    drawImages: true,
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
      case "--title":
        parsed.title = readString(flag, next);
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
        parsed.drawImages = false;
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

function outputPathFor(parsed: ParsedArgs, input: string): string {
  if (parsed.out) {
    return parsed.out;
  }
  const name = `${basename(input, extname(input))}.md`;
  return join(parsed.outDir ?? dirname(input), name);
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
  const written: { output: string; images: MarkdownImage[]; markdown: string }[] = [];
  for (const job of jobs) {
    const toStdout = job.output === "-";
    const markdownDir = toStdout ? callerCwd() : dirname(job.output);
    const result = sceneToMarkdown(job.source, {
      title: parsed.title,
      markdownDir,
      imageDir: parsed.imageDir,
      imageFormat: parsed.imageFormat,
      namePrefix: `${toStdout ? basename(job.input, extname(job.input)) : basename(job.output, ".md")}-diagram`,
      reservedNames,
    });
    written.push({ output: job.output, images: result.images, markdown: result.markdown });
  }

  if (parsed.drawImages) {
    const images = written.flatMap((entry) => {
      return entry.images;
    });
    await drawMarkdownImages(images, { ...parsed.options, imageFormat: parsed.imageFormat });
  }

  for (const entry of written) {
    if (entry.output === "-") {
      process.stdout.write(entry.markdown);
      continue;
    }
    await mkdir(dirname(entry.output), { recursive: true });
    await writeFile(entry.output, entry.markdown, "utf8");
    if (!parsed.quiet) {
      const pictures = entry.images.length === 1 ? "1 picture" : `${entry.images.length} pictures`;
      console.log(`${entry.output} — ${pictures}`);
    }
  }
}

main().catch((error: unknown) => {
  console.error(`excalidraw-convert: ${(error as Error).message}`);
  process.exitCode = 1;
});
