import type {
  TMarkdownDocument,
  TMarkdownDocumentChangedAction,
} from "@hw/harwex-notes-protocol";
import type { MouseEvent } from "react";

type TMarkdownViewerRegistrySlice = {
  markdownDocumentChangedAction: TMarkdownDocumentChangedAction;
};

type TMarkdownViewerLayout = "split" | "source" | "rendered";

type TMarkdownViewerProps = {
  document: TMarkdownDocument;
  registry: TMarkdownViewerRegistrySlice;
  layout?: TMarkdownViewerLayout;
  theme?: "light" | "dark";
  readOnly?: boolean;
  // Maps a relative image path in the source to a URL the browser can load (MD-5). Absolute
  // URLs are passed through unchanged when this is not given.
  resolveImageUrl?: (src: string) => string;
  // Called for every link in the rendered document. The host decides what a vault link does
  // (MD-6, MD-7); http and https links fall back to a new browser tab (MD-8).
  onLinkClick?: (href: string, event: MouseEvent<HTMLAnchorElement>) => void;
};

export type {
  TMarkdownViewerLayout,
  TMarkdownViewerProps,
  TMarkdownViewerRegistrySlice,
};
