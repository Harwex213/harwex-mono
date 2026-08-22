/** What a discovered url is fetched and stored as. */
type ResourceKind = "page" | "asset";

/** One fetched-and-written resource. */
type SavedResource = {
  kind: ResourceKind;
  url: string;
  /** Path on disk, relative to the crawl output directory. */
  path: string;
  status: number;
  bytes: number;
  contentType: string;
};

/** A url we decided to skip, or one we could not fetch. */
type SkippedResource = {
  kind: ResourceKind;
  url: string;
  reason: string;
  status?: number;
};

/** Progress notifications emitted while a crawl runs. */
type CrawlEvent =
  | { type: "queued"; kind: ResourceKind; url: string }
  | { type: "saved"; resource: SavedResource }
  | { type: "cached"; kind: ResourceKind; url: string; path: string }
  | { type: "skipped"; resource: SkippedResource }
  | { type: "retry"; url: string; attempt: number; reason: string };

type CrawlOptions = {
  /** Directory every page and asset is written into. Required. */
  outDir: string;
  /** Where the crawl starts. Defaults to the site's index page. */
  startUrls?: string[];
  /** How many requests may be in flight at once. */
  concurrency?: number;
  /** Minimum spacing between two request starts, in ms. */
  requestDelayMs?: number;
  /** Stop after this many pages. Assets of crawled pages are still fetched. */
  maxPages?: number;
  /** Download images, stylesheets and other referenced files. Defaults to true. */
  includeAssets?: boolean;
  /** Re-download resources whose file already exists on disk. Defaults to false. */
  overwrite?: boolean;
  /** Discover and save, but write nothing to disk. */
  dryRun?: boolean;
  /** User-Agent sent with every request. */
  userAgent?: string;
  /** How many times a failed request is retried. */
  maxRetries?: number;
  /** Progress callback. */
  onEvent?: (event: CrawlEvent) => void;
};

/** Everything a finished crawl produced. */
type CrawlReport = {
  startedAt: string;
  finishedAt: string;
  origin: string;
  outDir: string;
  startUrls: string[];
  pages: SavedResource[];
  assets: SavedResource[];
  /** Resources already on disk and left untouched. */
  cached: { kind: ResourceKind; url: string; path: string }[];
  skipped: SkippedResource[];
  /** Pages left uncrawled because `maxPages` was reached. */
  pagesDroppedByLimit: number;
};

export type {
  ResourceKind,
  SavedResource,
  SkippedResource,
  CrawlEvent,
  CrawlOptions,
  CrawlReport,
};
