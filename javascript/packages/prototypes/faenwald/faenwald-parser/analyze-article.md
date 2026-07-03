# VK.com Article HTML — Parsing Analysis

Source analyzed: `assets/faenwald.html` — a VK.com article export
(**[CF] Боевая система** by **FAENWALD**, `id=-234725042_305324`,
url `/@faenwald-cf-boevaya-sistema`).

## Observed DOM structure

```
div.articleView__content
└─ div.article_theme[theme="light"]
   └─ div.article.article_view.article_mobile
        #article_view_<ownerId>_<articleId>
        [data-article-url]
      ├─ h1                         → article title (+ span.article_anchor_button > svg)
      ├─ div.article__info_line     → a.group_link (owner) · <date text>
      ├─ h2 / h3                    → section / subsection headers (+ anchor span[id])
      ├─ p                          → text blocks (inline <strong>/<em>/<a>/<br/>)
      ├─ blockquote                 → quote OR list/TOC (<a>…<br/> series)
      └─ figure[data-type][data-mode] → image / media
           └─ div.article_object_sizer_wrap[data-sizes]  (JSON, multi-res)
              img[src][alt]
           figcaption[data-captions]  (JSON array)
```

Notes:
- Lists are **not** real `<ul>/<ol>/<li>` — they are simulated with `<a>…<br/>`.
- `article_decoration_first` / `article_decoration_last` / `article_decoration_before`
  classes are visual grouping only and carry no content meaning.
- `<img>` also appears as owner avatar / inside sizer wrappers — anchor on `figure`.
- Chrome to skip: `articleView__footer`, `articleView__actions`,
  `articleView__ads_block`, `articleView__social_buttons`, `<style>`, `<script>`.

---

## 1) Parsing rules (single-sentence list)

1. Locate the article root as the single `<div class="article article_view article_mobile">` and read `id="article_view_<ownerId>_<articleId>"` plus `data-article-url` for identity.
2. Read the document `<title>` and strip the trailing ` | VK` suffix to get the page title.
3. Extract the article title from the first child `<h1>` inside the root.
4. Extract author/owner from `div.articleView__ownerName > a` (text = name, `href` = owner slug, here `/faenwald`).
5. Extract the publish date from `div.article__info_line`, taking the text node after `span.dvd` (the `·` divider), e.g. `26. Dez. 2025`.
6. Iterate only the **direct children** of `div.article` in document order, since reading order is the DOM order.
7. For every heading/title element, remove the nested `span.article_anchor_button` (and its inline SVG) before reading text, and keep its `id` attribute as the section anchor/slug.
8. Map `<h1>`→title, `<h2>`→section header, `<h3>`→subsection header by tag name, not by CSS class.
9. Treat each direct `<p>` as a text block and preserve inline formatting (`<strong>`→bold, `<em>`/`<i>`→italic, `<a href>`→link, `<br/>`→line break).
10. Ignore the `article_decoration_first` / `article_decoration_last` / `article_decoration_before` classes entirely — they are visual grouping hints, not content types.
11. Treat `<blockquote>` as a quote block, but reclassify it as a **list/TOC** when its content is a series of `<a>` items separated by `<br/>`.
12. For each `<figure>`, read `data-type`/`data-mode` (`101`/`0` = photo) to classify the media type.
13. For figure image URLs, parse the `data-sizes` JSON on `div.article_object_sizer_wrap` (HTML-entity-decode `&quot;`/`&amp;` first); it is an array of objects keyed `s,m,x,y,r,z,base` where each value is `[url, width, height]`, and pick `base` (or the largest) as the canonical image.
14. Fall back to the figure's `<img src>` and `alt` when `data-sizes` is absent or unparseable.
15. Read the figure caption from `figcaption[data-captions]` (a JSON array of strings; empty array / empty string ⇒ no caption).
16. Decode HTML entities and collapse insignificant whitespace in all extracted text.
17. Convert relative URLs (e.g. `/faenwald`, `/@faenwald-...`) to absolute against `https://vk.com`.
18. Skip non-content chrome: `articleView__footer`, `articleView__actions`, `articleView__ads_block`, `articleView__social_buttons`, and all `<style>`/`<script>` nodes.
19. Stop block iteration at the end of `div.article`'s children — footer/related blocks live outside it.
20. Emit blocks as an ordered array, assigning each a sequential `order` index for stable reconstruction.

---

## 2) Content-type meta schema (possible VK article block types)

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "VKArticleContentTypes",
  "definitions": {
    "BlockType": {
      "enum": ["title", "header", "subheader", "paragraph",
               "quote", "list", "image", "video", "divider", "embed"]
    },
    "TypeRule": {
      "type": "object",
      "properties": {
        "type":       { "$ref": "#/definitions/BlockType" },
        "selector":   { "type": "string", "description": "CSS/DOM match within div.article" },
        "vkMarker":   { "type": "string", "description": "VK-specific attribute/value that confirms the type" },
        "inlineMarks":{ "type": "array", "items": { "enum": ["bold","italic","link","linebreak"] } }
      },
      "required": ["type", "selector"]
    }
  },
  "type": "array",
  "items": { "$ref": "#/definitions/TypeRule" },
  "examples": [
    { "type": "title",     "selector": "h1",            "vkMarker": "first child of div.article" },
    { "type": "header",    "selector": "h2",            "vkMarker": "span.article_anchor_button[id]" },
    { "type": "subheader", "selector": "h3",            "vkMarker": "span.article_anchor_button[id]" },
    { "type": "paragraph", "selector": "p",             "inlineMarks": ["bold","italic","link","linebreak"] },
    { "type": "quote",     "selector": "blockquote",    "vkMarker": "no <br/>-separated <a> series" },
    { "type": "list",      "selector": "blockquote, p", "vkMarker": "<a>…<br/> repeated series (e.g. TOC)" },
    { "type": "image",     "selector": "figure",        "vkMarker": "data-type=\"101\" data-mode=\"0\"" },
    { "type": "video",     "selector": "figure",        "vkMarker": "data-type=\"103\" / iframe" },
    { "type": "divider",   "selector": "hr",            "vkMarker": "—" },
    { "type": "embed",     "selector": "figure, div",   "vkMarker": "iframe / data-type other" }
  ]
}
```

---

## 3) Principles for deciding a block's content type

1. **Classify by semantic tag first** — the HTML tag (`h1/h2/h3/p/blockquote/figure/hr`) is the primary, most reliable signal; CSS classes are styling noise.
2. **Heading level = nesting depth** — `h1` is the document title, `h2` a top-level section header, `h3` a subtitle/subsection; never infer level from font size or decoration class.
3. **A heading is recognized by its anchor child** — presence of `span.article_anchor_button[id]` (with an SVG link icon) confirms the node is a navigable heading, and its `id` is the section's stable slug.
4. **Text block = `<p>` with no figure/embed inside** — its meaning lives in inline marks (`strong`/`em`/`a`/`br`), which must be preserved, not flattened.
5. **Image is signalled by `<figure data-type="101">`**, not by the `<img>` tag alone — `<img>` also appears as the owner avatar (chrome) and inside sizer wrappers, so always anchor on the `figure` + `data-type`.
6. **Disambiguate `<blockquote>` by content shape** — a real quote is prose; a quote whose body is `<a>…<br/>` repeated is actually a **list/table-of-contents** and should be re-typed as `list`.
7. **`data-type` is the media discriminator** — `101/mode 0` = photo; other values (`103`, iframe presence) indicate video/embed and should map to `video`/`embed` rather than `image`.
8. **Strip decoration before deciding** — remove anchor spans, SVGs, and `article_decoration_*` classes so classification and text extraction see only real content.
9. **Order is meaning** — DOM sibling order under `div.article` is the canonical reading order; never reorder by type.
10. **Fall through to `embed`/`unknown` safely** — any block that matches no known rule is preserved with its raw HTML so no content is silently dropped.

---

## 4) Output schema for parsed content

```jsonc
{
  "$schema": "https://json-schema.org/draft/2020-12/schema",
  "title": "ParsedVKArticle",
  "type": "object",
  "required": ["meta", "blocks"],
  "properties": {
    "meta": {
      "type": "object",
      "required": ["id", "title", "url", "source"],
      "properties": {
        "id":        { "type": "string", "example": "-234725042_305324" },
        "ownerId":   { "type": "string", "example": "-234725042" },
        "title":     { "type": "string", "example": "[CF] Боевая система" },
        "url":       { "type": "string", "example": "https://vk.com/@faenwald-cf-boevaya-sistema" },
        "author":    {
          "type": "object",
          "properties": {
            "name":   { "type": "string", "example": "FAENWALD" },
            "url":    { "type": "string", "example": "https://vk.com/faenwald" }
          }
        },
        "publishedAt": { "type": "string", "example": "26. Dez. 2025" },
        "source":      { "const": "vk.com" },
        "parsedAt":    { "type": "string", "format": "date-time" }
      }
    },
    "blocks": {
      "type": "array",
      "items": {
        "type": "object",
        "required": ["order", "type"],
        "properties": {
          "order":   { "type": "integer" },
          "type":    { "enum": ["title","header","subheader","paragraph",
                                "quote","list","image","video","divider","embed"] },
          "anchor":  { "type": "string", "description": "heading id/slug, e.g. 1-1-front-flang-i-tyl" },
          "level":   { "type": "integer", "description": "1..3 for headings" },
          "text":    { "type": "string", "description": "plain text (entities decoded)" },
          "html":    { "type": "string", "description": "inline HTML preserving marks for paragraph/quote" },
          "marks":   {
            "type": "array",
            "items": {
              "type": "object",
              "properties": {
                "kind":  { "enum": ["bold","italic","link","linebreak"] },
                "text":  { "type": "string" },
                "href":  { "type": "string" }
              }
            }
          },
          "items":   {
            "type": "array",
            "description": "for type=list",
            "items": {
              "type": "object",
              "properties": {
                "text": { "type": "string" },
                "href": { "type": "string" }
              }
            }
          },
          "media":   {
            "type": "object",
            "description": "for type=image/video/embed",
            "properties": {
              "vkType":   { "type": "string", "example": "101" },
              "url":      { "type": "string", "description": "canonical (base/largest) URL" },
              "width":    { "type": "integer" },
              "height":   { "type": "integer" },
              "alt":      { "type": "string" },
              "caption":  { "type": "string" },
              "sizes":    {
                "type": "array",
                "items": {
                  "type": "object",
                  "properties": {
                    "key":    { "enum": ["s","m","x","y","r","z","base"] },
                    "url":    { "type": "string" },
                    "width":  { "type": "integer" },
                    "height": { "type": "integer" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

### Suggested output files (per article)

- `<articleId>.json` — the structured object above.
- `<articleId>.md` — rendered Markdown for human review.
- `<articleId>.assets.json` — list of image URLs to download (optional).
