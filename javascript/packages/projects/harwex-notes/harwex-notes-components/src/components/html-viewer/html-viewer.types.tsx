import type { THtmlDocument } from "@hw/harwex-notes-protocol";

type THtmlViewerProps = {
  document: THtmlDocument;
  // The file name, shown in the toolbar and given to the frame as its title.
  name?: string;
};

export type { THtmlViewerProps };
