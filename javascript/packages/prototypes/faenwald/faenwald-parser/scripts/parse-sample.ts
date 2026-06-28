import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

import { parseArticle, Printer, VkClient } from "../src/index.js";

// Sample VK article this parser was built against (used when no url is passed).
const SAMPLE_URL = "https://vk.com/@faenwald-cf-voenaya-sistema";
const SAMPLE_FIXTURE = new URL("../assets/faenwald.html", import.meta.url);

// flow: article url -> fetch html -> parse -> render -> write [article-name].txt
const url = process.argv[2] ?? SAMPLE_URL;
const isLive = process.argv[2] !== undefined;

const html = isLive
  ? await new VkClient({ minRequestIntervalMs: 1000 }).fetchArticleHtml(url)
  : await readFile(SAMPLE_FIXTURE, "utf-8");

const article = parseArticle(html, { sourceUrl: url });
const text = new Printer().print(article);

const outPath = resolve(process.cwd(), `${articleName(article.meta.title, url)}.txt`);
await writeFile(outPath, `${text}\n`, "utf-8");

console.log(`Parsed ${article.blocks.length} blocks from ${url}`);
console.log(`-> ${outPath}`);

// Build a filesystem-safe file stem: prefer the url's `@slug`, fall back to the title.
function articleName(title: string, sourceUrl: string): string {
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
