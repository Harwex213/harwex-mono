import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { FC, MouseEvent } from "react";

type TMarkdownRenderedProps = {
  text: string;
  resolveImageUrl?: (src: string) => string;
  onLinkClick?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
};

const isExternalHref = (href: string): boolean => {
  return /^https?:\/\//i.test(href);
};

const REMARK_PLUGINS = [remarkGfm];

const MarkdownRendered: FC<TMarkdownRenderedProps> = ({ text, resolveImageUrl, onLinkClick }) => {
  const components: Components = {
    a: ({ href, children, node: _node, ...rest }) => {
      const target = href ?? "";
      const external = isExternalHref(target);

      return (
        <a
          {...rest}
          href={target}
          onClick={(event) => {
            if (onLinkClick) {
              onLinkClick(target, event);

              return;
            }

            // Without a host handler only external links do anything. A relative href would
            // navigate the app away, which MD-8 forbids.
            if (!external) {
              event.preventDefault();
            }
          }}
          rel={external ? "noreferrer" : undefined}
          target={external ? "_blank" : undefined}
        >
          {children}
        </a>
      );
    },
    img: ({ src, alt, node: _node, ...rest }) => {
      const source = typeof src === "string" ? src : "";
      const resolved =
        resolveImageUrl && !isExternalHref(source) && !source.startsWith("data:")
          ? resolveImageUrl(source)
          : source;

      return <img {...rest} alt={alt ?? ""} src={resolved} />;
    },
    // A task list checkbox is content, not a control (MD-10).
    input: ({ node: _node, ...rest }) => {
      return <input {...rest} disabled readOnly />;
    },
  };

  return (
    <article className="markdown-viewer__rendered">
      {/* react-markdown never emits raw HTML without a rehype plugin, so scripts and event
          handlers written into the source are dropped as text (MD-9). */}
      <Markdown components={components} remarkPlugins={REMARK_PLUGINS}>
        {text}
      </Markdown>
    </article>
  );
};

export { MarkdownRendered };
