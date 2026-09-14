import { copyFile, mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { z } from "zod";
import { runBlenderCli, withSyncedBlend } from "./blender/cli.js";
import type { BlenderResponse } from "./blender/client.js";
import { runDocTool } from "./blender/docs.js";
import type { Png } from "./blender/png.js";
import { readPng } from "./blender/png.js";
import { execute } from "./blender/process.js";
import { save } from "./blender/scene.js";
import { buildToolCall } from "./blender/toolcode.js";
import type { ParamValue } from "./blender/toolcode.js";

/**
 * The tools this package serves. They carry the names of the Blender MCP
 * server's tools and do what those do — the bundled tool-code runs in the
 * headless Blender, the docs tools run the server's own search — and every
 * tool answers with text the model can read. The render tools also hand the
 * picture back.
 *
 * `save_blend_file` is the one tool that is not upstream's. Nothing else can
 * write the file when there is no window, and a run whose work never reaches
 * disk is lost when the process exits.
 */

interface ToolContext {
  /** The `.blend` the live Blender has open, or null while none is open. */
  blendPath(): string | null;
  /** Opens a `.blend`, closing the one the session held. Resolves to the absolute path. */
  openBlend(blendPath: string, create: boolean): Promise<string>;
  /** The Blender executable, for the `*_for_cli` tools that open a second one. */
  blenderPath: string;
  /** Whether the live Blender holds edits that are not on disk. */
  hasUnsavedChanges(): boolean;
  /** Called after anything that may have changed the scene. */
  sceneChanged(): void;
  /** Called after the file was written. */
  sceneSaved(): void;
  /** Called with every render, so a host can show it. */
  onRender?(png: Png, filePath: string): void;
}

/** What a tool hands back: text for the model, and sometimes a PNG too. */
interface ToolResult {
  text: string;
  image?: Uint8Array;
  isError?: boolean;
}

interface ToolDefinition {
  name: string;
  description: string;
  schema: z.ZodRawShape;
  execute(args: Record<string, unknown>): Promise<ToolResult>;
}

/** What every tool that needs the live Blender says when no file is open. */
const NO_FILE = "No .blend is open. Call open_blend_file with a path first.";

const TEXT_LIMIT = 24_000;
const STREAM_LIMIT = 4_000;

/** Long output is trimmed from the middle so both the start and the end survive. */
function clip(text: string, limit: number): string {
  if (text.length <= limit) {
    return text;
  }
  const half = Math.floor(limit / 2);
  return `${text.slice(0, half)}\n… [${text.length - limit} characters cut] …\n${text.slice(-half)}`;
}

function describe(response: BlenderResponse): ToolResult {
  const shaped: Record<string, unknown> = { status: response.status };
  if (response.result !== undefined) {
    shaped.result = response.result;
  }
  if (response.message) {
    shaped.message = clip(response.message, STREAM_LIMIT);
  }
  if (response.stdout) {
    shaped.stdout = clip(response.stdout, STREAM_LIMIT);
  }
  if (response.stderr) {
    shaped.stderr = clip(response.stderr, STREAM_LIMIT);
  }
  return { text: clip(JSON.stringify(shaped, null, 1), TEXT_LIMIT), isError: response.status !== "ok" };
}

function failure(error: unknown): ToolResult {
  const message = error instanceof Error ? error.message : String(error);
  return { text: JSON.stringify({ status: "error", message: clip(message, STREAM_LIMIT) }), isError: true };
}

/**
 * The open file, for the tools that need one. A server registered without a
 * `--blend` starts with none, so the message names the way out.
 */
function live(ctx: ToolContext): string {
  const blendPath = ctx.blendPath();
  if (!blendPath) {
    throw new Error(NO_FILE);
  }
  return blendPath;
}

function json(value: unknown): ToolResult {
  return { text: clip(JSON.stringify(value, null, 1), TEXT_LIMIT) };
}

function text(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/** Runs one bundled tool-code file in the live Blender. */
async function bundled(
  ctx: ToolContext,
  toolName: string,
  params: Record<string, ParamValue> | null,
): Promise<ToolResult> {
  try {
    const blendPath = live(ctx);
    const code = await buildToolCall(toolName, params);
    return describe(await execute(blendPath, code, true));
  } catch (error) {
    return failure(error);
  }
}

/** Runs one bundled tool-code file in a fresh background Blender on some file. */
async function bundledForCli(ctx: ToolContext, toolName: string, blendFile: string): Promise<ToolResult> {
  try {
    const code = await buildToolCall(toolName, null);
    const result = await withSyncedBlend(ctx.blendPath(), blendFile, ctx.hasUnsavedChanges(), (file) => {
      return runBlenderCli(ctx.blenderPath, file, code);
    });
    return json(result);
  } catch (error) {
    return failure(error);
  }
}

/**
 * The render tools write under Blender's temp dir and report where. The
 * picture is copied to the path the agent asked for when that path can take
 * it, handed to the host, and returned so the agent sees its own render.
 */
async function render(ctx: ToolContext, toolName: string, outputPath: string): Promise<ToolResult> {
  const answer = await bundled(ctx, toolName, { output_path: outputPath });
  let parsed: { status?: string; result?: { status?: string; filepath?: string } } = {};
  try {
    parsed = JSON.parse(answer.text) as typeof parsed;
  } catch {
    return answer;
  }
  const filepath = parsed.result?.filepath;
  if (parsed.status !== "ok" || parsed.result?.status !== "ok" || typeof filepath !== "string") {
    return { ...answer, isError: true };
  }
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(filepath));
  } catch (error) {
    return failure(`The render reported ${filepath} but it cannot be read: ${(error as Error).message}`);
  }
  let png: Png;
  try {
    png = readPng(bytes);
  } catch (error) {
    return failure(error);
  }
  let stored = filepath;
  if (path.isAbsolute(outputPath) && path.resolve(outputPath) !== path.resolve(filepath)) {
    try {
      await mkdir(path.dirname(outputPath), { recursive: true });
      await copyFile(filepath, outputPath);
      stored = outputPath;
    } catch {
      // The requested directory is not writable; the temp copy still stands.
    }
  }
  ctx.onRender?.(png, stored);
  return {
    text: JSON.stringify({ status: "ok", filepath: stored, width: png.width, height: png.height }),
    image: png.bytes,
  };
}

const SUMMARY_TOOLS = [
  ["get_blendfile_summary_datablocks", "Return a summary of the blend file: data-block counts, active workspace, and render engine."],
  ["get_blendfile_summary_path_info", "Simple, fast access to the blend file's path, save status, age, and backups."],
  ["get_blendfile_summary_missing_files", "Report external file references that are missing from disk (images, libraries, fonts, sounds, movie clips, caches, sequences)."],
  ["get_blendfile_summary_of_linked_libraries", "Return a tree of directly and indirectly linked library files."],
  ["get_blendfile_summary_usage_guess", "Guess the primary use-cases of the current blend file (scored 0-100 with certainty)."],
] as const;

const SEARCH_SCHEMA: z.ZodRawShape = {
  query: z.string().describe("Whitespace-separated tokens; every token must appear. Stop-words are dropped."),
  max_results: z.number().int().optional().describe("How many hits to return. Default 20."),
  context: z.number().int().optional().describe("Paragraphs of context on either side of each hit. Default 0."),
  index: z.number().int().optional().describe("Position of a previous hit (same query) to widen to its section."),
};

function buildTools(ctx: ToolContext): ToolDefinition[] {
  const docs = async (name: string, args: Record<string, unknown>): Promise<ToolResult> => {
    try {
      return json(await runDocTool(name, args));
    } catch (error) {
      return failure(error);
    }
  };
  const search = (name: string) => {
    return (args: Record<string, unknown>) => {
      return docs(name, {
        query: text(args.query),
        max_results: typeof args.max_results === "number" ? args.max_results : 20,
        context: typeof args.context === "number" ? args.context : 0,
        index: typeof args.index === "number" ? args.index : null,
      });
    };
  };

  const tools: ToolDefinition[] = [
    {
      name: "open_blend_file",
      description:
        "Open a .blend in the background Blender this server runs, and make it the file every other tool works on. " +
        "The server starts with no file open, so call this first. Opening a second file closes the first, and unsaved " +
        "changes in it are lost: call save_blend_file before switching. A missing file is created from a starter scene " +
        "(a camera and a light, no cube) unless create is false. Takes up to a minute while Blender starts.",
      schema: {
        path: z.string().describe("Absolute path of the .blend to open."),
        create: z.boolean().optional().describe("Create the file when it is missing. Default true."),
      },
      execute: async (args) => {
        try {
          const opened = await ctx.openBlend(text(args.path), args.create !== false);
          return json({ status: "ok", filepath: opened });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "execute_blender_code",
      description:
        "Execute Python code in the background Blender this server holds open. The code runs with full access to bpy. " +
        "Assign a JSON-serialisable dict to a variable named `result` to return data. " +
        "print() output comes back as stdout. Deferred completion via check_is_finished is not available in background mode.",
      schema: { code: z.string().describe("Python source to exec() inside Blender.") },
      execute: async (args) => {
        try {
          const response = await execute(live(ctx), text(args.code), false);
          ctx.sceneChanged();
          return describe(response);
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "save_blend_file",
      description:
        "Write the open .blend to disk. There is no window here, so nothing saves the file on its own: call this " +
        "once the scene is in the state you want to keep.",
      schema: {},
      execute: async () => {
        try {
          const blendPath = live(ctx);
          await save(blendPath);
          ctx.sceneSaved();
          return json({ status: "ok", filepath: blendPath });
        } catch (error) {
          return failure(error);
        }
      },
    },
    {
      name: "get_objects_summary",
      description:
        "Return the scene's collection hierarchy and their objects: for each collection its objects " +
        "(name, type, parent, data name, selection, visibility) and nested child collections.",
      schema: {},
      execute: () => bundled(ctx, "get_objects_summary", null),
    },
    {
      name: "get_object_detail_summary",
      description:
        "Return a structured summary of the object identified by name: type, transforms, parent, children, " +
        "modifiers, constraints, materials, visibility, data-block name, and collections.",
      schema: { name: z.string().describe("The object's name, exactly as in bpy.data.objects.") },
      execute: (args) => bundled(ctx, "get_object_detail_summary", { name: text(args.name) }),
    },
    ...SUMMARY_TOOLS.map(([name, description]): ToolDefinition => {
      return { name, description, schema: {}, execute: () => bundled(ctx, name, null) };
    }),
    {
      name: "render_thumbnail_to_path",
      description:
        "Render a small, low-quality thumbnail (320 px on the long side, few samples) of the scene from its camera. " +
        "The file is written under Blender's temp dir using the basename of output_path, copied to output_path when possible, " +
        "and returned to you as an image. Frame the camera first.",
      schema: { output_path: z.string().describe("Path for the PNG; its basename names the file.") },
      execute: (args) => render(ctx, "render_thumbnail_to_path", text(args.output_path)),
    },
    {
      name: "render_viewport_to_path",
      description:
        "Render the active 3D viewport (OpenGL, as the viewport looks) to output_path. Needs a window, so against this " +
        "server's background Blender it reports that it is not available; use render_thumbnail_to_path instead.",
      schema: { output_path: z.string() },
      execute: (args) => render(ctx, "render_viewport_to_path", text(args.output_path)),
    },
    {
      name: "get_python_api_docs",
      description:
        "Return the Blender Python API docs for a fully-qualified identifier such as bpy.types.Scene.frame_current or bpy.ops.mesh.primitive_cube_add. " +
        "`*` lists top-level modules and `X.*` lists the children of X. The response carries kind (exact, namespace, definition, partial, suggestions, missing), found, and content or lists.",
      schema: { identifier: z.string() },
      execute: (args) => docs("get_python_api_docs", { identifier: text(args.identifier) }),
    },
    {
      name: "search_api_docs",
      description:
        "Full-text search over the bundled Blender Python API reference. Returns ranked hits with path, text, breadcrumb, index and score. " +
        "Use it to check operator signatures, property names and enum values before writing bpy code.",
      schema: SEARCH_SCHEMA,
      execute: search("search_api_docs"),
    },
    {
      name: "search_manual_docs",
      description:
        "Full-text search over the bundled Blender user manual. Same result shape as search_api_docs. Use it for workflow and concept questions.",
      schema: SEARCH_SCHEMA,
      execute: search("search_manual_docs"),
    },
    {
      name: "execute_blender_code_for_cli",
      description:
        "Execute Python code in a fresh background Blender process that opens blend_file, runs the code, and exits. " +
        "Assign a dict to `result` to return data. It reads the file on disk, so it does not see unsaved changes — " +
        "except in the file this server holds open, where a copy is saved first. Takes seconds per call; prefer " +
        "execute_blender_code for the open file.",
      schema: {
        blend_file: z.string().describe("Absolute path of the .blend to open."),
        code: z.string().describe("Python source to exec() inside that Blender."),
      },
      execute: async (args) => {
        try {
          const result = await withSyncedBlend(
            ctx.blendPath(),
            text(args.blend_file),
            ctx.hasUnsavedChanges(),
            (file) => {
              return runBlenderCli(ctx.blenderPath, file, text(args.code));
            },
          );
          return json(result);
        } catch (error) {
          return failure(error);
        }
      },
    },
    ...SUMMARY_TOOLS.map(([name, description]): ToolDefinition => {
      return {
        name: `${name}_for_cli`,
        description: `${description} Opens blend_file in a fresh background Blender for this one call, so it reads the file on disk. Takes seconds; prefer the live variant for the file this server holds open.`,
        schema: { blend_file: z.string().describe("Absolute path of the .blend to open.") },
        execute: (args) => bundledForCli(ctx, name, text(args.blend_file)),
      };
    }),
  ];
  return tools;
}

export type { ToolContext, ToolDefinition, ToolResult };
export { buildTools, NO_FILE };
