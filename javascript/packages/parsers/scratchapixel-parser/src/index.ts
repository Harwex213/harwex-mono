// model - types
export type {
  ResourceKind,
  SavedResource,
  SkippedResource,
  CrawlEvent,
  CrawlOptions,
  CrawlReport,
} from "./model/types.js";

// model - errors
export { ScratchapixelParserError, ScratchapixelFetchError } from "./model/crawler-error.js";

// client
export { HttpClient, DEFAULT_USER_AGENT } from "./client/http-client.js";
export type { FetchedResource, HttpClientOptions } from "./client/http-client.js";

// core
export { Crawler, crawlSite } from "./core/crawler.js";
export { extractRefs } from "./core/extract-refs.js";
export type { ExtractedRefs } from "./core/extract-refs.js";
export {
  SITE_ORIGIN,
  SITE_START_URL,
  normalizeUrl,
  toPageUrl,
  classifyUrl,
  isSameOrigin,
  urlToLocalPath,
  extensionOf,
} from "./core/url-utils.js";
