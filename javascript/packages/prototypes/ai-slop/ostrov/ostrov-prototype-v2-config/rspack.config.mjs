import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const PACKAGE_DIR = path.dirname(fileURLToPath(import.meta.url));
const CONFIG_FILE = path.join(PACKAGE_DIR, "data", "config.json");
const SCHEMA_URL = new URL("./src/schema.ts", import.meta.url).href;

/** Refuses to write past the values file, whatever else ever calls this. */
function assertInsidePackage(target) {
  const resolved = path.resolve(target);
  if (resolved !== CONFIG_FILE) {
    throw new Error(`Запись разрешена только в ${CONFIG_FILE}`);
  }
  return resolved;
}

let schemaModule = null;

/**
 * Loads the schema for server-side validation. The URL is built at run time so
 * nothing tries to bundle it: Node loads the TypeScript directly and strips the
 * types, which keeps one schema for the UI, the game and this endpoint.
 */
function loadSchema() {
  if (!schemaModule) {
    schemaModule = import(SCHEMA_URL);
  }
  return schemaModule;
}

function sendJson(res, status, payload) {
  res.statusCode = status;
  res.setHeader("content-type", "application/json; charset=utf-8");
  res.setHeader("cache-control", "no-store");
  res.end(JSON.stringify(payload));
}

async function readBody(req) {
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    // The whole config is a couple of kilobytes; anything larger is not ours.
    if (size > 256 * 1024) {
      throw new Error("тело запроса слишком велико");
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks).toString("utf8");
}

async function handleGet(res) {
  const text = await readFile(CONFIG_FILE, "utf8");
  sendJson(res, 200, { values: JSON.parse(text) });
}

async function handlePost(req, res) {
  const { serializeConfig, validateConfig } = await loadSchema();
  let raw;
  try {
    raw = JSON.parse(await readBody(req));
  } catch (error) {
    sendJson(res, 400, { ok: false, issues: [{ path: "", message: `не JSON: ${String(error)}` }] });
    return;
  }
  const result = validateConfig(raw);
  if (!result.ok) {
    sendJson(res, 422, { ok: false, issues: result.issues });
    return;
  }
  await writeFile(assertInsidePackage(CONFIG_FILE), serializeConfig(result.value), "utf8");
  sendJson(res, 200, { ok: true });
}

function configApi(req, res, next) {
  const run = async () => {
    if (req.method === "GET") {
      await handleGet(res);
      return;
    }
    if (req.method === "POST") {
      await handlePost(req, res);
      return;
    }
    next();
  };
  run().catch((error) => {
    sendJson(res, 500, { ok: false, issues: [{ path: "", message: String(error) }] });
  });
}

export default {
  entry: {
    main: "./src/editor/main.tsx",
  },
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
  },
  module: {
    parser: {
      "css/auto": {
        namedExports: false,
      },
    },
    generator: {
      "css/auto": {
        exportsConvention: "camel-case-only",
      },
    },
    rules: [
      {
        test: /\.tsx?$/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
              tsx: true,
            },
            transform: {
              react: {
                runtime: "automatic",
              },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\.css$/i,
        type: "css/auto",
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS, as everywhere else in the repo: a fixed port
    // lets a forgotten server from an earlier run answer with a stale bundle.
    port: 0,
    setupMiddlewares: (middlewares) => {
      middlewares.unshift({
        name: "ostrov-config-api",
        path: "/api/config",
        middleware: configApi,
      });
      return middlewares;
    },
  },
};
