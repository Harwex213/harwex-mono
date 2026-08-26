import { spawn } from "node:child_process";
import process from "node:process";

const children = [];
let shuttingDown = false;

function shutdown(code) {
  if (shuttingDown) {
    return;
  }
  shuttingDown = true;
  for (const child of children) {
    child.kill("SIGTERM");
  }
  setTimeout(() => {
    process.exit(code);
  }, 200);
}

function run(label, command, args) {
  const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], shell: false });
  const prefix = `[${label}] `;
  const pipe = (stream, target) => {
    stream.setEncoding("utf8");
    let pending = "";
    stream.on("data", (chunk) => {
      pending += chunk;
      const lines = pending.split("\n");
      pending = lines.pop() ?? "";
      for (const line of lines) {
        target.write(`${prefix}${line}\n`);
      }
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on("exit", (code) => {
    process.stdout.write(`${prefix}exited with code ${code}\n`);
    shutdown(code ?? 1);
  });
  children.push(child);
}

process.on("SIGINT", () => {
  shutdown(0);
});
process.on("SIGTERM", () => {
  shutdown(0);
});

run("api", process.execPath, ["server/index.ts"]);
run("web", "yarn", ["rspack", "serve"]);
