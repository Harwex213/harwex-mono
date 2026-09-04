import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import * as path from "node:path";
import type { Graph } from "../shared/types.js";
import { writeSkills } from "./agent/skills.js";

const GRAPH_FILE = "graph.json";
const PROMPTS_DIR = "prompts";
const IMAGES_DIR = "images";

const EMPTY_GRAPH: Graph = { version: 1, nodes: [], edges: [] };

/**
 * Node ids reach the disk as file names, so they are checked rather than
 * trusted: a graph file is user-editable, and `../` in an id would walk out of
 * the working directory.
 */
function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,64}$/.test(id)) {
    throw new Error(`Refusing to touch a file for the id "${id}".`);
  }
  return id;
}

function promptPath(dir: string, id: string): string {
  return path.join(dir, PROMPTS_DIR, `${safeId(id)}.md`);
}

function imagePath(dir: string, id: string): string {
  return path.join(dir, IMAGES_DIR, `${safeId(id)}.png`);
}

/** Creates what a working directory needs and refreshes the skills the agents read. */
async function ensureWorkspace(dir: string): Promise<void> {
  await mkdir(path.join(dir, PROMPTS_DIR), { recursive: true });
  await mkdir(path.join(dir, IMAGES_DIR), { recursive: true });
  await writeSkills(dir);
}

async function loadGraph(dir: string): Promise<Graph> {
  try {
    const raw = await readFile(path.join(dir, GRAPH_FILE), "utf8");
    const parsed = JSON.parse(raw) as Partial<Graph>;
    return {
      version: 1,
      nodes: Array.isArray(parsed.nodes) ? parsed.nodes : [],
      edges: Array.isArray(parsed.edges) ? parsed.edges : [],
    };
  } catch {
    return { ...EMPTY_GRAPH };
  }
}

async function saveGraph(dir: string, graph: Graph): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, GRAPH_FILE), `${JSON.stringify(graph, null, 2)}\n`, "utf8");
}

async function readPrompt(dir: string, id: string): Promise<string> {
  try {
    return await readFile(promptPath(dir, id), "utf8");
  } catch {
    return "";
  }
}

async function writePrompt(dir: string, id: string, text: string): Promise<void> {
  await mkdir(path.join(dir, PROMPTS_DIR), { recursive: true });
  await writeFile(promptPath(dir, id), text, "utf8");
}

async function writeImage(dir: string, id: string, bytes: Uint8Array): Promise<void> {
  await mkdir(path.join(dir, IMAGES_DIR), { recursive: true });
  await writeFile(imagePath(dir, id), bytes);
}

/** Deletes the file a node owns. A node whose file never landed is not an error. */
async function removeNodeFile(
  dir: string,
  kind: "prompt" | "image",
  id: string,
): Promise<void> {
  const file = kind === "prompt" ? promptPath(dir, id) : imagePath(dir, id);
  await rm(file, { force: true });
}

async function fileExists(file: string): Promise<boolean> {
  try {
    await readFile(file);
    return true;
  } catch {
    return false;
  }
}

export {
  ensureWorkspace,
  fileExists,
  imagePath,
  IMAGES_DIR,
  loadGraph,
  promptPath,
  PROMPTS_DIR,
  readPrompt,
  removeNodeFile,
  safeId,
  saveGraph,
  writeImage,
  writePrompt,
};
