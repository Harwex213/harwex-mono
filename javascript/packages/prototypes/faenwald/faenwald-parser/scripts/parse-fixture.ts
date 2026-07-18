import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

import { DEFAULT_OUT_DIR, articleFileStem, renderArticle, writeArticle } from "./shared.js";

// Offline smoke check: run the bundled reference fixture through the full
// parse -> render pipeline. There is no test suite; this is the regression gate.

const FIXTURE_URL = "https://vk.com/@faenwald-cf-voenaya-sistema";
const FIXTURE_PATH = new URL("../assets/faenwald.html", import.meta.url);

const html = await readFile(FIXTURE_PATH, "utf-8");
const { article, text } = renderArticle(html, FIXTURE_URL);
const outPath = resolve(DEFAULT_OUT_DIR, `${articleFileStem(article.meta.title, FIXTURE_URL)}.md`);

await writeArticle(outPath, text);

console.log(`Parsed ${article.blocks.length} blocks from the bundled fixture`);
console.log(`-> ${outPath}`);
