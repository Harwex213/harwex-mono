# @hw/faenwald-parser

Fetches and parses VK.com "article view" pages (`vk.com/@owner-slug`) into a typed
`VkArticle` (`{ meta, blocks }`).

## Source of truth

`analyze-article.md` is the spec — it documents the VK DOM, the block taxonomy,
the classification rules, and the output schema. **When changing the parser, read
it first and keep the code in sync with it.** `assets/faenwald.html` is the
reference fixture the parser is validated against.

## Layout

- `src/model/article.ts` — types only. `VkArticle = { meta, blocks }`; blocks are a
  discriminated union on `type` (`title | header | subheader | paragraph | quote |
  list | image | video | divider | embed | table`), each with a sequential `order`.
- `src/parser/parse-article.ts` — `parseArticle(html, options?)`. Finds the article
  root, builds `meta` (id, ownerId, title, url, author, publishedAt, source, parsedAt).
- `src/parser/extract-blocks.ts` — `extractBlocks(articleEl)`. Maps the **direct
  children** of `div.article` to ordered blocks. All DOM-shape logic lives here.
- `src/client/vk-client.ts` — `VkClient`, a rate-limited fetcher (uses `undici`).
- `src/utils.ts` — `cleanText`, `normalizeUrl`, `parseVkDate`, `decodeEntities`.
- `src/index.ts` — the public barrel; update it when adding exports.

## Conventions worth knowing

- **Classify by semantic HTML tag, never by CSS class.** `article_decoration_*`
  classes are styling noise. `h1/h2/h3 → title/header/subheader` by tag, not size.
- **A `<blockquote>` of `<a>…<br/>` links is a `list` (TOC), not a `quote`** — see
  `isLinkList`. Prose blockquotes stay `quote`.
- **Tables are a block-level `<div class="ArticleTableWrapper">`, not a semantic
  tag** — the only content-bearing `<div>` child of `div.article`. `extractTable`
  reads each cell's `.ArticleTableCell__content` text (ignoring the separator-line
  decoration `<div>`s) and treats `tr.ArticleTableRow--header` as the header row.
- **Images anchor on `<figure data-type>`, not `<img>`** (avatars/sizers also use
  `<img>`). Sizes come from the `data-sizes` JSON on `.article_object_sizer_wrap`
  (HTML-entity-decode first); canonical url prefers the `base` key, else the widest.
- Headings: strip `span.article_anchor_button` before reading text, but keep its
  `id` as the block `anchor`.
- URLs are normalized to absolute against `https://vk.com`.
- The VK fixture renders dates in German (`26. Dez. 2025`); `parseVkDate` is
  best-effort for the `DD. Mon. YYYY` shape.

## Run & check

```bash
yarn :vk-parse <vk-url...> [-o <dir-or-file>]     # global; writes out/<slug>.md by default
yarn workspace @hw/faenwald-parser parse:fixture  # offline smoke check against assets/faenwald.html
yarn workspace @hw/faenwald-parser typecheck      # tsc --noEmit (covers src/ and scripts/)
```

The package is consumed as source (`exports: ./src/index.ts`); there is no build step.
The root `:vk-parse` script forwards the caller's directory as `VK_PARSE_CWD` so a
relative `-o` resolves against where the command was run, not the package dir.

TypeScript runs with `exactOptionalPropertyTypes` — for an optional prop that may be
absent, spread it conditionally (`...(href ? { href } : {})`) rather than assigning
`undefined`. There is no test suite yet; `parse:fixture` is the smoke check.
