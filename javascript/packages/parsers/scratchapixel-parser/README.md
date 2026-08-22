# @hw/scratchapixel-parser

Mirrors [scratchapixel.com](https://www.scratchapixel.com) into a directory you pass
on the command line. Every reachable page is saved as HTML, and every image,
stylesheet and script it embeds is saved alongside it.

Each resource lands at its own url path, so the copy browses like the original:

```
<out-dir>/
  index.html
  book-project.html
  sap.css
  crawl-report.json
  images/introduction-to-ray-tracing/material.png
  lessons/3d-basic-rendering/introduction-to-ray-tracing/how-does-it-work.html
```

## Run

```bash
# from anywhere in the monorepo — a relative --out resolves against your cwd
yarn :sap-parse --out ./scratchapixel-mirror

# or from this package
yarn workspace @hw/scratchapixel-parser parse --out /tmp/sap

# a bounded trial run first
yarn :sap-parse --out /tmp/sap-sample --max-pages 20
```

Serve the result with the monorepo's static server — the pages reference their
assets from the site root (`/sap.css`, `/images/…`), so they need to be served
from the output directory rather than opened as `file://`:

```bash
cd ./scratchapixel-mirror
yarn :static
```

### Options

| Flag | Default | Meaning |
| --- | --- | --- |
| `-o, --out <dir>` | — | **Required.** Where pages and images are written. Also accepted as a bare positional argument. |
| `-s, --start <url>` | site index | Start url. Repeatable, to crawl one section only. |
| `-c, --concurrency <n>` | `4` | Requests in flight at once. |
| `-d, --delay <ms>` | `250` | Minimum spacing between two request starts. |
| `-m, --max-pages <n>` | no limit | Stop after n pages. Assets of the pages already crawled are still fetched. |
| `--no-assets` | off | Save pages only. |
| `--overwrite` | off | Re-download resources already on disk. |
| `--dry-run` | off | Crawl and report without writing anything. |
| `--user-agent <ua>` | desktop Chrome | Override the `User-Agent` header. |
| `--retries <n>` | `3` | Retries per failed request. |
| `-q, --quiet` | off | Print only the summary and problems. |

A crawl is resumable: a resource whose file already exists is left alone, and the
run only fetches what is missing. Re-run the same command after an interruption.
Pass `--overwrite` to refresh an existing mirror.

### What a full crawl costs

A complete run in August 2026 saved **169 pages and 1053 assets, about 356 MB**:
169 HTML pages, 1034 images, 16 videos and 2 stylesheets, in roughly 30 minutes at
the default settings. Most of that weight is video — the site embeds `.mp4` screen
recordings up to 71 MB and serves them at roughly 150 KB/s, so a handful of files
account for a large share of the wall-clock time. Use `--no-assets` for a pages-only
run, which finishes in a couple of minutes.

Expect 6 skips on a healthy crawl. Every one is a dead link in the site's own markup,
not a crawler failure: two missing PDFs, an `href` written without its leading slash,
and three unrendered `[sitetree_link id=…]` CMS placeholders.

Those big videos are also the one place a crawl can lose a file, and they drove two
details of `HttpClient`:

- `bodyTimeout` is raised to 10 minutes and `headersTimeout` to 1 minute, because a
  70 MB asset at 150 KB/s outlasts undici's defaults.
- The response body is read **inside** the retried block. These transfers drop
  mid-stream, and a body read placed after the retry loop bypasses it completely —
  the failure surfaces as `terminated` on the first attempt with no retry at all.

A file that still fails every attempt is listed as `terminated` in
`crawl-report.json`. Re-running the command fetches only what is missing. There is no
byte-range resume, so each attempt at a failed asset restarts from zero.

## Layout

- `src/model/types.ts` — types only: `CrawlOptions`, `CrawlReport`, `SavedResource`,
  `CrawlEvent`.
- `src/model/crawler-error.ts` — `ScratchapixelParserError` and its `…FetchError` subclass.
- `src/client/http-client.ts` — `HttpClient`: spaces request starts apart and retries
  transient failures. Holds the default `User-Agent`.
- `src/core/url-utils.ts` — url canonicalization and the url→file-path mapping. All
  site-specific url quirks live here.
- `src/core/extract-refs.ts` — `extractRefs(html)`: every `<a href>` and embedded-file
  ref in one document, unresolved and unfiltered.
- `src/core/crawler.ts` — `Crawler` / `crawlSite(options)`: the breadth-first engine.
- `src/core/storage.ts` — read/write/exists against the output directory.
- `src/index.ts` — the public barrel; update it when adding exports.
- `scripts/parse.ts` — the CLI.

## Site quirks worth knowing

These are the reasons `url-utils.ts` exists. Removing any of them re-introduces a bug.

- **A bare `User-Agent` gets a 403.** The site sits behind an openresty rule that
  rejects non-browser agents — `curl` with no headers cannot fetch even `robots.txt`.
  The client therefore sends a desktop Chrome `User-Agent` by default.
- **One chapter has two urls.** The home page links `…/how-does-it-work` while the
  page's own `<link rel=canonical>` says `…/how-does-it-work.html`, and both return
  200. `toPageUrl` appends `.html` to extensionless paths so the two collapse into one
  entry, instead of the same chapter being saved twice.
- **Hrefs contain doubled slashes**, e.g. `…/introduction-to-ray-tracing//how-does-it-work.html`.
  The server collapses the repeat; `normalizeUrl` does too, for the same dedupe reason.
- **Query strings are dropped.** The site is static, so no page depends on one, and
  dropping them keeps filenames clean.
- Links are classified by extension: nothing or `.html`/`.htm` is a page worth parsing
  for more links, anything else is an asset to download as-is.

## Scope

- **Same-origin only.** Third-party resources are left as remote references: MathJax
  from jsDelivr, Google Fonts, and Google Analytics. Lessons render offline, but their
  **maths only typesets while you have a network connection**, because MathJax is
  loaded from a CDN.
- **Links are not rewritten.** The saved HTML is byte-for-byte what the server sent,
  which is why the mirror needs serving from the output directory rather than opening
  as `file://`.
- `crawl-report.json`, written into the output directory, lists every resource saved,
  cached and skipped, with status codes and byte counts. Read it after a run: a
  handful of skips are expected, because the site itself carries dead links —
  a missing PDF, an href written without its leading slash, and a few unrendered
  `[sitetree_link id=…]` CMS placeholders.

Content on scratchapixel.com is published under
[CC BY-NC-ND 4.0](https://creativecommons.org/licenses/by-nc-nd/4.0/) — the license
allows redistributing verbatim copies for non-commercial purposes, with attribution.
Keep the default delay, or raise it, so a crawl stays gentle on the origin.

## Check

```bash
yarn workspace @hw/scratchapixel-parser typecheck   # tsc --noEmit over src/ and scripts/
yarn :sap-parse --out /tmp/sap-check --max-pages 5  # smallest end-to-end run
```

There is no test suite yet; the bounded crawl is the smoke check. The package is
consumed as source (`exports: ./src/index.ts`), so there is no build step.
