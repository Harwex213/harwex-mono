import { spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

/**
 * Three processes make the app in development: tsc watches the Electron side,
 * rspack serves the renderer, and Electron loads that server. Electron only
 * starts once the other two have produced something to load.
 */

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const port = Number(process.env.IMAGEN_WEB_PORT ?? 5761);
const children = [];

function run(label, command, args, env) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: process.platform === "win32",
  });
  const prefix = (stream) => {
    stream.setEncoding("utf8");
    stream.on("data", (chunk) => {
      for (const line of chunk.split("\n")) {
        if (line.trim().length > 0) {
          process.stdout.write(`[${label}] ${line}\n`);
        }
      }
    });
  };
  prefix(child.stdout);
  prefix(child.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`[${label}] exited with ${code}\n`);
    if (label === "app") {
      stop(0);
    }
  });
  children.push(child);
  return child;
}

function stop(code) {
  for (const child of children) {
    child.kill();
  }
  process.exit(code);
}

function portIsUp() {
  return new Promise((resolve) => {
    const socket = net.connect({ port, host: "127.0.0.1" });
    socket.on("connect", () => {
      socket.end();
      resolve(true);
    });
    socket.on("error", () => {
      resolve(false);
    });
  });
}

async function waitFor(check, what) {
  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (await check()) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  process.stdout.write(`[dev] gave up waiting for ${what}\n`);
  stop(1);
}

const local = path.join(root, "node_modules", ".bin");
const bin = (name) => {
  return path.join(local, process.platform === "win32" ? `${name}.cmd` : name);
};

run("tsc", bin("tsc"), ["-p", "tsconfig.electron.json", "--watch", "--preserveWatchOutput"]);
run("web", bin("rspack"), ["serve"], { IMAGEN_WEB_PORT: String(port) });

const { stat } = await import("node:fs/promises");
await waitFor(async () => {
  try {
    await stat(path.join(root, "dist", "electron", "main.js"));
    return true;
  } catch {
    return false;
  }
}, "the Electron build");
await waitFor(portIsUp, "the rspack dev server");

const electron = (await import("electron")).default;
run("app", electron, ["."], { IMAGEN_DEV_URL: `http://127.0.0.1:${port}` });

process.on("SIGINT", () => {
  stop(0);
});
process.on("SIGTERM", () => {
  stop(0);
});
