import { readdir, readFile, writeFile, stat } from "fs/promises";
import { join } from "path";

export interface FileSystemAPI {
  readdir(path: string): Promise<string[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  isDirectory(path: string): Promise<boolean>;
  join(...paths: string[]): string;
}

export class NodeFileSystem implements FileSystemAPI {
  async readdir(path: string): Promise<string[]> {
    return readdir(path);
  }

  async readFile(path: string): Promise<string> {
    return readFile(path, "utf-8");
  }

  async writeFile(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf-8");
  }

  async isDirectory(path: string): Promise<boolean> {
    try {
      const stats = await stat(path);
      return stats.isDirectory();
    } catch {
      return false;
    }
  }

  join(...paths: string[]): string {
    return join(...paths);
  }
}

export const defaultFileSystem = new NodeFileSystem();
