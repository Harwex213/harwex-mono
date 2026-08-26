type TInlineToken =
  | { type: "text"; text: string }
  | { type: "strong"; text: string }
  | { type: "em"; text: string }
  | { type: "code"; text: string }
  | { type: "link"; text: string; href: string };

type TListItem = {
  tokens: readonly TInlineToken[];
  checked: boolean | null;
};

type TMarkdownBlock =
  | { type: "heading"; level: number; tokens: readonly TInlineToken[] }
  | { type: "paragraph"; tokens: readonly TInlineToken[] }
  | { type: "list"; ordered: boolean; items: readonly TListItem[] }
  | { type: "quote"; tokens: readonly TInlineToken[] }
  | { type: "code"; language: string; text: string }
  | { type: "table"; header: readonly string[]; rows: readonly (readonly string[])[] }
  | { type: "divider" };

const INLINE_PATTERN = /`([^`]+)`|\*\*([^*]+)\*\*|\*([^*]+)\*|\[([^\]]+)\]\(([^)]+)\)/g;

const HEADING_PATTERN = /^(#{1,6})\s+(.*)$/;
const UNORDERED_PATTERN = /^[-*]\s+(.*)$/;
const ORDERED_PATTERN = /^\d+[.)]\s+(.*)$/;
const TASK_PATTERN = /^\[([ xX])\]\s+(.*)$/;
const QUOTE_PATTERN = /^>\s?(.*)$/;
const FENCE_PATTERN = /^```(\w*)\s*$/;
const DIVIDER_PATTERN = /^(-{3,}|\*{3,}|_{3,})$/;
const TABLE_DIVIDER_PATTERN = /^\|?[\s:|-]+\|[\s:|-]*$/;

const parseInline = (source: string): readonly TInlineToken[] => {
  const tokens: TInlineToken[] = [];
  let lastIndex = 0;

  INLINE_PATTERN.lastIndex = 0;

  let match = INLINE_PATTERN.exec(source);
  while (match !== null) {
    if (match.index > lastIndex) {
      tokens.push({ type: "text", text: source.slice(lastIndex, match.index) });
    }

    const [full, code, strong, em, linkText, href] = match;

    if (code !== undefined) {
      tokens.push({ type: "code", text: code });
    } else if (strong !== undefined) {
      tokens.push({ type: "strong", text: strong });
    } else if (em !== undefined) {
      tokens.push({ type: "em", text: em });
    } else if (linkText !== undefined && href !== undefined) {
      tokens.push({ type: "link", text: linkText, href });
    }

    lastIndex = match.index + full.length;
    match = INLINE_PATTERN.exec(source);
  }

  if (lastIndex < source.length) {
    tokens.push({ type: "text", text: source.slice(lastIndex) });
  }

  return tokens;
};

const splitTableRow = (line: string): readonly string[] =>
  line
    .replace(/^\|/, "")
    .replace(/\|$/, "")
    .split("|")
    .map((cell) => cell.trim());

const parseListItem = (source: string): TListItem => {
  const taskMatch = TASK_PATTERN.exec(source);
  if (taskMatch === null) {
    return { tokens: parseInline(source), checked: null };
  }

  const [, marker = " ", rest = ""] = taskMatch;

  return {
    tokens: parseInline(rest),
    checked: marker.toLowerCase() === "x",
  };
};

const parseMarkdown = (source: string): readonly TMarkdownBlock[] => {
  const lines = source.replace(/\r\n/g, "\n").split("\n");
  const blocks: TMarkdownBlock[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index] ?? "";
    const trimmed = line.trim();

    if (trimmed === "") {
      index += 1;

      continue;
    }

    const fenceMatch = FENCE_PATTERN.exec(trimmed);
    if (fenceMatch !== null) {
      const codeLines: string[] = [];
      index += 1;

      while (index < lines.length && !FENCE_PATTERN.test((lines[index] ?? "").trim())) {
        codeLines.push(lines[index] ?? "");
        index += 1;
      }

      index += 1;
      blocks.push({
        type: "code",
        language: fenceMatch[1] ?? "",
        text: codeLines.join("\n"),
      });

      continue;
    }

    if (DIVIDER_PATTERN.test(trimmed)) {
      blocks.push({ type: "divider" });
      index += 1;

      continue;
    }

    const headingMatch = HEADING_PATTERN.exec(trimmed);
    if (headingMatch !== null) {
      blocks.push({
        type: "heading",
        level: (headingMatch[1] ?? "#").length,
        tokens: parseInline(headingMatch[2] ?? ""),
      });
      index += 1;

      continue;
    }

    const nextLine = (lines[index + 1] ?? "").trim();
    if (trimmed.includes("|") && TABLE_DIVIDER_PATTERN.test(nextLine)) {
      const header = splitTableRow(trimmed);
      const rows: (readonly string[])[] = [];
      index += 2;

      while (index < lines.length && (lines[index] ?? "").trim().includes("|")) {
        rows.push(splitTableRow((lines[index] ?? "").trim()));
        index += 1;
      }

      blocks.push({ type: "table", header, rows });

      continue;
    }

    const quoteMatch = QUOTE_PATTERN.exec(trimmed);
    if (quoteMatch !== null) {
      const quoteLines: string[] = [quoteMatch[1] ?? ""];
      index += 1;

      while (index < lines.length) {
        const nextQuote = QUOTE_PATTERN.exec((lines[index] ?? "").trim());
        if (nextQuote === null) {
          break;
        }

        quoteLines.push(nextQuote[1] ?? "");
        index += 1;
      }

      blocks.push({ type: "quote", tokens: parseInline(quoteLines.join(" ").trim()) });

      continue;
    }

    const unorderedMatch = UNORDERED_PATTERN.exec(trimmed);
    const orderedMatch = ORDERED_PATTERN.exec(trimmed);
    if (unorderedMatch !== null || orderedMatch !== null) {
      const ordered = orderedMatch !== null;
      const pattern = ordered ? ORDERED_PATTERN : UNORDERED_PATTERN;
      const items: TListItem[] = [];

      while (index < lines.length) {
        const itemMatch = pattern.exec((lines[index] ?? "").trim());
        if (itemMatch === null) {
          break;
        }

        items.push(parseListItem(itemMatch[1] ?? ""));
        index += 1;
      }

      blocks.push({ type: "list", ordered, items });

      continue;
    }

    const paragraphLines: string[] = [];
    while (index < lines.length) {
      const paragraphLine = (lines[index] ?? "").trim();
      if (
        paragraphLine === ""
        || HEADING_PATTERN.test(paragraphLine)
        || QUOTE_PATTERN.test(paragraphLine)
        || UNORDERED_PATTERN.test(paragraphLine)
        || ORDERED_PATTERN.test(paragraphLine)
        || FENCE_PATTERN.test(paragraphLine)
        || DIVIDER_PATTERN.test(paragraphLine)
      ) {
        break;
      }

      paragraphLines.push(paragraphLine);
      index += 1;
    }

    blocks.push({ type: "paragraph", tokens: parseInline(paragraphLines.join(" ")) });
  }

  return blocks;
};

export type { TInlineToken, TListItem, TMarkdownBlock };
export { parseMarkdown };
