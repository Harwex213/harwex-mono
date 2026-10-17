import { z } from "zod";
import { fsNodeIdSchema } from "./fs.js";

// A term of one character filters on names only (SRCH-10).
const MIN_CONTENT_SEARCH_TERM_LENGTH = 2;

// The client asks for the vault in slices of this many files, so results appear while the
// search is still running (SRCH-16) and a stale search stops after the current slice.
// The ids travel in the query string, so a slice stays well under URL length limits.
const MAX_CONTENT_SEARCH_NODE_IDS = 100;

const searchContentInputSchema = z.object({
  term: z.string().min(MIN_CONTENT_SEARCH_TERM_LENGTH).max(1000),
  // The files to search. An id that is no longer in the tree, a folder, and a file that
  // cannot be opened are skipped silently: those match on their name alone (SRCH-7).
  nodeIds: z.array(fsNodeIdSchema).max(MAX_CONTENT_SEARCH_NODE_IDS),
});

const contentMatchSchema = z.object({
  nodeId: fsNodeIdSchema,
  // How many times the term occurs in the file (SRCH-13). Always above zero.
  count: z.number().int().positive(),
});

const searchContentResultSchema = z.object({
  matches: z.array(contentMatchSchema),
});

type TSearchContentInput = z.infer<typeof searchContentInputSchema>;
type TContentMatch = z.infer<typeof contentMatchSchema>;
type TSearchContentResult = z.infer<typeof searchContentResultSchema>;

// Ignores case and takes the term as plain text (SRCH-9). Occurrences do not overlap:
// "aa" occurs twice in "aaaa", not three times.
const countTermOccurrences = (text: string, term: string): number => {
  if (term.length === 0) {
    return 0;
  }

  const lowerText = text.toLowerCase();
  const lowerTerm = term.toLowerCase();
  let count = 0;
  let index = lowerText.indexOf(lowerTerm);

  while (index !== -1) {
    count += 1;
    index = lowerText.indexOf(lowerTerm, index + lowerTerm.length);
  }

  return count;
};

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readElementText = (element: Record<string, unknown>): string | null => {
  if (element["type"] === "text") {
    // Excalidraw breaks the text of a shape label at the shape's width. The original text
    // is what the user typed, without those breaks.
    const originalText = element["originalText"];
    if (typeof originalText === "string") {
      return originalText;
    }

    const text = element["text"];

    return typeof text === "string" ? text : null;
  }

  if (element["type"] === "frame" || element["type"] === "magicframe") {
    const name = element["name"];

    return typeof name === "string" ? name : null;
  }

  return null;
};

// Only the text the user typed into a drawing: text elements and frame names. Ids,
// colours and the rest of the shape data are never searched (SRCH-6). Each piece sits on
// its own line, so a term never spans two text elements.
const readExcalidrawSearchText = (elements: readonly unknown[]): string => {
  const pieces: string[] = [];

  for (const element of elements) {
    if (!isRecord(element) || element["isDeleted"] === true) {
      continue;
    }

    const text = readElementText(element);
    if (text !== null) {
      pieces.push(text);
    }
  }

  return pieces.join("\n");
};

const HIDDEN_HTML_BLOCK_PATTERN = /<(script|style|title|template|noscript)\b[\s\S]*?<\/\1\s*>/gi;
const HTML_COMMENT_PATTERN = /<!--[\s\S]*?-->/g;
const HTML_TAG_PATTERN = /<\/?([a-zA-Z][a-zA-Z0-9-]*|!)[^>]*>/g;
const HTML_ENTITY_PATTERN = /&(#x[0-9a-fA-F]+|#[0-9]+|[a-zA-Z]+);/g;

// Tags that sit inside a line of text. They are dropped without a break, so a word with
// a bold part still matches as one word.
const INLINE_HTML_TAGS: ReadonlySet<string> = new Set([
  "a", "abbr", "b", "bdi", "bdo", "cite", "code", "data", "dfn", "em", "i", "kbd", "mark",
  "q", "s", "samp", "small", "span", "strong", "sub", "sup", "time", "u", "var", "wbr",
]);

const replaceHtmlTag = (_match: string, tagName: string): string => {
  return INLINE_HTML_TAGS.has(tagName.toLowerCase()) ? "" : "\n";
};

const NAMED_HTML_ENTITIES: Readonly<Record<string, string>> = {
  amp: "&",
  lt: "<",
  gt: ">",
  quot: "\"",
  apos: "'",
  nbsp: " ",
};

const decodeHtmlEntity = (match: string, body: string): string => {
  if (body.startsWith("#")) {
    const isHex = body[1] === "x" || body[1] === "X";
    const codePoint = Number.parseInt(body.slice(isHex ? 2 : 1), isHex ? 16 : 10);

    if (Number.isNaN(codePoint) || codePoint > 0x10ffff) {
      return match;
    }

    return String.fromCodePoint(codePoint);
  }

  return NAMED_HTML_ENTITIES[body.toLowerCase()] ?? match;
};

// The text a page shows: tags, comments, scripts, styles and the title are dropped, and
// common entities are decoded. A block tag becomes a line break, so a term never spans
// two paragraphs.
const readHtmlSearchText = (html: string): string => {
  return html
    .replace(HTML_COMMENT_PATTERN, "\n")
    .replace(HIDDEN_HTML_BLOCK_PATTERN, "\n")
    .replace(HTML_TAG_PATTERN, replaceHtmlTag)
    .replace(HTML_ENTITY_PATTERN, decodeHtmlEntity);
};

export {
  MIN_CONTENT_SEARCH_TERM_LENGTH,
  MAX_CONTENT_SEARCH_NODE_IDS,
  searchContentInputSchema,
  contentMatchSchema,
  searchContentResultSchema,
  countTermOccurrences,
  readExcalidrawSearchText,
  readHtmlSearchText,
};
export type { TSearchContentInput, TContentMatch, TSearchContentResult };
