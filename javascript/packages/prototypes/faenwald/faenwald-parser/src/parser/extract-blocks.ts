import { HTMLElement, Node, NodeType } from "node-html-parser";

import type {
  VkArticleBlock,
  VkArticleImageSize,
  VkArticleListItem,
  VkArticleMedia,
  VkInlineMark,
} from "../model/article.js";
import { cleanText, decodeEntities, normalizeUrl } from "../utils.js";

const isElement = (node: Node): node is HTMLElement =>
  node.nodeType === NodeType.ELEMENT_NODE;

// h1 -> title, h2 -> header, h3 -> subheader (analyze-article.md §3.2, §1.8).
const HEADING_TYPES = {
  h1: { type: "title", level: 1 },
  h2: { type: "header", level: 2 },
  h3: { type: "subheader", level: 3 },
} as const;

// Strip VK's inline anchor-button icon, returning its `id` slug + clean heading text.
const readHeading = (heading: HTMLElement): { anchor: string | undefined; text: string } => {
  const clone = heading.clone() as HTMLElement;
  const anchor = clone.querySelector(".article_anchor_button")?.getAttribute("id") ?? undefined;
  for (const button of clone.querySelectorAll(".article_anchor_button")) {
    button.remove();
  }
  return { anchor, text: cleanText(clone.text) };
};

// Walk inline descendants collecting bold/italic/link/linebreak marks in order.
const extractMarks = (el: HTMLElement): VkInlineMark[] => {
  const marks: VkInlineMark[] = [];

  const walk = (parent: HTMLElement): void => {
    for (const child of parent.childNodes) {
      if (!isElement(child)) continue;
      const tag = child.rawTagName?.toLowerCase();
      switch (tag) {
        case "strong":
        case "b": {
          const text = cleanText(child.text);
          if (text) marks.push({ kind: "bold", text });
          break;
        }
        case "em":
        case "i": {
          const text = cleanText(child.text);
          if (text) marks.push({ kind: "italic", text });
          break;
        }
        case "a": {
          const href = child.getAttribute("href");
          marks.push({
            kind: "link",
            text: cleanText(child.text),
            ...(href ? { href: normalizeUrl(href) } : {}),
          });
          break;
        }
        case "br": {
          marks.push({ kind: "linebreak" });
          break;
        }
        default:
          break;
      }
      walk(child);
    }
  };

  walk(el);
  return marks;
};

// A blockquote whose body is a series of `<a>…<br/>` links is really a list/TOC,
// not prose (analyze-article.md §1.11, §3.6).
const isLinkList = (el: HTMLElement): boolean =>
  el.querySelectorAll("a").length >= 2 && el.querySelectorAll("br").length >= 1;

const extractLinkListItems = (el: HTMLElement): VkArticleListItem[] =>
  el
    .querySelectorAll("a")
    .map((anchor) => {
      const href = anchor.getAttribute("href");
      return { text: cleanText(anchor.text), href: href ? normalizeUrl(href) : undefined };
    })
    .filter((item) => item.text.length > 0);

const extractListItems = (list: HTMLElement): VkArticleListItem[] =>
  list
    .querySelectorAll("li")
    .map((li) => {
      const href = li.querySelector("a")?.getAttribute("href");
      return { text: cleanText(li.text), href: href ? normalizeUrl(href) : undefined };
    })
    .filter((item) => item.text.length > 0);

// VK wraps each illustration's responsive sources in a JSON blob like
// [{"s":[url,w,h],"m":[url,w,h], …, "base":[url,w,h]}] (analyze-article.md §1.13).
const parseSizes = (figure: HTMLElement): VkArticleImageSize[] => {
  const raw = figure.querySelector(".article_object_sizer_wrap")?.getAttribute("data-sizes");
  if (!raw) return [];

  try {
    const parsed = JSON.parse(decodeEntities(raw)) as unknown;
    const variants = Array.isArray(parsed) ? parsed[0] : parsed;
    if (!variants || typeof variants !== "object") return [];

    const sizes: VkArticleImageSize[] = [];
    for (const [key, value] of Object.entries(variants as Record<string, unknown>)) {
      if (
        Array.isArray(value) &&
        typeof value[0] === "string" &&
        typeof value[1] === "number" &&
        typeof value[2] === "number"
      ) {
        sizes.push({ key, url: normalizeUrl(value[0]), width: value[1], height: value[2] });
      }
    }
    return sizes;
  } catch {
    return [];
  }
};

// figcaption[data-captions] is a JSON array of strings; "" / [] mean no caption.
const readCaption = (figure: HTMLElement): string | undefined => {
  const figcaption = figure.querySelector("figcaption");
  if (!figcaption) return undefined;

  const raw = figcaption.getAttribute("data-captions");
  if (raw) {
    try {
      const parsed = JSON.parse(decodeEntities(raw)) as unknown;
      if (Array.isArray(parsed)) {
        const first = parsed.find((c) => typeof c === "string" && c.trim().length > 0);
        if (typeof first === "string") return cleanText(first);
        return undefined;
      }
    } catch {
      // fall through to the rendered text
    }
  }

  return cleanText(figcaption.text) || undefined;
};

const extractMedia = (figure: HTMLElement): VkArticleMedia | null => {
  const sizes = parseSizes(figure);
  const img = figure.querySelector("img");
  const alt = img?.getAttribute("alt");
  const caption = readCaption(figure);

  // Prefer the explicit `base` variant, else the widest, else the raw <img src>.
  const canonical =
    sizes.find((size) => size.key === "base") ??
    sizes.reduce<VkArticleImageSize | null>(
      (best, size) => (!best || size.width > best.width ? size : best),
      null,
    );

  if (canonical) {
    return {
      vkType: figure.getAttribute("data-type") ?? undefined,
      url: canonical.url,
      width: canonical.width,
      height: canonical.height,
      alt: alt ? cleanText(alt) : undefined,
      caption,
      sizes,
    };
  }

  const src = img?.getAttribute("src");
  if (src) {
    return {
      vkType: figure.getAttribute("data-type") ?? undefined,
      url: normalizeUrl(src),
      width: undefined,
      height: undefined,
      alt: alt ? cleanText(alt) : undefined,
      caption,
      sizes,
    };
  }

  return null;
};

// VK wraps tables in `div.ArticleTableWrapper > div.ArticleTableContainer >
// table.ArticleTable`. Each cell's visible text lives in `.ArticleTableCell__content`
// (the rest is separator-line decoration); the header row carries
// `tr.ArticleTableRow--header`.
const readCell = (cell: HTMLElement): string =>
  cleanText(cell.querySelector(".ArticleTableCell__content")?.text ?? cell.text);

const extractTable = (wrapper: HTMLElement): { headers: string[]; rows: string[][] } | null => {
  const table = wrapper.querySelector("table");
  if (!table) return null;

  const headers: string[] = [];
  const rows: string[][] = [];

  for (const row of table.querySelectorAll("tr")) {
    const cells = row.querySelectorAll("td").map(readCell);
    if (cells.length === 0) continue;
    if (headers.length === 0 && row.classList.contains("ArticleTableRow--header")) {
      headers.push(...cells);
    } else {
      rows.push(cells);
    }
  }

  if (headers.length === 0 && rows.length === 0) return null;
  return { headers, rows };
};

// `data-type` is the media discriminator: 101 = photo; iframe / other => video/embed
// (analyze-article.md §3.7).
const classifyFigure = (figure: HTMLElement): "image" | "video" | "embed" => {
  if (figure.querySelector("iframe")) return figure.getAttribute("data-type") === "103" ? "video" : "embed";
  if (figure.getAttribute("data-type") === "103") return "video";
  if (figure.getAttribute("data-type") === "101") return "image";
  return "embed";
};

/**
 * Map the direct children of `div.article` to ordered content blocks, in DOM
 * (reading) order. Classifies by semantic tag first; CSS decoration classes are
 * ignored (analyze-article.md §3).
 */
// Distributive Omit so each union member keeps its own discriminated fields.
type BlockWithoutOrder = VkArticleBlock extends infer T
  ? T extends VkArticleBlock
    ? Omit<T, "order">
    : never
  : never;

export const extractBlocks = (article: HTMLElement): VkArticleBlock[] => {
  const blocks: VkArticleBlock[] = [];

  const push = (block: BlockWithoutOrder): void => {
    blocks.push({ ...block, order: blocks.length } as VkArticleBlock);
  };

  for (const node of article.childNodes) {
    if (!isElement(node)) continue;

    const tag = node.rawTagName?.toLowerCase();
    if (!tag) continue;

    // Skip the meta/info line; identity is read separately in parse-article.
    if (tag === "div" && node.classList.contains("article__info_line")) continue;

    switch (tag) {
      case "h1":
      case "h2":
      case "h3": {
        const { anchor, text } = readHeading(node);
        if (text) {
          const { type, level } = HEADING_TYPES[tag];
          push({ type, level, anchor, text });
        }
        break;
      }
      case "p": {
        const text = cleanText(node.text);
        if (text) {
          push({ type: "paragraph", text, html: node.innerHTML.trim(), marks: extractMarks(node) });
        }
        break;
      }
      case "blockquote": {
        if (isLinkList(node)) {
          const items = extractLinkListItems(node);
          if (items.length) push({ type: "list", items });
          break;
        }
        const text = cleanText(node.text);
        if (text) {
          push({ type: "quote", text, html: node.innerHTML.trim(), marks: extractMarks(node) });
        }
        break;
      }
      case "ul":
      case "ol": {
        const items = extractListItems(node);
        if (items.length) push({ type: "list", items });
        break;
      }
      case "figure": {
        const media = extractMedia(node);
        if (media) push({ type: classifyFigure(node), media });
        break;
      }
      case "hr": {
        push({ type: "divider" });
        break;
      }
      case "div": {
        // The only block-level <div> children are table wrappers; other <div>s
        // (e.g. the already-skipped info line) carry no content blocks.
        if (node.classList.contains("ArticleTableWrapper")) {
          const table = extractTable(node);
          if (table) push({ type: "table", ...table });
        }
        break;
      }
      default:
        break;
    }
  }

  return blocks;
};
