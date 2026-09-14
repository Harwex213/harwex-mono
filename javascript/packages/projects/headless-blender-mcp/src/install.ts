import { access, chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { constants } from "node:fs";
import os from "node:os";
import path from "node:path";
import { CLI_ENTRY } from "./blender/paths.js";
import { CLI_NAME } from "./meta.js";

/**
 * Puts the command on PATH. What lands there is a two-line shell script that
 * runs the built CLI with the very Node this package was installed with —
 * not a symlink through `#!/usr/bin/env node`. An MCP host started from the
 * Dock has a short PATH, and a Node installed by nvm is not on it.
 */

interface InstallOptions {
  /** Where to put the launcher. Default: the first writable directory on PATH. */
  directory?: string;
  /** Overwrite a launcher this package did not write. Default false. */
  force?: boolean;
}

interface InstalledCli {
  /** The launcher itself. */
  path: string;
  directory: string;
  /** Whether that directory is on the PATH of this shell. */
  onPath: boolean;
}

const MARKER = `# ${CLI_NAME} launcher`;

/** The directories to try, best first, when the caller names none. */
function candidates(): string[] {
  const home = os.homedir();
  const fromPath = (process.env.PATH ?? "").split(path.delimiter).filter((entry) => entry.length > 0);
  const preferred = [path.join(home, ".local", "bin"), path.join(home, "bin"), "/usr/local/bin"];
  const rest = fromPath.filter((entry) => entry.startsWith(home) && !preferred.includes(entry));
  return [...preferred, ...rest];
}

async function isWritable(directory: string): Promise<boolean> {
  try {
    await access(directory, constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

/** The first candidate that exists and takes a file, creating `~/.local/bin` if it must. */
async function pickDirectory(): Promise<string> {
  for (const directory of candidates()) {
    if (await isWritable(directory)) {
      return directory;
    }
  }
  const fallback = path.join(os.homedir(), ".local", "bin");
  await mkdir(fallback, { recursive: true });
  return fallback;
}

function launcherScript(): string {
  return ["#!/bin/sh", MARKER, `exec ${JSON.stringify(process.execPath)} ${JSON.stringify(CLI_ENTRY)} "$@"`, ""].join("\n");
}

/** Whether a file already there is one of ours, and so safe to replace. */
async function isOurs(target: string): Promise<boolean> {
  try {
    return (await readFile(target, "utf8")).includes(MARKER);
  } catch {
    return false;
  }
}

async function exists(target: string): Promise<boolean> {
  try {
    await access(target, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function installCli(options: InstallOptions = {}): Promise<InstalledCli> {
  if (!(await exists(CLI_ENTRY))) {
    throw new Error(`${CLI_ENTRY} is missing. Build the package first: \`yarn workspace @hw/headless-blender-mcp build\`.`);
  }
  const directory = options.directory ? path.resolve(options.directory) : await pickDirectory();
  await mkdir(directory, { recursive: true });
  const target = path.join(directory, CLI_NAME);
  if ((await exists(target)) && !(await isOurs(target)) && options.force !== true) {
    throw new Error(`${target} is already there and was not written by this package. Pass --force to replace it.`);
  }
  await writeFile(target, launcherScript(), "utf8");
  await chmod(target, 0o755);
  const onPath = (process.env.PATH ?? "").split(path.delimiter).includes(directory);
  return { path: target, directory, onPath };
}

export type { InstallOptions, InstalledCli };
export { installCli };
