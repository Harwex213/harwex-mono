import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { Printer, parseArticle } from "../src/index.js";
import type { VkArticle } from "../src/index.js";

/** Package root (scripts/ lives one level below it). */
export const PACKAGE_ROOT = fileURLToPath(new URL("..", import.meta.url));

/** Default output directory for rendered articles (gitignored). */
export const DEFAULT_OUT_DIR = resolve(PACKAGE_ROOT, "out");

/** Parse article HTML and render it to Markdown. */
export function renderArticle(html: string, sourceUrl: string): { article: VkArticle; text: string } {
  const article = parseArticle(html, { sourceUrl });
  return { article, text: new Printer().print(article) };
}

/** Write rendered article text, creating parent directories as needed. */
export async function writeArticle(filePath: string, text: string): Promise<void> {
  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(filePath, `${text}\n`, "utf-8");
}

/** Build a filesystem-safe file stem: prefer the url's `@slug`, fall back to the title. */
export function articleFileStem(title: string, sourceUrl: string): string {
  const slug = sourceUrl.match(/@([^/?#]+)/)?.[1];
  return slugify(slug ?? title) || "article";
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}
