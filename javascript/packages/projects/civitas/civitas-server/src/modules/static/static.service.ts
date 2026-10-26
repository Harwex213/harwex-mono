import { createWriteStream } from "node:fs";
import { mkdir, rm } from "node:fs/promises";
import * as path from "node:path";
import { pipeline } from "node:stream/promises";
import type { Readable } from "node:stream";

const STATIC_URL_PREFIX = "/static";

class StaticService {
    constructor(private readonly rootDir: string) {}

    saveFile = async (id: string, fileName: string, content: Readable): Promise<string> => {
        const dir = this.getDir(id);
        await mkdir(dir, { recursive: true });
        await pipeline(content, createWriteStream(path.join(dir, fileName)));
        return this.getUrl(id, fileName);
    };

    getUrl = (id: string, fileName: string): string => {
        return `${STATIC_URL_PREFIX}/${id}/${fileName}`;
    };

    remove = async (id: string): Promise<void> => {
        await rm(this.getDir(id), { recursive: true, force: true });
    };

    private getDir = (id: string): string => {
        return path.join(this.rootDir, path.basename(id));
    };
}

export { StaticService, STATIC_URL_PREFIX };
