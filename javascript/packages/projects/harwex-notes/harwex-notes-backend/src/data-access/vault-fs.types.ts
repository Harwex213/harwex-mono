type TVaultEntryKind = "file" | "folder" | "other";

type TVaultEntry = {
  name: string;
  // "other" is anything that is neither a plain file nor a plain folder: symlinks, sockets,
  // devices. Such an entry is listed but never followed (VAULT-7).
  kind: TVaultEntryKind;
};

type TVaultFs = {
  readDir: (path: string) => Promise<readonly TVaultEntry[]>;
  fileSize: (path: string) => Promise<number>;
  readFile: (path: string) => Promise<Uint8Array>;
  // Replaces the whole file or leaves it as it was (DOC-12).
  writeFile: (path: string, data: Uint8Array) => Promise<void>;
  makeDir: (path: string) => Promise<void>;
  rename: (from: string, to: string) => Promise<void>;
  // Removes a file, or a folder with everything inside it.
  remove: (path: string) => Promise<void>;
};

export type { TVaultEntry, TVaultEntryKind, TVaultFs };
