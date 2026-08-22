import { relative } from "node:path";

import { HttpClient } from "../client/http-client.js";
import type {
  CrawlEvent,
  CrawlOptions,
  CrawlReport,
  ResourceKind,
  SavedResource,
  SkippedResource,
} from "../model/types.js";
import { extractRefs } from "./extract-refs.js";
import { fileExists, readResourceText, writeResource } from "./storage.js";
import {
  SITE_ORIGIN,
  SITE_START_URL,
  classifyUrl,
  isSameOrigin,
  normalizeUrl,
  toPageUrl,
  urlToLocalPath,
} from "./url-utils.js";

type CrawlTask = {
  kind: ResourceKind;
  url: URL;
};

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

const isHtmlContentType = (contentType: string): boolean => contentType.includes("html");

/**
 * Breadth-first mirror of the site: every page reachable from the start urls is
 * saved under the output directory at its own url path, together with every
 * same-origin file it embeds.
 */
class Crawler {
  private readonly options: Required<Omit<CrawlOptions, "onEvent" | "userAgent">> & {
    onEvent: CrawlOptions["onEvent"];
  };
  private readonly client: HttpClient;
  private readonly queue: CrawlTask[] = [];
  /** Canonical urls already queued, so nothing is fetched twice. */
  private readonly seen = new Set<string>();
  private readonly pages: SavedResource[] = [];
  private readonly assets: SavedResource[] = [];
  private readonly cached: CrawlReport["cached"] = [];
  private readonly skipped: SkippedResource[] = [];
  private readonly startUrls: string[];
  private activeTasks = 0;
  /** Page slots taken, whether the fetch has finished or not. */
  private pagesReserved = 0;
  /** Pages left uncrawled because `maxPages` was already reached. */
  private droppedByLimit = 0;

  constructor(options: CrawlOptions) {
    this.options = {
      outDir: options.outDir,
      startUrls: options.startUrls ?? [SITE_START_URL],
      concurrency: options.concurrency ?? 4,
      requestDelayMs: options.requestDelayMs ?? 250,
      maxPages: options.maxPages ?? Number.POSITIVE_INFINITY,
      includeAssets: options.includeAssets ?? true,
      overwrite: options.overwrite ?? false,
      dryRun: options.dryRun ?? false,
      maxRetries: options.maxRetries ?? 3,
      onEvent: options.onEvent,
    };

    this.client = new HttpClient({
      requestDelayMs: this.options.requestDelayMs,
      maxRetries: this.options.maxRetries,
      ...(options.userAgent ? { userAgent: options.userAgent } : {}),
      onRetry: (url, attempt, reason) => {
        this.emit({ type: "retry", url, attempt, reason });
      },
    });

    this.startUrls = this.options.startUrls;
  }

  private emit(event: CrawlEvent): void {
    this.options.onEvent?.(event);
  }

  /** Queue a url once, in its canonical spelling, if it belongs to the site. */
  private enqueue(raw: string, base: string): void {
    const normalized = normalizeUrl(raw, base);
    if (!normalized) {
      return;
    }

    if (!isSameOrigin(normalized, SITE_ORIGIN)) {
      return;
    }

    const kind = classifyUrl(normalized);
    const url = kind === "page" ? toPageUrl(normalized) : normalized;
    const key = url.toString();

    if (this.seen.has(key)) {
      return;
    }

    // Mark the url seen before the filters below, so a page dropped by the limit
    // is tallied once and not again for every other page that links to it.
    this.seen.add(key);

    if (kind === "asset" && !this.options.includeAssets) {
      return;
    }

    // `maxPages` is a deliberate bound, so a page past it is not queued at all
    // and is not reported as a failure — only tallied.
    if (kind === "page" && this.pagesReserved >= this.options.maxPages) {
      this.droppedByLimit += 1;
      return;
    }

    this.queue.push({ kind, url });
    this.emit({ type: "queued", kind, url: key });
  }

  private record(task: CrawlTask, filePath: string, status: number, bytes: number, contentType: string): void {
    const resource: SavedResource = {
      kind: task.kind,
      url: task.url.toString(),
      path: relative(this.options.outDir, filePath),
      status,
      bytes,
      contentType,
    };

    if (task.kind === "page") {
      this.pages.push(resource);
    } else {
      this.assets.push(resource);
    }

    this.emit({ type: "saved", resource });
  }

  private skip(task: CrawlTask, reason: string, status?: number): void {
    const resource: SkippedResource = {
      kind: task.kind,
      url: task.url.toString(),
      reason,
      ...(status === undefined ? {} : { status }),
    };
    this.skipped.push(resource);
    this.emit({ type: "skipped", resource });
  }

  // Claim a page slot up front. Reserving before the fetch (rather than counting
  // after it) is what stops N workers from all passing the limit check at once.
  private reservePageSlot(): boolean {
    if (this.pagesReserved >= this.options.maxPages) {
      return false;
    }
    this.pagesReserved += 1;
    return true;
  }

  private async handleTask(task: CrawlTask): Promise<void> {
    if (task.kind === "page" && !this.reservePageSlot()) {
      this.droppedByLimit += 1;
      return;
    }

    const filePath = urlToLocalPath(task.url, this.options.outDir);

    // Resume support: an existing file means a previous run already fetched this
    // url. Pages still need parsing for their links, so re-read them from disk
    // instead of the network.
    if (!this.options.overwrite && !this.options.dryRun && (await fileExists(filePath))) {
      this.cached.push({ kind: task.kind, url: task.url.toString(), path: relative(this.options.outDir, filePath) });
      this.emit({ type: "cached", kind: task.kind, url: task.url.toString(), path: filePath });

      if (task.kind === "page") {
        this.queueRefs(await readResourceText(filePath), task.url);
      }
      return;
    }

    const response = await this.client.fetchResource(task.url.toString());

    if (response.status !== 200) {
      if (task.kind === "page") {
        this.pagesReserved -= 1;
      }
      this.skip(task, `HTTP ${response.status}`, response.status);
      return;
    }

    if (!this.options.dryRun) {
      await writeResource(filePath, response.body);
    }

    this.record(task, filePath, response.status, response.body.byteLength, response.contentType);

    if (task.kind === "page" && isHtmlContentType(response.contentType)) {
      this.queueRefs(response.body.toString("utf-8"), task.url);
    }
  }

  /** Feed every ref of one page back into the queue. */
  private queueRefs(html: string, pageUrl: URL): void {
    const { links, assets } = extractRefs(html);
    const base = pageUrl.toString();

    for (const link of links) {
      this.enqueue(link, base);
    }
    for (const asset of assets) {
      this.enqueue(asset, base);
    }
  }

  // Workers share the queue. A worker that finds it momentarily empty waits,
  // because a task still running may yet discover more urls.
  private async runWorker(): Promise<void> {
    while (this.queue.length > 0 || this.activeTasks > 0) {
      const task = this.queue.shift();
      if (!task) {
        await sleep(25);
        continue;
      }

      this.activeTasks += 1;
      try {
        await this.handleTask(task);
      } catch (cause) {
        this.skip(task, (cause as Error).message);
      } finally {
        this.activeTasks -= 1;
      }
    }
  }

  /** Run the crawl to completion and return everything it produced. */
  async run(): Promise<CrawlReport> {
    const startedAt = new Date().toISOString();

    for (const startUrl of this.startUrls) {
      this.enqueue(startUrl, SITE_ORIGIN);
    }

    const workers = Array.from({ length: Math.max(1, this.options.concurrency) }, () => this.runWorker());
    try {
      await Promise.all(workers);
    } finally {
      await this.client.close();
    }

    return {
      startedAt,
      finishedAt: new Date().toISOString(),
      origin: SITE_ORIGIN,
      outDir: this.options.outDir,
      startUrls: this.startUrls,
      pages: this.pages,
      assets: this.assets,
      cached: this.cached,
      skipped: this.skipped,
      pagesDroppedByLimit: this.droppedByLimit,
    };
  }
}

/** Mirror the site into `options.outDir`. */
const crawlSite = (options: CrawlOptions): Promise<CrawlReport> => new Crawler(options).run();

export { Crawler, crawlSite };
