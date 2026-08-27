import type { TFsNode } from "@hw/harwex-notes-protocol";

declare class FsDataAccess {
  tree: TFsNode[];

  // Preload vault by passed `VAULT_PATH`
  preload: () => Promise<void>;
  flush: () => Promise<void>;
}

export type { FsDataAccess };
