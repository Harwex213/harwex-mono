import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

type TNativeLock = {
  lockFileAndWait: (lockPath: string) => Promise<number>;
  lockFileIfFree: (lockPath: string) => number | null;
  unlockFile: (fileDescriptor: number) => boolean;
};

const require = createRequire(import.meta.url);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const native = require(
  path.join(packageRoot, "build", "Release", "harwex_notes_lock.node"),
) as TNativeLock;

const lockPathFor = (targetPath: string): string => `${targetPath}.lock`;

const withPathLock = async <T>(lockPath: string, action: () => Promise<T>): Promise<T> => {
  const fileDescriptor = await native.lockFileAndWait(lockPath);

  try {
    return await action();
  } finally {
    native.unlockFile(fileDescriptor);
  }
};

const withFileLock = async <T>(targetPath: string, action: () => Promise<T>): Promise<T> => {
  return withPathLock(lockPathFor(targetPath), action);
};

const tryWithFileLock = async <T>(
  targetPath: string,
  action: () => Promise<T>,
): Promise<{ locked: true; value: T } | { locked: false }> => {
  const fileDescriptor = native.lockFileIfFree(lockPathFor(targetPath));

  if (fileDescriptor === null) {
    return { locked: false };
  }

  try {
    return { locked: true, value: await action() };
  } finally {
    native.unlockFile(fileDescriptor);
  }
};

export { lockPathFor, tryWithFileLock, withFileLock, withPathLock };
