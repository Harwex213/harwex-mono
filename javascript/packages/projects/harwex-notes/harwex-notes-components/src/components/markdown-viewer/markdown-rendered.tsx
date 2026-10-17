import { useState } from "react";
import Markdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Components } from "react-markdown";
import type { FC, MouseEvent } from "react";

type TMarkdownRenderedProps = {
  text: string;
  resolveImageUrl?: (src: string) => string | null;
  onLinkClick?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
};

const isExternalHref = (href: string): boolean => {
  return /^https?:\/\//i.test(href);
};

// An image the browser loads as it is: a web address or inline data. Every other source
// is a path inside the vault (MD-5).
const PASS_THROUGH_SRC_PATTERN = /^(https?:|data:|blob:)/i;

type TMarkdownImageProps = {
  src: string | null;
  alt: string;
  title?: string;
};

// A path that names no image, or an image the browser cannot draw, leaves a visible
// placeholder in the document instead of an empty gap (VIEW-4).
const MarkdownImage: FC<TMarkdownImageProps> = ({ src, alt, title }) => {
  const [failedSrc, setFailedSrc] = useState<string | null>(null);

  if (src === null || src === "" || failedSrc === src) {
    return (
      <span className="markdown-viewer__image-missing" role="img" title={title}>
        {alt === "" ? "Image not found" : `Image not found: ${alt}`}
      </span>
    );
  }

  return <img alt={alt} onError={() => setFailedSrc(src)} src={src} title={title} />;
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
    img: ({ src, alt, title }) => {
      const source = typeof src === "string" ? src.trim() : "";
      const resolved =
        resolveImageUrl && source !== "" && !PASS_THROUGH_SRC_PATTERN.test(source)
          ? resolveImageUrl(source)
          : source;

      return <MarkdownImage alt={alt ?? ""} key={resolved ?? ""} src={resolved} title={title} />;
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
