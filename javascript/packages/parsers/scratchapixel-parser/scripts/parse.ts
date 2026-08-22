import { mkdir, writeFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

import { SITE_START_URL, crawlSite } from "../src/index.js";
import type { CrawlEvent, CrawlOptions, CrawlReport } from "../src/index.js";

/** Filename of the machine-readable summary written into the output directory. */
const REPORT_FILE = "crawl-report.json";

const USAGE = `
Mirror scratchapixel.com into a directory.

Usage:
  yarn :sap-parse --out <dir> [options]
  yarn workspace @hw/scratchapixel-parser parse --out <dir> [options]

Options:
  -o, --out <dir>        Output directory. Required. Pages and images are written
                         here, each at its own url path.
  -s, --start <url>      Start url. Repeatable. Default: ${SITE_START_URL}
  -c, --concurrency <n>  Requests in flight at once. Default: 4
  -d, --delay <ms>       Minimum spacing between request starts. Default: 250
  -m, --max-pages <n>    Stop after n pages. Default: no limit
      --no-assets        Save pages only, skip images and stylesheets.
      --overwrite        Re-download resources already present on disk.
      --dry-run          Crawl and report, but write nothing.
      --user-agent <ua>  Override the User-Agent header.
      --retries <n>      Retries per failed request. Default: 3
  -q, --quiet            Only print the final summary.
  -h, --help             Show this message.
`.trim();

type ParsedArgs = {
  options: CrawlOptions;
  quiet: boolean;
};

/**
 * A relative --out is resolved against the directory the command was run in.
 * The root `:sap-parse` script forwards it as SAP_PARSE_CWD, because yarn runs
 * workspace scripts from the package directory.
 */
const callerCwd = (): string => process.env.SAP_PARSE_CWD ?? process.cwd();

const resolveFromCaller = (value: string): string =>
  isAbsolute(value) ? value : resolve(callerCwd(), value);

const readNumber = (flag: string, raw: string | undefined, min = 1): number => {
  const value = Number(raw);
  if (!raw || !Number.isFinite(value) || value < min) {
    throw new Error(`${flag} expects a number >= ${min}, got "${raw ?? ""}"`);
  }
  return value;
};

const readString = (flag: string, raw: string | undefined): string => {
  if (!raw) {
    throw new Error(`${flag} expects a value`);
  }
  return raw;
};

const parseArgs = (argv: string[]): ParsedArgs | "help" => {
  let outDir: string | undefined;
  const startUrls: string[] = [];
  const options: Partial<CrawlOptions> = {};
  let quiet = false;

  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    const next = argv[index + 1];

    switch (flag) {
      case "-h":
      case "--help":
        return "help";
      case "-o":
      case "--out":
        outDir = resolveFromCaller(readString(flag, next));
        index += 1;
        break;
      case "-s":
      case "--start":
        startUrls.push(readString(flag, next));
        index += 1;
        break;
      case "-c":
      case "--concurrency":
        options.concurrency = readNumber(flag, next);
        index += 1;
        break;
      case "-d":
      case "--delay":
        options.requestDelayMs = readNumber(flag, next, 0);
        index += 1;
        break;
      case "-m":
      case "--max-pages":
        options.maxPages = readNumber(flag, next);
        index += 1;
        break;
      case "--retries":
        options.maxRetries = readNumber(flag, next, 0);
        index += 1;
        break;
      case "--user-agent":
        options.userAgent = readString(flag, next);
        index += 1;
        break;
      case "--no-assets":
        options.includeAssets = false;
        break;
      case "--overwrite":
        options.overwrite = true;
        break;
      case "--dry-run":
        options.dryRun = true;
        break;
      case "-q":
      case "--quiet":
        quiet = true;
        break;
      default:
        // A bare path is accepted as the output directory, so
        // `parse ./out` works as well as `parse --out ./out`.
        if (flag && !flag.startsWith("-") && outDir === undefined) {
          outDir = resolveFromCaller(flag);
          break;
        }
        throw new Error(`unknown argument "${flag ?? ""}"`);
    }
  }

  if (outDir === undefined) {
    throw new Error("--out <dir> is required");
  }

  return {
    quiet,
    options: {
      ...options,
      outDir,
      ...(startUrls.length > 0 ? { startUrls } : {}),
    },
  };
};

const formatBytes = (bytes: number): string => {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const totalBytes = (report: CrawlReport): number =>
  [...report.pages, ...report.assets].reduce((sum, resource) => sum + resource.bytes, 0);

const createLogger = (quiet: boolean): ((event: CrawlEvent) => void) => {
  let saved = 0;

  return (event: CrawlEvent): void => {
    if (event.type === "saved") {
      saved += 1;
      if (!quiet) {
        console.log(`[${String(saved).padStart(4)}] ${event.resource.kind.padEnd(5)} ${event.resource.path}`);
      }
      return;
    }

    // Problems are worth printing even when quiet.
    if (event.type === "skipped") {
      console.warn(`  skip  ${event.resource.url} — ${event.resource.reason}`);
      return;
    }
    if (event.type === "retry") {
      console.warn(`  retry ${event.url} (attempt ${event.attempt}) — ${event.reason}`);
    }
  };
};

const printSummary = (report: CrawlReport): void => {
  console.log("");
  console.log(`pages   ${report.pages.length}`);
  console.log(`assets  ${report.assets.length}`);
  console.log(`cached  ${report.cached.length}`);
  console.log(`skipped ${report.skipped.length}`);
  if (report.pagesDroppedByLimit > 0) {
    console.log(`unvisited ${report.pagesDroppedByLimit} (--max-pages reached)`);
  }
  console.log(`bytes   ${formatBytes(totalBytes(report))}`);
  console.log(`output  ${report.outDir}`);
};

const main = async (): Promise<void> => {
  let parsed: ParsedArgs | "help";
  try {
    parsed = parseArgs(process.argv.slice(2));
  } catch (cause) {
    console.error(`error: ${(cause as Error).message}`);
    console.error("");
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }

  if (parsed === "help") {
    console.log(USAGE);
    return;
  }

  const { options, quiet } = parsed;
  const report = await crawlSite({ ...options, onEvent: createLogger(quiet) });

  if (!options.dryRun) {
    await mkdir(options.outDir, { recursive: true });
    await writeFile(resolve(options.outDir, REPORT_FILE), `${JSON.stringify(report, null, 2)}\n`, "utf-8");
  }

  printSummary(report);
};

await main();
