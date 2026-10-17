type TVaultEntryKind = "file" | "folder" | "other";

type TVaultEntry = {
  name: string;
  kind: TVaultEntryKind;
};

type TVaultFs = {
  readDir: (path: string) => Promise<readonly TVaultEntry[]>;
  fileSize: (path: string) => Promise<number>;
  // A token that changes whenever the file content may have changed. Two reads that
  // return the same token saw the same file. Null when no file is at the path.
  fileVersion: (path: string) => Promise<string | null>;
  readFile: (path: string) => Promise<Uint8Array>;
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  makeDir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  remove: (path: string) => Promise<void>;
};

export type { TVaultEntry, TVaultEntryKind, TVaultFs };
