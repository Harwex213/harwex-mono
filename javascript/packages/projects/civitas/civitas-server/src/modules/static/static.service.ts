import { randomUUID } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, rename, rm, stat } from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

const STATIC_URL_PREFIX = "/static";

class StaticService {
    constructor(private readonly rootDir: string) {}

    // Writes to a temporary file first and renames it into place, so a reader
    // never sees a half-written file and a failed upload keeps the old one.
    saveFile = async (id: string, fileName: string, content: Readable): Promise<string> => {
        const dir = this.getDir(id);
        const target = path.join(dir, path.basename(fileName));
        const temporary = `${target}.${randomUUID()}.tmp`;
        await mkdir(dir, { recursive: true });
        try {
            await pipeline(content, createWriteStream(temporary));
            await rename(temporary, target);
        } catch (error) {
            await rm(temporary, { force: true });
            throw error;
        }
        return this.getUrl(id, fileName);
    };

    getUrl = (id: string, fileName: string): string => {
        return `${STATIC_URL_PREFIX}/${id}/${fileName}`;
    };

    // The url of a stored file with its modification time as a version, so a
    // replaced file gets a new url; null when the file does not exist.
    getVersionedUrl = async (id: string, fileName: string): Promise<string | null> => {
        try {
            const info = await stat(path.join(this.getDir(id), path.basename(fileName)));
            return `${this.getUrl(id, fileName)}?v=${Math.floor(info.mtimeMs)}`;
        } catch {
            return null;
        }
    };

    remove = async (id: string): Promise<void> => {
        await rm(this.getDir(id), { recursive: true, force: true });
    };

    private getDir = (id: string): string => {
        return path.join(this.rootDir, path.basename(id));
    };
}

export { StaticService, STATIC_URL_PREFIX };
