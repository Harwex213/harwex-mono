import { extname, isAbsolute, resolve } from "node:path";
import { parseArgs } from "node:util";

import { VkClient } from "../src/index.js";
import { DEFAULT_OUT_DIR, articleFileStem, renderArticle, writeArticle } from "./shared.js";

// One-command VK article parser: fetch -> parse -> render -> write <slug>.md.
// Invoked from anywhere via the root global script `yarn :vk-parse`.

const USAGE = `Usage: yarn :vk-parse <vk-article-url...> [-o <dir-or-file>]

Fetches VK article pages (vk.com/@owner-slug), parses them and writes
rendered Markdown.

Options:
  -o, --output   Target directory (default: faenwald-parser/out/).
                 A path with an extension (e.g. article.md) is treated as
                 an exact file target and allows only a single url.`;

const { values, positionals: urls } = parseArgs({
  options: { output: { type: "string", short: "o" } },
  allowPositionals: true,
});

if (urls.length === 0) {
  console.error(USAGE);
  process.exit(1);
}

// Relative -o resolves against where the user ran the command. The root
// `:vk-parse` script forwards that directory as VK_PARSE_CWD ($INIT_CWD gets
// reset by the nested `yarn workspace` invocation).
const userCwd = process.env["VK_PARSE_CWD"] || process.env["INIT_CWD"] || process.cwd();
const output = values.output;
const outputIsFile = output !== undefined && extname(output) !== "";

if (outputIsFile && urls.length > 1) {
  console.error("error: -o points to a file, but multiple urls were given");
  process.exit(1);
}

const resolveOut = (path: string): string => (isAbsolute(path) ? path : resolve(userCwd, path));
const outDir = output && !outputIsFile ? resolveOut(output) : DEFAULT_OUT_DIR;

const client = new VkClient({ minRequestIntervalMs: 1000 });
let failures = 0;

for (const url of urls) {
  try {
    const html = await client.fetchArticleHtml(url);
    const { article, text } = renderArticle(html, url);
    const outPath = outputIsFile
      ? resolveOut(output as string)
      : resolve(outDir, `${articleFileStem(article.meta.title, url)}.md`);

    await writeArticle(outPath, text);
    console.log(`Parsed ${article.blocks.length} blocks from ${url}`);
    console.log(`-> ${outPath}`);
  } catch (error) {
    failures += 1;
    console.error(`error: ${url}: ${(error as Error).message}`);
  }
}

if (failures > 0) process.exit(1);
