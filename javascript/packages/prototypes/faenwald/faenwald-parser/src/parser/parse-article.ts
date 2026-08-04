import { parse, type HTMLElement } from "node-html-parser";

import type { VkArticle, VkArticleAuthor } from "../model/article.js";
import { FaenwaldParserError } from "../model/parser-error.js";
import { cleanText, normalizeUrl } from "../utils.js";
import { extractBlocks } from "./extract-blocks.js";
import { repairInlineNesting } from "./repair-inline-nesting.js";

const metaContent = (root: HTMLElement, property: string): string | null =>
  root.querySelector(`meta[property="${property}"]`)?.getAttribute("content")?.trim() ?? null;

// id="article_view_-234725042_305324" -> "-234725042_305324"
const extractArticleId = (article: HTMLElement): string | null => {
  const id = article.getAttribute("id");
  if (id?.startsWith("article_view_")) return id.slice("article_view_".length);
  return null;
};

// "-234725042_305324" -> "-234725042"
const extractOwnerId = (id: string): string | undefined => {
  const underscore = id.indexOf("_");
  return underscore > 0 ? id.slice(0, underscore) : undefined;
};

// The info line reads "FAENWALD · 26. Dez. 2025": owner is the leading link, the
// date the text after the `·` divider (analyze-article.md §1.4, §1.5).
const extractAuthor = (article: HTMLElement): VkArticleAuthor => {
  const link = article.querySelector(".article__info_line .group_link");
  const name = link ? cleanText(link.text) : "";
  const href = link?.getAttribute("href");
  return {
    name: name || undefined,
    url: href ? normalizeUrl(href) : undefined,
  };
};

const extractPublishedAt = (article: HTMLElement): string | undefined => {
  const infoLine = article.querySelector(".article__info_line");
  if (!infoLine) return undefined;
  const full = cleanText(infoLine.text);
  const divider = full.lastIndexOf("·");
  const date = divider >= 0 ? full.slice(divider + 1) : full;
  return cleanText(date) || undefined;
};

export type ParseArticleOptions = {
  /** Used as the canonical url when the page omits og:url. */
  sourceUrl?: string;
  /** ISO timestamp recorded in `meta.parsedAt`; defaults to now. */
  parsedAt?: string;
};

export const parseArticle = (html: string, options: ParseArticleOptions = {}): VkArticle => {
  const root = parse(repairInlineNesting(html));

  const article =
    root.querySelector("div.article.article_view") ?? root.querySelector(".article");
  if (!article) {
    throw new FaenwaldParserError("article container (.article.article_view) not found");
  }

  const blocks = extractBlocks(article);

  const ogTitle = metaContent(root, "og:title");
  const headingTitle = article.querySelector("h1")?.text;
  const title = cleanText(ogTitle ?? headingTitle ?? "");
  if (!title) {
    throw new FaenwaldParserError("could not determine article title");
  }

  const url =
    metaContent(root, "og:url") ??
    (options.sourceUrl ? normalizeUrl(options.sourceUrl) : null) ??
    normalizeUrl(article.getAttribute("data-article-url") ?? "");

  const id = extractArticleId(article) ?? url;

  return {
    meta: {
      id,
      ownerId: extractOwnerId(id),
      title,
      url,
      author: extractAuthor(article),
      publishedAt: extractPublishedAt(article),
      source: "vk.com",
      parsedAt: options.parsedAt ?? new Date().toISOString(),
    },
    blocks,
  };
};
