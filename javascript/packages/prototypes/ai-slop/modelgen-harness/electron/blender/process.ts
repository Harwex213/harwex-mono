import { spawn } from "node:child_process";
import type { ChildProcess } from "node:child_process";
import { mkdir } from "node:fs/promises";
import path from "node:path";
import type { BlenderStatus } from "../../shared/types.js";
import type { BlenderResponse } from "./client.js";
import { freePort, sendCode, waitForPort } from "./client.js";

/**
 * One headless Blender per tab. Each is started as
 * `blender --online-mode --background <file.blend> --command blender_mcp --port N`,
 * which is the blender_mcp add-on's own background server, so the tools the
 * agent calls are executed exactly the way the Blender MCP server would
 * execute them. Tabs run side by side because every tab has its own process
 * and its own port.
 *
 * The add-on serves one request at a time on Blender's main thread, so calls
 * to one instance are queued here rather than sent in parallel.
 */

interface BlenderInstance {
  blendPath: string;
  port: number;
  status: BlenderStatus;
  message: string;
  child: ChildProcess | null;
  /** Resolves once the port answers, or the process gives up. */
  ready: Promise<boolean>;
  queue: Promise<unknown>;
  log: string[];
}

type StatusListener = (blendPath: string, status: BlenderStatus, message: string) => void;

const START_TIMEOUT_MS = 90_000;
const LOG_LINES = 40;

/**
 * Runs inside Blender before the server starts. When the app dies without a
 * chance to stop its Blenders, the parent pid changes and Blender leaves too,
 * instead of lingering as an orphan that holds the file.
 */
const WATCHDOG = [
  "import os, threading, time",
  "_parent = os.getppid()",
  "def _watch():",
  "    while True:",
  "        time.sleep(2.0)",
  "        if os.getppid() != _parent:",
  "            os._exit(0)",
  "threading.Thread(target=_watch, daemon=True).start()",
].join("\n");

const instances = new Map<string, BlenderInstance>();
let listener: StatusListener = () => {};

function onStatus(next: StatusListener): void {
  listener = next;
}

function setStatus(instance: BlenderInstance, status: BlenderStatus, message: string): void {
  instance.status = status;
  instance.message = message;
  listener(instance.blendPath, status, message);
}

function lastLogLine(instance: BlenderInstance): string {
  for (let index = instance.log.length - 1; index >= 0; index -= 1) {
    const line = instance.log[index]?.trim() ?? "";
    if (line.length > 0) {
      return line;
    }
  }
  return "";
}

/**
 * Creates the `.blend` when it is missing: the startup scene without its cube,
 * so a camera and a light are already there for previews. Runs a one-shot
 * Blender and waits for it.
 */
async function ensureBlendFile(blenderPath: string, blendPath: string): Promise<void> {
  await mkdir(path.dirname(blendPath), { recursive: true });
  const script = [
    "import bpy, os",
    `path = ${JSON.stringify(blendPath)}`,
    "if not os.path.exists(path):",
    "    cube = bpy.data.objects.get('Cube')",
    "    if cube is not None:",
    "        bpy.data.objects.remove(cube, do_unlink=True)",
    "    bpy.ops.wm.save_as_mainfile(filepath=path)",
  ].join("\n");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(blenderPath, ["--background", "--python-expr", script], {
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.stderr?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });
    child.on("error", (error) => {
      reject(new Error(`Could not start Blender at ${blenderPath}: ${error.message}`));
    });
    child.on("exit", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`Blender could not create ${blendPath} (exit ${code}).\n${output.slice(-800)}`));
      }
    });
  });
}

/** Starts the headless Blender for a file. A tab that already has one keeps it. */
async function start(blenderPath: string, blendPath: string): Promise<BlenderInstance> {
  const existing = instances.get(blendPath);
  if (existing && existing.status !== "stopped" && existing.status !== "failed") {
    return existing;
  }
  const port = await freePort();
  const instance: BlenderInstance = {
    blendPath,
    port,
    status: "starting",
    message: "",
    child: null,
    ready: Promise.resolve(false),
    queue: Promise.resolve(),
    log: [],
  };
  instances.set(blendPath, instance);
  setStatus(instance, "starting", `Starting Blender on port ${port}…`);

  const child = spawn(
    blenderPath,
    [
      "--online-mode",
      "--background",
      blendPath,
      "--python-expr",
      WATCHDOG,
      "--command",
      "blender_mcp",
      "--host",
      "127.0.0.1",
      "--port",
      String(port),
    ],
    { stdio: ["ignore", "pipe", "pipe"] },
  );
  instance.child = child;
  const collect = (chunk: Buffer) => {
    for (const line of chunk.toString("utf8").split("\n")) {
      if (line.trim().length > 0) {
        instance.log.push(line);
      }
    }
    if (instance.log.length > LOG_LINES) {
      instance.log.splice(0, instance.log.length - LOG_LINES);
    }
  };
  child.stdout?.on("data", collect);
  child.stderr?.on("data", collect);
  child.on("error", (error) => {
    setStatus(instance, "failed", `Could not start Blender at ${blenderPath}: ${error.message}`);
  });
  child.on("exit", (code, signal) => {
    if (instances.get(blendPath) !== instance) {
      return;
    }
    instance.child = null;
    if (instance.status === "starting") {
      setStatus(instance, "failed", `Blender exited before it was ready (${code ?? signal}). ${lastLogLine(instance)}`);
      return;
    }
    if (instance.status !== "failed") {
      setStatus(instance, "stopped", `Blender exited (${code ?? signal}).`);
    }
  });

  instance.ready = waitForPort(port, START_TIMEOUT_MS, () => instance.child !== null).then((up) => {
    if (up) {
      setStatus(instance, "ready", `Blender ready on port ${port}.`);
      return true;
    }
    if (instance.status === "starting") {
      setStatus(instance, "failed", `Blender did not open port ${port} in time. ${lastLogLine(instance)}`);
      child.kill("SIGKILL");
    }
    return false;
  });
  return instance;
}

function get(blendPath: string): BlenderInstance | null {
  return instances.get(blendPath) ?? null;
}

async function stop(blendPath: string): Promise<void> {
  const instance = instances.get(blendPath);
  if (!instance) {
    return;
  }
  instances.delete(blendPath);
  const child = instance.child;
  if (!child) {
    return;
  }
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
    }, 3000);
    child.on("exit", () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill("SIGINT");
  });
}

async function stopAll(): Promise<void> {
  await Promise.all([...instances.keys()].map((blendPath) => stop(blendPath)));
}

/**
 * Runs Python inside the tab's Blender. Calls on one instance are serialised.
 * Rejects when Blender is not running rather than waiting for it.
 */
function execute(blendPath: string, code: string, strictJson: boolean): Promise<BlenderResponse> {
  const instance = instances.get(blendPath);
  if (!instance) {
    return Promise.reject(new Error("Blender is not running for this file. Restart it from the workspace header."));
  }
  const task = instance.queue.then(async () => {
    const ready = await instance.ready;
    if (!ready || instance.status !== "ready") {
      throw new Error(`Blender is ${instance.status}: ${instance.message}`);
    }
    return await sendCode(instance.port, code, strictJson);
  });
  instance.queue = task.catch(() => {});
  return task;
}

export type { BlenderInstance };
export { ensureBlendFile, execute, get, onStatus, start, stop, stopAll };
