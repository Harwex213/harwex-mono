// The block taxonomy mirrors `analyze-article.md` §2 (content-type meta schema).
export type VkArticleBlockType =
  | "title"
  | "header"
  | "subheader"
  | "paragraph"
  | "quote"
  | "list"
  | "image"
  | "video"
  | "divider"
  | "embed"
  | "table";

// Inline formatting preserved inside paragraph/quote text (analyze-article.md §4 `marks`).
export type VkInlineMarkKind = "bold" | "italic" | "link" | "linebreak";

export type VkInlineMark = {
  kind: VkInlineMarkKind;
  /** Marked-up text; absent for linebreaks. */
  text?: string;
  /** Target for `link` marks (absolute). */
  href?: string;
};

// One responsive variant from a figure's `data-sizes` JSON.
export type VkArticleImageSize = {
  /** VK size key, e.g. "s","m","x","y","r","z","base". */
  key: string;
  url: string;
  width: number;
  height: number;
};

// Media payload for image/video/embed blocks (analyze-article.md §4 `media`).
export type VkArticleMedia = {
  /** `figure[data-type]`, e.g. "101" for a photo. */
  vkType: string | undefined;
  /** Canonical (base/largest) source url. */
  url: string;
  width: number | undefined;
  height: number | undefined;
  alt: string | undefined;
  caption: string | undefined;
  sizes: VkArticleImageSize[];
};

type VkArticleBlockBase = {
  /** Sequential reading-order index under `div.article`. */
  order: number;
  type: VkArticleBlockType;
};

// h1 -> title (level 1), h2 -> header (level 2), h3 -> subheader (level 3).
export type VkArticleHeadingBlock = VkArticleBlockBase & {
  type: "title" | "header" | "subheader";
  level: 1 | 2 | 3;
  /** `span.article_anchor_button[id]` slug, e.g. "1-1-front-flang-i-tyl". */
  anchor: string | undefined;
  text: string;
};

export type VkArticleParagraphBlock = VkArticleBlockBase & {
  type: "paragraph";
  text: string;
  /** Inline HTML preserving marks. */
  html: string;
  marks: VkInlineMark[];
};

export type VkArticleQuoteBlock = VkArticleBlockBase & {
  type: "quote";
  text: string;
  html: string;
  marks: VkInlineMark[];
};

export type VkArticleListItem = {
  text: string;
  href: string | undefined;
};

export type VkArticleListBlock = VkArticleBlockBase & {
  type: "list";
  items: VkArticleListItem[];
};

export type VkArticleMediaBlock = VkArticleBlockBase & {
  type: "image" | "video" | "embed";
  media: VkArticleMedia;
};

export type VkArticleDividerBlock = VkArticleBlockBase & {
  type: "divider";
};

// VK tables (div.ArticleTableWrapper > table.ArticleTable). The first row is a
// header row (tr.ArticleTableRow--header); `headers` is empty when absent.
export type VkArticleTableBlock = VkArticleBlockBase & {
  type: "table";
  /** Header-row cell labels; empty when the table has no header row. */
  headers: string[];
  /** Body rows; each is the row's cell texts in column order. */
  rows: string[][];
};

export type VkArticleBlock =
  | VkArticleHeadingBlock
  | VkArticleParagraphBlock
  | VkArticleQuoteBlock
  | VkArticleListBlock
  | VkArticleMediaBlock
  | VkArticleDividerBlock
  | VkArticleTableBlock;

export type VkArticleAuthor = {
  name: string | undefined;
  url: string | undefined;
};

export type VkArticleMeta = {
  /** VK internal id, e.g. "-234725042_305324". */
  id: string;
  /** Owner part of the id, e.g. "-234725042". */
  ownerId: string | undefined;
  title: string;
  /** Canonical article url. */
  url: string;
  author: VkArticleAuthor;
  /** Raw publish-date string as shown by VK (locale-dependent), e.g. "26. Dez. 2025". */
  publishedAt: string | undefined;
  source: "vk.com";
  /** ISO-8601 timestamp of when the parse ran. */
  parsedAt: string;
};

export type VkArticle = {
  meta: VkArticleMeta;
  /** Ordered structural content of the article body. */
  blocks: VkArticleBlock[];
};
