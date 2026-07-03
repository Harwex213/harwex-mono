# @hw/faenwald-parser

Fetches and parses [VK.com](https://vk.com) articles (the `vk.com/@owner-slug`
"article view" pages) into a typed `VkArticle` structure.

Built against the Faenwald combat-system article; see `assets/faenwald.html`
for the reference fixture and `analyze-article.md` for the markup analysis.

## Install / build

```bash
# from the monorepo root
yarn
yarn workspace @hw/faenwald-parser build
```

## Usage

### Parse HTML you already have

```ts
import { parseArticle } from "@hw/faenwald-parser";

const article = parseArticle(html, { sourceUrl: "https://vk.com/@faenwald-cf-boevaya-sistema" });
console.log(article.meta.title, article.blocks.length);
```

### Fetch and parse a live article

```ts
import { VkClient, parseArticle } from "@hw/faenwald-parser";

const client = new VkClient({ minRequestIntervalMs: 1000 });
const html = await client.fetchArticleHtml("https://vk.com/@faenwald-cf-boevaya-sistema");
const article = parseArticle(html);
```

## API

| Export | Description |
|--------|-------------|
| `parseArticle(html, options?)` | Map raw article HTML to a `VkArticle`. `options.sourceUrl` supplies the canonical url when the page omits `og:url`. |
| `extractBlocks(articleEl)` | Lower-level: map an article element's children to `VkArticleBlock[]`. |
| `VkClient` | HTTP client with configurable headers + simple request rate limiting. |
| `cleanText`, `normalizeUrl`, `parseVkDate`, `decodeEntities` | Shared helpers. |
| `FaenwaldParserError`, `FaenwaldFetchError` | Typed failures. |

`VkArticle` shape: `{ meta, blocks }`, where `meta` is
`{ id, ownerId, title, url, author: { name, url }, publishedAt, source, parsedAt }`.
Each block carries an `order` index and is a discriminated union:
`title | header | subheader | paragraph | quote | list | image | video | divider | embed`
(see `analyze-article.md` for the full output schema).

## Scripts

```bash
yarn workspace @hw/faenwald-parser parse                 # parse the bundled fixture
yarn workspace @hw/faenwald-parser parse <vk-article-url> # fetch + parse live
yarn workspace @hw/faenwald-parser dev                    # tsc --watch
```

See `acceptance-criteria.md` for the supported scope and output contract.
