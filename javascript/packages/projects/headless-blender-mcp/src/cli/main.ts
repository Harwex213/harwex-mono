#!/usr/bin/env node
import { readFile } from "node:fs/promises";
import { parseArgs } from "node:util";
import { BLENDER_SKILL_PATH } from "../blender/paths.js";
import { claudeCodeAddCommand, claudeCodeMcpJson } from "../config/claude-code.js";
import { codexMcpToml } from "../config/codex.js";
import type { McpConfigOptions } from "../config/launch.js";
import { installCli } from "../install.js";
import { serveStdio } from "../mcp/stdio.js";
import { CLI_NAME, ENV_BLEND, ENV_BLENDER, ENV_PYTHON, SERVER_NAME, SERVER_VERSION } from "../meta.js";
import { createSession } from "../session.js";

/**
 * The command line. `serve` is what Claude Code and Codex spawn; `config`
 * writes the block that makes them spawn it; `install` puts this command on
 * PATH; `skill` prints the instructions an agent should read before it starts
 * modelling.
 */

const USAGE = `${SERVER_NAME} ${SERVER_VERSION}

  A headless Blender behind an MCP server, spoken over stdio.

Usage
  ${CLI_NAME} serve [--blend <file.blend>] [options]
  ${CLI_NAME} config <claude|codex> [--blend <file.blend>] [options]
  ${CLI_NAME} install [--dir <bin-dir>] [--force]
  ${CLI_NAME} skill [--path]

Options
  --blend <file>      A .blend to open at startup. Left out, the agent opens one
                      itself with the open_blend_file tool, so one registered
                      server serves every project. Created when missing.
  --blender <path>    The Blender executable. Default: $${ENV_BLENDER}, else the usual place.
  --python <path>     A python3 for the documentation tools. Default: $${ENV_PYTHON}, else python3.
  --name <name>       Name the host knows the server by, for \`config\`. Default: blender.
  --no-create         Fail instead of creating a missing .blend.
  --command <bin>     Override the launcher written into a config. Default: this node.
  --add               For \`config claude\`: print the \`claude mcp add-json\` line instead of JSON.
  --dir <bin-dir>     For \`install\`: where to put the launcher. Default: a writable PATH dir.
  --force             For \`install\`: overwrite a launcher that is already there.
  --path              For \`skill\`: print where the skill file is instead of its text.
  -h, --help          This text.
  -v, --version       The version.
`;

const OPTIONS = {
  blend: { type: "string" },
  blender: { type: "string" },
  python: { type: "string" },
  name: { type: "string" },
  command: { type: "string" },
  dir: { type: "string" },
  create: { type: "boolean", default: true },
  "no-create": { type: "boolean", default: false },
  add: { type: "boolean", default: false },
  force: { type: "boolean", default: false },
  path: { type: "boolean", default: false },
  help: { type: "boolean", short: "h", default: false },
  version: { type: "boolean", short: "v", default: false },
} as const;

type Values = {
  blend?: string;
  blender?: string;
  python?: string;
  name?: string;
  command?: string;
  dir?: string;
  create: boolean;
  "no-create": boolean;
  add: boolean;
  force: boolean;
  path: boolean;
  help: boolean;
  version: boolean;
};

/** `parseArgs` has no negated booleans, so `--no-create` is its own flag. */
function createMissing(values: Values): boolean {
  return values["no-create"] ? false : values.create;
}

function fail(message: string): never {
  process.stderr.write(`${message}\n\nRun \`${CLI_NAME} --help\` for the usage.\n`);
  process.exit(2);
}

/** The `.blend` the caller named, if any. There is no default file. */
function blendOption(values: Values): string | undefined {
  const blend = values.blend ?? process.env[ENV_BLEND];
  return blend && blend.length > 0 ? blend : undefined;
}

function configOptions(values: Values): McpConfigOptions {
  const blend = blendOption(values);
  return {
    ...(blend ? { blendPath: blend } : {}),
    ...(values.name ? { serverName: values.name } : {}),
    ...(values.blender ? { blenderPath: values.blender } : {}),
    ...(values.python ? { pythonPath: values.python } : {}),
    ...(values.command ? { command: values.command } : {}),
  };
}

async function runServe(values: Values): Promise<void> {
  if (values.python) {
    process.env[ENV_PYTHON] = values.python;
  }
  const blend = blendOption(values);
  const session = createSession({
    ...(blend ? { blendPath: blend } : {}),
    ...(values.blender ? { blenderPath: values.blender } : {}),
    create: createMissing(values),
  });
  await serveStdio(session);
}

async function runSkill(values: Values): Promise<void> {
  if (values.path) {
    process.stdout.write(`${BLENDER_SKILL_PATH}\n`);
    return;
  }
  process.stdout.write(await readFile(BLENDER_SKILL_PATH, "utf8"));
}

async function runInstall(values: Values): Promise<void> {
  const installed = await installCli({
    ...(values.dir ? { directory: values.dir } : {}),
    force: values.force,
  });
  process.stdout.write(`${installed.path}\n`);
  if (!installed.onPath) {
    process.stderr.write(`[${CLI_NAME}] ${installed.directory} is not on your PATH. Add it to use \`${CLI_NAME}\` by name.\n`);
  }
}

function runConfig(target: string | undefined, values: Values): void {
  if (target === "claude") {
    const options = configOptions(values);
    process.stdout.write(values.add ? `${claudeCodeAddCommand(options)}\n` : claudeCodeMcpJson(options));
    return;
  }
  if (target === "codex") {
    process.stdout.write(codexMcpToml(configOptions(values)));
    return;
  }
  fail(`config takes \`claude\` or \`codex\`, not ${target ? `\`${target}\`` : "nothing"}.`);
}

async function main(): Promise<void> {
  let parsed;
  try {
    parsed = parseArgs({ args: process.argv.slice(2), options: OPTIONS, allowPositionals: true });
  } catch (error) {
    fail(error instanceof Error ? error.message : String(error));
  }
  const values = parsed.values as Values;
  const [command, target] = parsed.positionals;

  if (values.version) {
    process.stdout.write(`${SERVER_VERSION}\n`);
    return;
  }
  if (values.help || command === undefined || command === "help") {
    process.stdout.write(USAGE);
    return;
  }
  if (command === "serve") {
    await runServe(values);
    return;
  }
  if (command === "config") {
    runConfig(target, values);
    return;
  }
  if (command === "install") {
    await runInstall(values);
    return;
  }
  if (command === "skill") {
    await runSkill(values);
    return;
  }
  fail(`Unknown command \`${command}\`.`);
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
