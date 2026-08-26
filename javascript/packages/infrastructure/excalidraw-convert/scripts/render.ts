import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, isAbsolute, join, resolve } from "node:path";

import { createRenderer } from "../src/index.js";
import type { ImageFormat, RenderOptions } from "../src/index.js";

const USAGE = `
Render Excalidraw scene JSON to SVG or PNG.

Usage:
  yarn :excalidraw-image <input.json> [more.json ...] [options]
  yarn workspace @hw/excalidraw-convert render <input.json> [options]

Options:
  -o, --out <file>        Output file. Only valid with a single input.
  -d, --out-dir <dir>     Write next to each input under this directory instead.
  -f, --format <fmt>      "svg" or "png". Default: the extension of --out, else svg.
  -s, --scale <n>         Pixel multiplier for PNG. Default: 1
  -p, --padding <n>       Margin around the scene, in scene units. Default: 10
      --frame <id|name>   Crop to one frame element.
      --dark              Render with Excalidraw's dark theme.
      --no-background     Leave the background transparent.
      --background <css>  Background color. Overrides the scene's own.
      --timeout <ms>      Time allowed per scene. Default: 60000
  -q, --quiet             Only print errors.
  -h, --help              Show this message.
`.trim();

type ParsedArgs = {
  inputs: string[];
  out?: string;
  outDir?: string;
  format?: ImageFormat;
  options: RenderOptions;
  quiet: boolean;
};

/*
 * Yarn runs workspace scripts from the package directory, so the root
 * `:excalidraw-image` script forwards the caller's directory as
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
  const parsed: ParsedArgs = { inputs: [], options: {}, quiet: false };

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];

    switch (flag) {
      case "-h":
      case "--help":
        return "help";
      case "-o":
      case "--out":
        parsed.out = resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "-d":
      case "--out-dir":
        parsed.outDir = resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "-f":
      case "--format":
        parsed.format = readFormat(flag, next);
        index += 1;
        break;
      case "-s":
      case "--scale":
        parsed.options.scale = readNumber(flag, next, 0.1);
        index += 1;
        break;
      case "-p":
      case "--padding":
        parsed.options.padding = readNumber(flag, next, 0);
        index += 1;
        break;
      case "--frame":
        parsed.options.frame = readString(flag, next);
        index += 1;
        break;
      case "--dark":
        parsed.options.darkMode = true;
        break;
      case "--no-background":
        parsed.options.background = false;
        break;
      case "--background":
        parsed.options.backgroundColor = readString(flag, next);
        index += 1;
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

function outputPathFor(parsed: ParsedArgs, input: string, format: ImageFormat): string {
  if (parsed.out) {
    return parsed.out;
  }
  const name = `${basename(input, extname(input))}.${format}`;
  return join(parsed.outDir ?? dirname(input), name);
}

function formatFor(parsed: ParsedArgs): ImageFormat {
  if (parsed.format) {
    return parsed.format;
  }
  if (parsed.out && extname(parsed.out).toLowerCase() === ".png") {
    return "png";
  }
  return "svg";
}

async function main(): Promise<void> {
  const parsed = parseArgs(process.argv.slice(2));
  if (parsed === "help") {
    console.log(USAGE);
    return;
  }

  const format = formatFor(parsed);

  /* Read every input first, so a bad path fails before a browser is launched. */
  const jobs = [];
  for (const input of parsed.inputs) {
    jobs.push({ source: await readFile(input), output: outputPathFor(parsed, input, format) });
  }

  const renderer = await createRenderer();
  try {
    for (const { source, output } of jobs) {
      await mkdir(dirname(output), { recursive: true });

      if (format === "png") {
        const result = await renderer.renderToPng(source, parsed.options);
        await writeFile(output, result.png);
        if (!parsed.quiet) {
          console.log(`${output} — ${result.width}×${result.height} png`);
        }
        continue;
      }

      const result = await renderer.renderToSvg(source, parsed.options);
      await writeFile(output, result.svg, "utf8");
      if (!parsed.quiet) {
        console.log(`${output} — ${result.width}×${result.height} svg`);
      }
    }
  } finally {
    await renderer.close();
  }
}

main().catch((error: unknown) => {
  console.error(`excalidraw-convert: ${(error as Error).message}`);
  process.exitCode = 1;
});
