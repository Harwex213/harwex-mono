import { HTMLElement, Node, NodeType, parse } from "node-html-parser";

import type {
  VkArticle,
  VkArticleBlock,
  VkArticleListItem,
  VkArticleMedia,
} from "../model/article.js";
import { normalizeUrl } from "../utils.js";

export type PrinterOptions = {
  /** Heading underline / divider width, in characters. */
  width: number;
  /** Render inline marks (bold/italic/links) as Markdown rather than plain text. */
  markdown: boolean;
  /** Include the meta header (title, author, date, url) above the body. */
  showMeta: boolean;
};

const DEFAULT_OPTIONS: PrinterOptions = {
  width: 80,
  markdown: true,
  showMeta: true,
};

// Renders a parsed `VkArticle` into human-readable, terminal-friendly text.
// Stateless aside from its options, so a single instance can print many articles.
export class Printer {
  private readonly options: PrinterOptions;

  constructor(options: Partial<PrinterOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /** Build the full rendered article as a string. */
  print(article: VkArticle): string {
    const sections: string[] = [];

    if (this.options.showMeta) {
      sections.push(this.renderMeta(article));
    }

    for (const block of article.blocks) {
      const rendered = this.renderBlock(block);
      if (rendered) sections.push(rendered);
    }

    return sections.join("\n\n");
  }

  /** Render the article and write it straight to stdout. */
  printToConsole(article: VkArticle): void {
    console.log(this.print(article));
  }

  private renderMeta(article: VkArticle): string {
    const { meta } = article;
    const lines = [this.heading(meta.title, 1)];

    if (meta.author.name) {
      lines.push(`by ${meta.author.name}${meta.author.url ? ` <${meta.author.url}>` : ""}`);
    }
    if (meta.publishedAt) lines.push(meta.publishedAt);
    lines.push(meta.url);

    return lines.join("\n");
  }

  private renderBlock(block: VkArticleBlock): string {
    switch (block.type) {
      case "title":
        return this.heading(block.text, 1);
      case "header":
        return this.heading(block.text, 2);
      case "subheader":
        return this.heading(block.text, 3);
      case "paragraph":
        return this.renderInline(block.html, block.text);
      case "quote":
        return this.indent(this.renderInline(block.html, block.text), "> ");
      case "list":
        return block.items.map((item) => this.renderListItem(item)).join("\n");
      case "image":
      case "video":
      case "embed":
        return this.renderMedia(block.type, block.media);
      case "divider":
        return "─".repeat(this.options.width);
      case "table":
        return this.renderTable(block.headers, block.rows);
    }
  }

  // Markdown mode: a GitHub-flavoured pipe table (a header row is synthesized when
  // the source has none, since GFM requires one). Plain mode: tab-separated rows.
  private renderTable(headers: string[], rows: string[][]): string {
    const columns = Math.max(headers.length, 0, ...rows.map((row) => row.length));
    if (columns === 0) return "";

    if (!this.options.markdown) {
      const lines = headers.length ? [headers.join("\t")] : [];
      for (const row of rows) lines.push(row.join("\t"));
      return lines.join("\n");
    }

    const cell = (value: string | undefined): string => (value ?? "").replace(/\|/g, "\\|");
    const renderRow = (cells: string[]): string =>
      `| ${Array.from({ length: columns }, (_, i) => cell(cells[i])).join(" | ")} |`;

    const head = headers.length ? headers : (Array(columns).fill("") as string[]);
    const lines = [renderRow(head), `| ${Array(columns).fill("---").join(" | ")} |`];
    for (const row of rows) lines.push(renderRow(row));
    return lines.join("\n");
  }

  private renderListItem(item: VkArticleListItem): string {
    const text =
      this.options.markdown && item.href ? `[${item.text}](${item.href})` : item.text;
    return `• ${text}`;
  }

  private renderMedia(type: "image" | "video" | "embed", media: VkArticleMedia): string {
    const label = type.toUpperCase();
    const dimensions =
      media.width && media.height ? ` ${media.width}×${media.height}` : "";
    const lines = [`[${label}${dimensions}] ${media.url}`];

    if (media.caption) lines.push(media.caption);
    else if (media.alt) lines.push(media.alt);

    return lines.join("\n");
  }

  // Render inline content. In markdown mode we reconstruct from the block's
  // `html` (the faithful source that preserves the order of plain text and
  // marks); the flat `marks` summary can't tell us where unmarked text sits, so
  // rebuilding from it would silently drop every plain-text segment. Plain mode
  // (and an empty/markup-less html) falls back to the already-flattened `text`.
  private renderInline(html: string, text: string): string {
    if (!this.options.markdown) return text;
    const rendered = this.htmlToMarkdown(html).replace(/[ \t]+\n/g, "\n").trim();
    return rendered || text;
  }

  // Convert VK's inline paragraph/quote HTML into Markdown, preserving text order.
  private htmlToMarkdown(html: string): string {
    const render = (node: Node): string => {
      if (node.nodeType === NodeType.TEXT_NODE) return node.text.replace(/\s+/g, " ");
      if (node.nodeType !== NodeType.ELEMENT_NODE) return "";

      const el = node as HTMLElement;
      const inner = el.childNodes.map(render).join("");
      switch (el.rawTagName?.toLowerCase()) {
        case "strong":
        case "b":
          return inner.trim() ? `**${inner}**` : inner;
        case "em":
        case "i":
          return inner.trim() ? `*${inner}*` : inner;
        case "a": {
          const href = el.getAttribute("href");
          return href ? `[${inner}](${normalizeUrl(href)})` : inner;
        }
        case "br":
          return "\n";
        default:
          return inner;
      }
    };

    return parse(html).childNodes.map(render).join("");
  }

  private heading(text: string, level: 1 | 2 | 3): string {
    if (this.options.markdown) return `${"#".repeat(level)} ${text}`;

    // Plain mode: underline level-1/2, prefix level-3.
    if (level === 3) return `## ${text}`;
    const rule = (level === 1 ? "═" : "─").repeat(Math.min(text.length, this.options.width));
    return `${text}\n${rule}`;
  }

  private indent(text: string, prefix: string): string {
    return text
      .split("\n")
      .map((line) => `${prefix}${line}`)
      .join("\n");
  }
}
