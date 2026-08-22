import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";

/** True when the path already holds a file. */
const fileExists = async (filePath: string): Promise<boolean> => {
  try {
    const stats = await stat(filePath);
    return stats.isFile();
  } catch {
    return false;
  }
};

/**
 * Write bytes to `filePath`, creating parent directories as needed.
 *
 * The bytes land in a temporary file that is then renamed into place, because a
 * crawl is resumed by checking whether a file exists. A process killed midway
 * through a plain write would leave a short file behind, and the next run would
 * accept it as complete. A rename cannot leave a partial file under the real name.
 */
const writeResource = async (filePath: string, body: Buffer): Promise<void> => {
  await mkdir(dirname(filePath), { recursive: true });

  const tempPath = `${filePath}.part`;
  try {
    await writeFile(tempPath, body);
    await rename(tempPath, filePath);
  } catch (cause) {
    await rm(tempPath, { force: true });
    throw cause;
  }
};

/** Read a previously saved page back as text. */
const readResourceText = (filePath: string): Promise<string> => readFile(filePath, "utf-8");

export { fileExists, writeResource, readResourceText };
