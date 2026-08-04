// The VK article editor emits misnested inline formatting, e.g.
//
//   <p><strong><em>WICHTIG</strong>: rest of the sentence </em></p>
//
// A browser repairs that with the HTML5 adoption agency algorithm.
// `node-html-parser` does not: a close tag that is not the innermost open
// element makes it unwind the stack and *drop* nodes, so the whole
// `div.article` disappears from the tree and `parseArticle` reports
// "article container not found".
//
// This pass rewrites such runs into well-nested markup before parsing.
// Inner tags are closed before the outer close tag and reopened after it,
// inline tags still open at the end of their block are closed there, and
// close tags with no matching open tag are dropped. Anything the pass is not
// sure about is left verbatim.

// Text-formatting tags only. Block-level nesting in VK markup is sound, and
// reordering block tags would move content between blocks.
const INLINE_TAGS = new Set([
  "a",
  "b",
  "big",
  "code",
  "del",
  "em",
  "font",
  "i",
  "ins",
  "mark",
  "s",
  "small",
  "span",
  "strike",
  "strong",
  "sub",
  "sup",
  "tt",
  "u",
]);

// Never on the open-element stack. The SVG shapes are here because VK's icons
// are large and serializing them without the trailing slash would be enough to
// desync the stack.
const VOID_TAGS = new Set([
  "area",
  "base",
  "br",
  "circle",
  "col",
  "ellipse",
  "embed",
  "hr",
  "img",
  "input",
  "line",
  "link",
  "meta",
  "param",
  "path",
  "polygon",
  "polyline",
  "rect",
  "source",
  "stop",
  "track",
  "use",
  "wbr",
]);

// Their text content is not markup, so tags inside them must be left alone.
const RAW_TEXT_TAGS = new Set(["script", "style", "textarea", "title"]);

const TAG = /<(!--|\/?)([a-zA-Z][a-zA-Z0-9:-]*)?((?:"[^"]*"|'[^']*'|[^>"'])*?)(\/?)>/g;

type OpenTag = {
  tag: string;
  /** The original opening tag, re-emitted verbatim when the tag is reopened. */
  raw: string;
  inline: boolean;
};

const repairInlineNesting = (html: string): string => {
  const out: string[] = [];
  const stack: OpenTag[] = [];
  let cursor = 0;
  let match: RegExpExecArray | null;

  TAG.lastIndex = 0;
  while ((match = TAG.exec(html)) !== null) {
    const [raw, prefix, rawName, , selfClosing] = match;

    // Comments carry no structure; skip to the real end so a `<` inside one
    // cannot be mistaken for a tag.
    if (prefix === "!--") {
      const end = html.indexOf("-->", match.index + 4);
      TAG.lastIndex = end < 0 ? html.length : end + 3;
      continue;
    }
    if (!rawName) {
      continue;
    }

    const tag = rawName.toLowerCase();
    const inline = INLINE_TAGS.has(tag);

    if (prefix !== "/") {
      if (RAW_TEXT_TAGS.has(tag)) {
        const end = html.indexOf(`</${tag}`, TAG.lastIndex);
        TAG.lastIndex = end < 0 ? html.length : end;
        continue;
      }
      if (!selfClosing && !VOID_TAGS.has(tag)) {
        stack.push({ tag, raw, inline });
      }
      continue;
    }

    const depth = stack.findLastIndex((entry) => entry.tag === tag);
    if (depth < 0) {
      // No matching open tag. A stray inline close is what unwinds
      // node-html-parser, so drop it; leave anything else alone.
      if (inline) {
        out.push(html.slice(cursor, match.index));
        cursor = match.index + raw.length;
      }
      continue;
    }

    const above = stack.slice(depth + 1);
    stack.length = depth;

    if (above.length === 0) {
      continue;
    }
    // An unclosed block sits inside this element — out of scope for this pass.
    if (!above.every((entry) => entry.inline)) {
      continue;
    }

    out.push(html.slice(cursor, match.index));
    cursor = match.index + raw.length;
    for (const entry of [...above].reverse()) {
      out.push(`</${entry.tag}>`);
    }
    out.push(raw);

    // The inner formatting still applies to the text after an inline close
    // tag, but not past the end of a block.
    if (inline) {
      for (const entry of above) {
        out.push(entry.raw);
        stack.push(entry);
      }
    }
  }

  if (out.length === 0) {
    return html;
  }

  out.push(html.slice(cursor));
  return out.join("");
};

export { repairInlineNesting };
