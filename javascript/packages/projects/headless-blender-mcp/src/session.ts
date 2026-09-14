import { existsSync } from "node:fs";
import path from "node:path";
import type { Png } from "./blender/png.js";
import type { BlenderResponse } from "./blender/client.js";
import { ensureBlendFile, execute, get, start, stop } from "./blender/process.js";
import { exportModel, readOutline, renderThumbnail, save } from "./blender/scene.js";
import type { BlenderStatus, SceneOutline } from "./blender/types.js";
import { ENV_BLENDER } from "./meta.js";
import { buildTools, NO_FILE } from "./tools.js";
import type { ToolContext, ToolDefinition } from "./tools.js";

/**
 * One headless Blender, the `.blend` it currently holds, and the tools bound
 * to it. This is what a host — the stdio server of this package, or an app
 * embedding it — holds on to for the length of a session.
 *
 * A session does not need a file to exist. It starts empty, and `open` gives
 * it one: that is what lets a single registered MCP server serve any project
 * instead of one `.blend`. Opening a second file closes the first, so one
 * session never leaves more than one Blender behind.
 *
 * The session tracks unsaved changes itself. `bpy.data.is_dirty` cannot
 * answer that question: a `--background` Blender never maintains it.
 */

const MACOS_BLENDER = "/Applications/Blender.app/Contents/MacOS/Blender";

/** The Blender executable to use when the caller names none. */
function defaultBlenderPath(): string {
  const fromEnv = process.env[ENV_BLENDER];
  if (fromEnv && fromEnv.length > 0) {
    return fromEnv;
  }
  if (process.platform === "darwin" && existsSync(MACOS_BLENDER)) {
    return MACOS_BLENDER;
  }
  return "blender";
}

interface SessionOptions {
  /** The `.blend` to open on `start`. Left out, the session starts with no file. */
  blendPath?: string;
  /** The Blender executable. Defaults to `HEADLESS_BLENDER_BIN`, then the platform's usual place. */
  blenderPath?: string;
  /** Write a starter `.blend` when the file is missing. Default true. */
  create?: boolean;
  /** Called with every render a tool produces. */
  onRender?(png: Png, filePath: string): void;
  /** Called whenever the scene may have changed, and again once it is saved. */
  onChange?(dirty: boolean): void;
  /** Called when the session opens a file, and with null when it closes one. */
  onOpen?(blendPath: string | null): void;
}

interface BlenderSession {
  readonly blenderPath: string;
  /** The `.blend` this session holds open, or null while it holds none. */
  blendPath(): string | null;
  /**
   * Opens a `.blend`: stops the Blender of the previous one, starts a new one,
   * and waits until it answers. Resolves to the absolute path it opened.
   */
  open(blendPath: string, options?: { create?: boolean }): Promise<string>;
  /** Opens the file named in the options, when there is one. */
  start(): Promise<void>;
  /** Stops Blender and releases the file. A session with no file is left alone. */
  stop(): Promise<void>;
  status(): BlenderStatus;
  /** True while the open scene holds edits that are not on disk. */
  dirty(): boolean;
  execute(code: string, strictJson: boolean): Promise<BlenderResponse>;
  save(): Promise<void>;
  outline(): Promise<SceneOutline>;
  /** Exports the scene as a binary glTF. Resolves to the file, or null when it did not land. */
  exportModel(): Promise<string | null>;
  renderThumbnail(name: string): Promise<Uint8Array>;
  /** The tools bound to this session, ready to register on an MCP server. */
  tools(): ToolDefinition[];
}

function createSession(options: SessionOptions): BlenderSession {
  const blenderPath = options.blenderPath && options.blenderPath.length > 0 ? options.blenderPath : defaultBlenderPath();
  let openPath: string | null = null;
  let dirty = false;

  const setDirty = (next: boolean): void => {
    dirty = next;
    options.onChange?.(next);
  };

  /** The open file, or an error naming the tool that opens one. */
  const live = (): string => {
    if (!openPath) {
      throw new Error(NO_FILE);
    }
    return openPath;
  };

  const openBlend = async (target: string, create: boolean): Promise<string> => {
    const next = path.resolve(target);
    if (openPath === next && get(next)?.status === "ready") {
      return next;
    }
    if (openPath) {
      await stop(openPath);
      openPath = null;
      options.onOpen?.(null);
    }
    if (create) {
      await ensureBlendFile(blenderPath, next);
    } else if (!existsSync(next)) {
      throw new Error(`${next} does not exist, and creating it was turned off.`);
    }
    const instance = await start(blenderPath, next);
    const ready = await instance.ready;
    if (!ready) {
      await stop(next);
      throw new Error(instance.message || `Blender did not start for ${next}.`);
    }
    openPath = next;
    setDirty(false);
    options.onOpen?.(next);
    return next;
  };

  const context: ToolContext = {
    blenderPath,
    blendPath: () => openPath,
    openBlend,
    hasUnsavedChanges: () => dirty,
    sceneChanged: () => setDirty(true),
    sceneSaved: () => setDirty(false),
    ...(options.onRender ? { onRender: options.onRender } : {}),
  };

  return {
    blenderPath,
    blendPath(): string | null {
      return openPath;
    },
    open(blendPath: string, open?: { create?: boolean }): Promise<string> {
      return openBlend(blendPath, open?.create !== false);
    },
    async start(): Promise<void> {
      if (options.blendPath && options.blendPath.length > 0) {
        await openBlend(options.blendPath, options.create !== false);
      }
    },
    async stop(): Promise<void> {
      if (!openPath) {
        return;
      }
      const closing = openPath;
      openPath = null;
      await stop(closing);
      options.onOpen?.(null);
    },
    status(): BlenderStatus {
      return openPath ? get(openPath)?.status ?? "stopped" : "stopped";
    },
    dirty(): boolean {
      return dirty;
    },
    async execute(code: string, strictJson: boolean): Promise<BlenderResponse> {
      const response = await execute(live(), code, strictJson);
      setDirty(true);
      return response;
    },
    async save(): Promise<void> {
      await save(live());
      setDirty(false);
    },
    outline(): Promise<SceneOutline> {
      return readOutline(live());
    },
    exportModel(): Promise<string | null> {
      return exportModel(live());
    },
    renderThumbnail(name: string): Promise<Uint8Array> {
      return renderThumbnail(live(), name);
    },
    tools(): ToolDefinition[] {
      return buildTools(context);
    },
  };
}

export type { BlenderSession, SessionOptions };
export { createSession, defaultBlenderPath };
