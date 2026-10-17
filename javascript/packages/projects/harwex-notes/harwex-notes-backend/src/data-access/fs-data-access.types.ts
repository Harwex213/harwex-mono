import type { TFsNode } from "@hw/harwex-notes-protocol";
import type { TDiskSync } from "./fs-data-access.js";

// The vault held in memory as a flat list of nodes, with the disk behind it.
//
// Services edit `tree` directly and call `flush` to push the difference to disk. Ids are
// stable for the life of the process: a rename or a move keeps the id, so open tabs can
// follow the node (MUT-14, MUT-24). A change made outside the app keeps the id of every
// entry whose path did not change (SYNC-2).
declare class FsDataAccess {
  tree: TFsNode[];

  // Preload vault by passed `VAULT_PATH`
  preload: () => Promise<void>;
  // Apply every change made to `tree` since the last flush to the disk. When the disk
  // refuses, `tree` is restored to the last flushed state and the error is rethrown.
  flush: () => Promise<void>;

  // Re-reads the disk after outside changes (SYNC-1). See fs-data-access.ts.
  syncWithDisk: (relativePaths: ReadonlySet<string> | null) => Promise<TDiskSync>;

  readFileSize: (nodeId: string) => Promise<number>;
  readFileVersion: (nodeId: string) => Promise<string | null>;
  readFile: (nodeId: string) => Promise<Uint8Array>;
  // Answers the version of the file after the write.
  writeFile: (nodeId: string, data: Uint8Array) => Promise<string>;

  // Runs one mutation at a time. Two clients editing the vault never interleave their
  // tree edits and flushes.
  runExclusive: <T>(task: () => Promise<T>) => Promise<T>;
}

export type { FsDataAccess };
