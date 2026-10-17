import {
  countTermOccurrences,
  readExcalidrawSearchText,
  readHtmlSearchText,
} from "@hw/harwex-notes-protocol";
import type {
  TContentMatch,
  TFsNode,
  TFsNodeKind,
  TSearchContentInput,
  TSearchContentResult,
} from "@hw/harwex-notes-protocol";
import type { TContext } from "../trpc.js";

// Turns the decoded text of a file into the text that search looks at. Returning null
// means the file matches on its name alone (SRCH-7).
type TSearchStrategy = (text: string) => string | null;

// A file larger than this is not read by search and matches on its name alone (SRCH-30).
// The cap is below the open limit of VAULT-4, so one large file cannot stall a search of
// the whole vault.
const MAX_SEARCH_FILE_MEGABYTES = 8;
const MAX_SEARCH_FILE_BYTES = MAX_SEARCH_FILE_MEGABYTES * 1024 * 1024;

// Files are read a few at a time. A large vault is searched faster than one by one, and
// a search does not open thousands of files at once.
const SEARCH_READ_CONCURRENCY = 8;

const searchPlainText: TSearchStrategy = (text) => text;

// Only the text typed into the drawing (SRCH-6). A file that is not a drawing has no
// such text.
const searchExcalidraw: TSearchStrategy = (text) => {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }

    const elements = (parsed as Record<string, unknown>)["elements"];

    return Array.isArray(elements) ? readExcalidrawSearchText(elements) : null;
  } catch {
    return null;
  }
};

// The text the page shows, without markup, scripts or styles.
const searchHtml: TSearchStrategy = (text) => readHtmlSearchText(text);

// One strategy per node kind. A kind without a strategy matches on its name alone: an
// image is not text, and a file of kind "file" cannot be opened (SRCH-7). Markdown and
// plain text are searched as written, markup included (SRCH-25).
const STRATEGY_BY_KIND: Readonly<Record<TFsNodeKind, TSearchStrategy | null>> = {
  folder: null,
  markdown: searchPlainText,
  text: searchPlainText,
  excalidraw: searchExcalidraw,
  html: searchHtml,
  image: null,
  file: null,
};

const readSearchStrategy = (node: TFsNode): TSearchStrategy | null => {
  return STRATEGY_BY_KIND[node.kind];
};

// Null for bytes that are not text (VAULT-5), the same test fetchDocument applies.
const decodeSearchText = (bytes: Uint8Array): string | null => {
  if (bytes.includes(0)) {
    return null;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
};

const countInNode = async (ctx: TContext, node: TFsNode, term: string): Promise<number> => {
  const strategy = readSearchStrategy(node);
  if (strategy === null) {
    return 0;
  }

  try {
    const size = await ctx.dataAccess.readFileSize(node.id);
    if (size > MAX_SEARCH_FILE_BYTES) {
      return 0;
    }

    const text = decodeSearchText(await ctx.dataAccess.readFile(node.id));
    if (text === null) {
      return 0;
    }

    const searchText = strategy(text);

    return searchText === null ? 0 : countTermOccurrences(searchText, term);
  } catch {
    // A file that vanished or cannot be read while the search runs matches on its name
    // alone, and the rest of the search goes on.
    return 0;
  }
};

// Counts the term in each given file. Ids that are no longer in the tree are skipped, so
// a file deleted mid-search simply drops out (SRCH-15). Search only reads (SRCH-18).
const searchContent = async (
  ctx: TContext,
  input: TSearchContentInput
): Promise<TSearchContentResult> => {
  const nodeById = new Map(ctx.dataAccess.tree.map((node) => [node.id, node]));
  const nodes = [...new Set(input.nodeIds)]
    .map((nodeId) => nodeById.get(nodeId))
    .filter((node): node is TFsNode => node !== undefined);

  const counts: number[] = new Array(nodes.length).fill(0);
  let nextIndex = 0;

  const worker = async () => {
    while (nextIndex < nodes.length) {
      const index = nextIndex;
      nextIndex += 1;
      counts[index] = await countInNode(ctx, nodes[index] as TFsNode, input.term);
    }
  };

  await Promise.all(Array.from({ length: SEARCH_READ_CONCURRENCY }, worker));

  const matches: TContentMatch[] = [];

  nodes.forEach((node, index) => {
    const count = counts[index] ?? 0;

    if (count > 0) {
      matches.push({ nodeId: node.id, count });
    }
  });

  return { matches };
};

export { MAX_SEARCH_FILE_BYTES, STRATEGY_BY_KIND, searchContent };
export type { TSearchStrategy };
