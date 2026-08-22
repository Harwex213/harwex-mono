import DOMPurify from "dompurify";
import { marked } from "marked";
import { useMemo } from "react";

marked.setOptions({
  gfm: true,
  breaks: false,
});

/** Agent answers arrive as markdown; sanitized because it is injected as HTML. */
function Markdown({ text }: { text: string }) {
  const html = useMemo(() => {
    if (text.trim().length === 0) {
      return "";
    }
    return DOMPurify.sanitize(marked.parse(text, { async: false }));
  }, [text]);

  if (html.length === 0) {
    return null;
  }
  return <div className="markdown" dangerouslySetInnerHTML={{ __html: html }} />;
}

export { Markdown };
