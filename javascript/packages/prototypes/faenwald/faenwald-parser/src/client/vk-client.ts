import { fetch } from "undici";

import { FaenwaldFetchError } from "../model/parser-error.js";

const DEFAULT_USER_AGENT =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 " +
  "(KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1";

export type VkClientOptions = {
  /** Extra/override request headers merged on top of the defaults. */
  headers?: Record<string, string>;
  /** User-Agent header; VK serves the mobile article view to mobile UAs. */
  userAgent?: string;
  /** Minimum delay between consecutive requests, in ms (simple rate limit). */
  minRequestIntervalMs?: number;
};

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

export class VkClient {
  private readonly headers: Record<string, string>;
  private readonly minRequestIntervalMs: number;
  private lastRequestAt = 0;
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: VkClientOptions = {}) {
    this.minRequestIntervalMs = options.minRequestIntervalMs ?? 1000;
    this.headers = {
      "User-Agent": options.userAgent ?? DEFAULT_USER_AGENT,
      "Accept-Language": "en,ru;q=0.9",
      ...options.headers,
    };
  }

  // Serialize requests and space them out so we never burst against VK.
  private schedule<T>(task: () => Promise<T>): Promise<T> {
    const run = this.queue.then(async () => {
      const wait = this.minRequestIntervalMs - (Date.now() - this.lastRequestAt);
      if (wait > 0) await sleep(wait);
      try {
        return await task();
      } finally {
        this.lastRequestAt = Date.now();
      }
    });
    // Keep the chain alive even if a task rejects.
    this.queue = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  /** Fetch the raw HTML of a VK article page. */
  fetchArticleHtml(url: string): Promise<string> {
    return this.schedule(async () => {
      let response;
      try {
        response = await fetch(url, { headers: this.headers });
      } catch (cause) {
        throw new FaenwaldFetchError(
          `request to ${url} failed: ${(cause as Error).message}`,
        );
      }

      if (!response.ok) {
        throw new FaenwaldFetchError(`${url} returned HTTP ${response.status}`, response.status);
      }

      return response.text();
    });
  }
}
