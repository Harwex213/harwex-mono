import type { TImageDocument } from "@hw/harwex-notes-protocol";

type TImageViewerProps = {
  document: TImageDocument;
  // The file name, shown as the image's alternative text.
  name?: string;
};

export type { TImageViewerProps };
