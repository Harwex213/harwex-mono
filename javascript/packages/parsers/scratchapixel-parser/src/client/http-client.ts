import { Agent, fetch } from "undici";

import { ScratchapixelFetchError } from "../model/crawler-error.js";

/** One fetched resource, kept as bytes so images survive untouched. */
type FetchedResource = {
  status: number;
  contentType: string;
  body: Buffer;
};

type HttpClientOptions = {
  /** Minimum spacing between two request starts, in ms. */
  requestDelayMs?: number;
  /** How many times a retryable failure is retried before giving up. */
  maxRetries?: number;
  userAgent?: string;
  /** Extra headers merged on top of the defaults. */
  headers?: Record<string, string>;
  /**
   * Inactivity timeout while reading a response body, in ms. Generous by
   * default, because the site's largest videos trickle in; 0 disables it.
   */
  bodyTimeoutMs?: number;
  /** How long to wait for response headers, in ms. */
  headersTimeoutMs?: number;
  /** Called before each retry, for progress reporting. */
  onRetry?: (url: string, attempt: number, reason: string) => void;
};

// scratchapixel.com sits behind an openresty rule that answers a bare
// library User-Agent with 403, so we present a normal desktop browser string.
const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36";

/** Statuses worth a second attempt — everything else is a verdict, not a hiccup. */
const RETRYABLE_STATUSES = new Set([408, 425, 429, 500, 502, 503, 504, 522, 524]);

const sleep = (ms: number): Promise<void> => new Promise((done) => setTimeout(done, ms));

/**
 * A polite HTTP client: it spaces request starts apart so a crawl never bursts
 * against the origin, and retries transient failures with a backoff.
 */
class HttpClient {
  private readonly requestDelayMs: number;
  private readonly maxRetries: number;
  private readonly headers: Record<string, string>;
  private readonly onRetry: HttpClientOptions["onRetry"];
  private readonly dispatcher: Agent;
  /** Earliest timestamp at which the next request may start. */
  private nextSlotAt = 0;

  constructor(options: HttpClientOptions = {}) {
    this.requestDelayMs = options.requestDelayMs ?? 250;
    this.maxRetries = options.maxRetries ?? 3;
    this.onRetry = options.onRetry;
    // The site serves its largest videos at roughly 150 KB/s, so a single 70 MB
    // asset can take ~8 minutes. Both timeouts are raised well past undici's
    // defaults to give a transfer that slow room to finish.
    this.dispatcher = new Agent({
      bodyTimeout: options.bodyTimeoutMs ?? 600_000,
      headersTimeout: options.headersTimeoutMs ?? 60_000,
    });
    this.headers = {
      "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      ...options.headers,
    };
  }

  // Claim the next start slot. Concurrent callers each get their own slot, so
  // requests still overlap — only their start times are spread out.
  private async waitForSlot(): Promise<void> {
    const now = Date.now();
    const slot = Math.max(now, this.nextSlotAt);
    this.nextSlotAt = slot + this.requestDelayMs;

    const wait = slot - now;
    if (wait > 0) {
      await sleep(wait);
    }
  }

  /** Close the connection pool. Call once a crawl is finished. */
  async close(): Promise<void> {
    await this.dispatcher.close();
  }

  /**
   * Fetch one url. Resolves for any status the server actually returned —
   * a 404 is data the caller records, not an exception. Throws only when the
   * request could not be completed at all.
   */
  async fetchResource(url: string): Promise<FetchedResource> {
    let lastReason = "unknown error";

    for (let attempt = 0; attempt <= this.maxRetries; attempt += 1) {
      if (attempt > 0) {
        this.onRetry?.(url, attempt, lastReason);
        await sleep(500 * 2 ** (attempt - 1));
      }

      await this.waitForSlot();

      let response;
      let body;
      try {
        response = await fetch(url, {
          headers: this.headers,
          redirect: "follow",
          dispatcher: this.dispatcher,
        });
        // The body is read inside the guarded block on purpose. The site's
        // largest videos trickle in for minutes and can drop mid-stream, and a
        // read that fails out here would otherwise bypass the retry loop
        // entirely instead of being attempted again.
        body = Buffer.from(await response.arrayBuffer());
      } catch (cause) {
        lastReason = (cause as Error).message;
        continue;
      }

      if (RETRYABLE_STATUSES.has(response.status)) {
        lastReason = `HTTP ${response.status}`;
        continue;
      }

      return {
        status: response.status,
        contentType: response.headers.get("content-type") ?? "",
        body,
      };
    }

    throw new ScratchapixelFetchError(`request to ${url} failed: ${lastReason}`, url);
  }
}

export { HttpClient, DEFAULT_USER_AGENT };
export type { FetchedResource, HttpClientOptions };
