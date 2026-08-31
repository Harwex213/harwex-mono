import { withPathLock } from "@hw/harwex-notes-lock";
import type { TVaultLock } from "./vault-lock.types.js";

// The lock is taken on the vault directory itself, not on a note file. A note is
// replaced through rename, which swaps its inode, and an flock lives on the inode:
// two processes would end up "holding" the lock on two different inodes at once.
// A directory is never renamed under us, and locking it adds no file to the vault.
//
// Waiting happens on a libuv worker thread, so the event loop keeps serving requests
// while another process holds the vault.
const createNativeVaultLock = (vaultPath: string): TVaultLock => {
  return { runExclusive: (task) => withPathLock(vaultPath, task) };
};

export { createNativeVaultLock };
