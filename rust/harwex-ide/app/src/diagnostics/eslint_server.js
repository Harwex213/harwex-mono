// harwex-ide's ESLint server: one node process per workspace root, started as `node -e`.
//
// It speaks the subset of LSP that `ide-lsp` uses: initialize, full-text didOpen/didChange/
// didClose, pull diagnostics (`textDocument/diagnostic`), $/cancelRequest, shutdown, exit.
// The diagnostic request carries `harwex.configDir` (the directory of the nearest ESLint
// config, found by the app) and `harwex.legacy` (an `.eslintrc*` config).
//
// - One `ESLint` instance per config directory, with `cwd` there and the `eslint` package
//   resolved from there. ESLint caches the loaded config inside the instance, so a warm lint
//   only parses and runs rules.
// - typescript-eslint keeps one TypeScript project service per process (`projectService`).
//   When the editor has no file open here any more, the instances and the TS caches are
//   dropped, so the memory of type-aware linting goes with the last closed file.
// - Requests run one at a time. A request cancelled while it waits is answered with
//   RequestCancelled and never linted.
"use strict";

const path = require("node:path");
const { createRequire } = require("node:module");
const { fileURLToPath } = require("node:url");

// A long-lived process: typescript-eslint must keep its programs up to date, not build a
// one-shot program as it does for `CI=true` runs.
process.env.TSESTREE_SINGLE_RUN = "false";

const docs = new Map(); // uri -> text
const instances = new Map(); // `${legacy}:${configDir}` -> Promise<ESLint>
const cancelled = new Set();
let queue = Promise.resolve();

function send(msg) {
  const body = Buffer.from(JSON.stringify(msg), "utf8");
  process.stdout.write(`Content-Length: ${body.length}\r\n\r\n`);
  process.stdout.write(body);
}

function reply(id, result) {
  send({ jsonrpc: "2.0", id, result });
}

function fail(id, code, message) {
  send({ jsonrpc: "2.0", id, error: { code, message } });
}

async function loadESLintClass(configDir, legacy) {
  const req = createRequire(path.join(configDir, "__harwex_eslint__.js"));
  const api = req(req.resolve("eslint"));
  if (typeof api.loadESLint === "function") {
    return api.loadESLint({ useFlatConfig: !legacy });
  }
  // ESLint 8 before 8.57: `ESLint` is the eslintrc class, flat config lives elsewhere.
  if (legacy) {
    return api.ESLint;
  }
  return req(req.resolve("eslint/use-at-your-own-risk")).FlatESLint;
}

function instance(configDir, legacy) {
  const key = `${legacy}:${configDir}`;
  let p = instances.get(key);
  if (!p) {
    p = loadESLintClass(configDir, legacy).then((ESLint) => new ESLint({ cwd: configDir }));
    instances.set(key, p);
    // A failed load (a broken config) is tried again on the next request.
    p.catch(() => instances.delete(key));
  }
  return p;
}

// Line starts as ESLint counts lines (it also breaks at \r, U+2028 and U+2029).
function eslintLineStarts(text) {
  const starts = [0];
  const re = /\r\n|[\r\n\u2028\u2029]/g;
  let m;
  while ((m = re.exec(text))) {
    starts.push(m.index + m[0].length);
  }
  return starts;
}

// Line starts as LSP counts lines (\n, \r\n, \r).
function lspLineStarts(text) {
  const starts = [0];
  const re = /\r\n|[\r\n]/g;
  let m;
  while ((m = re.exec(text))) {
    starts.push(m.index + m[0].length);
  }
  return starts;
}

function toLsp(offset, lspStarts) {
  let lo = 0;
  let hi = lspStarts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (lspStarts[mid] <= offset) {
      lo = mid;
    } else {
      hi = mid - 1;
    }
  }
  return { line: lo, character: offset - lspStarts[lo] };
}

function convert(text, messages) {
  const es = eslintLineStarts(text);
  const lsp = lspLineStarts(text);
  // ESLint lines and columns are 1-based; columns count UTF-16 units, like LSP.
  const offset = (line, column) => {
    const l = Math.min(Math.max(line, 1), es.length) - 1;
    return Math.min(es[l] + Math.max(column, 1) - 1, text.length);
  };
  return messages.map((m) => {
    const start = offset(m.line ?? 1, m.column ?? 1);
    const end = m.endLine != null ? offset(m.endLine, m.endColumn ?? 1) : start;
    return {
      range: { start: toLsp(start, lsp), end: toLsp(Math.max(end, start), lsp) },
      severity: m.severity === 2 ? 1 : 2,
      code: m.ruleId ?? undefined,
      source: "eslint",
      message: m.message,
    };
  });
}

// The loaded copies of a typescript-estree module, found by the end of its path.
function loaded(suffix) {
  return Object.keys(require.cache)
    .filter((id) => id.replace(/\\/g, "/").endsWith(`/@typescript-eslint/typescript-estree/dist/${suffix}`))
    .map((id) => require.cache[id].exports);
}

// typescript-eslint guesses a missing `tsconfigRootDir` from the directories of every config
// file that read `tseslint.configs` in this process. With a second package's config loaded,
// the guess fails ("multiple candidate TSConfigRootDirs"). Lints run one at a time, so the
// guess is narrowed to the config being linted.
function narrowRootDirGuess(configDir) {
  for (const m of loaded("parseSettings/candidateTSConfigRootDirs.js")) {
    if (typeof m.clearCandidateTSConfigRootDirs === "function" && typeof m.addCandidateTSConfigRootDir === "function") {
      m.clearCandidateTSConfigRootDirs();
      m.addCandidateTSConfigRootDir(configDir);
    }
  }
}

async function diagnostic(params) {
  const uri = params.textDocument.uri;
  const file = fileURLToPath(uri);
  const text = docs.get(uri);
  const opts = params.harwex || {};
  if (text === undefined || !opts.configDir) {
    return { kind: "full", items: [] };
  }
  const eslint = await instance(opts.configDir, !!opts.legacy);
  if (await eslint.isPathIgnored(file)) {
    return { kind: "full", items: [] };
  }
  narrowRootDirGuess(opts.configDir);
  const [result] = await eslint.lintText(text, { filePath: file, warnIgnored: false });
  return { kind: "full", items: result ? convert(text, result.messages) : [] };
}

// Drops every ESLint instance and typescript-eslint's TS project service and program
// caches. They hold all type information; the next lint builds them again.
function unload() {
  instances.clear();
  for (const m of loaded("clear-caches.js")) {
    if (typeof m.clearCaches === "function") {
      m.clearCaches();
    }
  }
  if (typeof global.gc === "function") {
    global.gc();
  }
}

function handle(msg) {
  const { id, method, params } = msg;
  switch (method) {
    case "initialize":
      reply(id, {
        capabilities: {
          textDocumentSync: 1,
          diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false },
        },
        serverInfo: { name: "harwex-eslint" },
      });
      return;
    case "initialized":
      return;
    case "textDocument/didOpen":
      docs.set(params.textDocument.uri, params.textDocument.text);
      return;
    case "textDocument/didChange":
      docs.set(params.textDocument.uri, params.contentChanges[params.contentChanges.length - 1].text);
      return;
    case "textDocument/didClose":
      docs.delete(params.textDocument.uri);
      if (docs.size === 0) {
        queue = queue.then(unload);
      }
      return;
    case "$/cancelRequest":
      cancelled.add(params.id);
      return;
    case "textDocument/diagnostic":
      queue = queue.then(async () => {
        if (cancelled.delete(id)) {
          fail(id, -32800, "cancelled");
          return;
        }
        try {
          reply(id, await diagnostic(params));
        } catch (e) {
          fail(id, -32603, String((e && e.message) || e).split("\n")[0]);
        }
      });
      return;
    case "shutdown":
      queue = queue.then(() => reply(id, null));
      return;
    case "exit":
      process.exit(0);
      return;
    default:
      if (id !== undefined) {
        fail(id, -32601, `unknown method ${method}`);
      }
  }
}

let buf = Buffer.alloc(0);
process.stdin.on("data", (chunk) => {
  buf = Buffer.concat([buf, chunk]);
  for (;;) {
    const sep = buf.indexOf("\r\n\r\n");
    if (sep < 0) {
      return;
    }
    const header = buf.subarray(0, sep).toString("ascii");
    const m = /Content-Length:\s*(\d+)/i.exec(header);
    const len = m ? Number(m[1]) : 0;
    if (buf.length < sep + 4 + len) {
      return;
    }
    const body = buf.subarray(sep + 4, sep + 4 + len).toString("utf8");
    buf = buf.subarray(sep + 4 + len);
    let msg;
    try {
      msg = JSON.parse(body);
    } catch {
      continue;
    }
    handle(msg);
  }
});
process.stdin.on("end", () => process.exit(0));
// The app is the only reader of stdout; a closed pipe means it is gone.
process.stdout.on("error", () => process.exit(0));
