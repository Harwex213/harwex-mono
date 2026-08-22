import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Graph, PromptImage } from "../shared/types.ts";

const EXTENSION_BY_MEDIA_TYPE: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
};

const MEDIA_TYPE_BY_EXTENSION: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
};

const EMPTY_GRAPH: Graph = {
  version: 1,
  topic: "",
  nodes: [],
  updatedAt: 0,
};

class Store {
  #root: string;

  constructor(root: string) {
    this.#root = root;
  }

  get agentCwd(): string {
    return path.join(this.#root, "agent-cwd");
  }

  async init(): Promise<void> {
    await mkdir(path.join(this.#root, "images"), { recursive: true });
    await mkdir(this.agentCwd, { recursive: true });
  }

  #graphPath(): string {
    return path.join(this.#root, "graph.json");
  }

  async readGraph(): Promise<Graph> {
    try {
      const raw = await readFile(this.#graphPath(), "utf8");
      const parsed = JSON.parse(raw) as Graph;
      if (parsed.version !== 1 || !Array.isArray(parsed.nodes)) {
        return EMPTY_GRAPH;
      }
      return parsed;
    } catch {
      return EMPTY_GRAPH;
    }
  }

  /** Written through a temp file so a crash mid-save cannot truncate the graph. */
  async writeGraph(graph: Graph): Promise<void> {
    const temp = `${this.#graphPath()}.${randomUUID()}.tmp`;
    await writeFile(temp, JSON.stringify(graph, null, 2), "utf8");
    await rename(temp, this.#graphPath());
  }

  /**
   * Content-addressed so pasting the same screenshot twice costs one file.
   */
  async saveImage(bytes: Buffer, mediaType: string, name: string): Promise<PromptImage> {
    const extension = EXTENSION_BY_MEDIA_TYPE[mediaType];
    if (!extension) {
      throw new Error(`Unsupported image type: ${mediaType}`);
    }
    const digest = createHash("sha256").update(bytes).digest("hex").slice(0, 24);
    const id = `${digest}.${extension}`;
    await writeFile(path.join(this.#root, "images", id), bytes);
    return { id, name, mediaType, bytes: bytes.byteLength };
  }

  async readImage(id: string): Promise<{ bytes: Buffer; mediaType: string } | null> {
    if (!/^[a-f0-9]{24}\.[a-z]{3,4}$/.test(id)) {
      return null;
    }
    const extension = id.split(".")[1];
    const mediaType = MEDIA_TYPE_BY_EXTENSION[extension];
    if (!mediaType) {
      return null;
    }
    try {
      const bytes = await readFile(path.join(this.#root, "images", id));
      return { bytes, mediaType };
    } catch {
      return null;
    }
  }

  async imageCount(): Promise<number> {
    try {
      const entries = await readdir(path.join(this.#root, "images"));
      return entries.length;
    } catch {
      return 0;
    }
  }
}

export { Store };
