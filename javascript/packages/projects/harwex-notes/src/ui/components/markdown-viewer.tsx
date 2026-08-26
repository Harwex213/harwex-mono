import { parseMarkdown } from "../markdown/parse-markdown";
import type { FC, ReactNode } from "react";
import type { TInlineToken, TMarkdownBlock } from "../markdown/parse-markdown";

type TMarkdownViewerProps = {
  text: string;
};

const renderInline = (tokens: readonly TInlineToken[]): ReactNode =>
  tokens.map((token, index) => {
    const key = `${token.type}-${index}`;

    if (token.type === "strong") {
      return <strong key={key}>{token.text}</strong>;
    }

    if (token.type === "em") {
      return <em key={key}>{token.text}</em>;
    }

    if (token.type === "code") {
      return <code className="md__inline-code" key={key}>{token.text}</code>;
    }

    if (token.type === "link") {
      return (
        <a className="md__link" href={token.href} key={key} rel="noreferrer" target="_blank">
          {token.text}
        </a>
      );
    }

    return <span key={key}>{token.text}</span>;
  });

const renderBlock = (block: TMarkdownBlock, index: number): ReactNode => {
  const key = `${block.type}-${index}`;

  if (block.type === "heading") {
    const level = Math.min(block.level, 4);
    const Tag = `h${level}` as "h1" | "h2" | "h3" | "h4";

    return (
      <Tag className={`md__heading md__heading--${level}`} key={key}>
        {renderInline(block.tokens)}
      </Tag>
    );
  }

  if (block.type === "paragraph") {
    return <p className="md__paragraph" key={key}>{renderInline(block.tokens)}</p>;
  }

  if (block.type === "quote") {
    return <blockquote className="md__quote" key={key}>{renderInline(block.tokens)}</blockquote>;
  }

  if (block.type === "code") {
    return (
      <pre className="md__code" key={key}>
        {block.language === "" ? null : (
          <span className="md__code-language">{block.language}</span>
        )}
        <code>{block.text}</code>
      </pre>
    );
  }

  if (block.type === "divider") {
    return <hr className="md__divider" key={key} />;
  }

  if (block.type === "table") {
    return (
      <div className="md__table-scroll" key={key}>
        <table className="md__table">
          <thead>
            <tr>
              {block.header.map((cell, cellIndex) => (
                <th key={`h-${cellIndex}`}>{renderInline([{ type: "text", text: cell }])}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {block.rows.map((row, rowIndex) => (
              <tr key={`r-${rowIndex}`}>
                {row.map((cell, cellIndex) => (
                  <td key={`c-${cellIndex}`}>{cell}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  const items = block.items.map((item, itemIndex) => {
    if (item.checked === null) {
      return <li key={`i-${itemIndex}`}>{renderInline(item.tokens)}</li>;
    }

    return (
      <li className="md__task" key={`i-${itemIndex}`}>
        <span className={`md__checkbox${item.checked ? " md__checkbox--checked" : ""}`}>
          {item.checked ? "✓" : ""}
        </span>
        <span className={item.checked ? "md__task-done" : undefined}>
          {renderInline(item.tokens)}
        </span>
      </li>
    );
  });

  if (block.ordered) {
    return <ol className="md__list md__list--ordered" key={key}>{items}</ol>;
  }

  return <ul className="md__list" key={key}>{items}</ul>;
};

const MarkdownViewer: FC<TMarkdownViewerProps> = ({ text }) => {
  const blocks = parseMarkdown(text);

  return (
    <article className="md">
      {blocks.map(renderBlock)}
    </article>
  );
};

export { MarkdownViewer };
