// The scene endpoints of `yarn dev`. They are not part of the bundle: a save never rebuilds or reloads the page.
//   GET  scene/versions/index.json, scene/versions/NNN.json  the files on disk (the build copies them into dist)
//   POST __scene/save      { version, changes }  merges an edit into a version; 409 with the conflicts
//   POST __scene/versions  { label }             a new version: a copy of the latest
//   GET  __scene/events    server-sent events: `file` { version, hash } when a version file changes on disk,
//                          `index` (the index) when the list of versions changes
import { watch } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { hashText } from "../src/engine/sceneMerge.ts";
import { createVersion, readIndex, saveChanges, sceneDir } from "./sceneStore.mjs";

const VERSION_FILE = /^(\d{3,})\.json$/;

function readBody(request) {
  return new Promise((done, fail) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk) => {
      body += chunk;
    });
    request.on("end", () => {
      done(body);
    });
    request.on("error", fail);
  });
}

function sendJson(response, status, value) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(value));
}

function createSceneServer() {
  const dir = sceneDir();
  const clients = new Set();
  // The last known hash of every version file, so an event goes out only for a real change.
  const hashes = new Map();
  let lastIndex = "";
  const timers = new Map();

  const broadcast = (event, data) => {
    const message = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const client of clients) {
      client.write(message);
    }
  };

  const check = async (name) => {
    try {
      const text = await readFile(join(dir, name), "utf8");
      if (name === "index.json") {
        if (text !== lastIndex) {
          lastIndex = text;
          broadcast("index", JSON.parse(text));
        }
        return;
      }
      const match = VERSION_FILE.exec(name);
      if (!match) {
        return;
      }
      // A file in the middle of a hand edit may not parse yet: the next change brings it.
      JSON.parse(text);
      const hash = hashText(text);
      if (hashes.get(name) !== hash) {
        hashes.set(name, hash);
        broadcast("file", { version: Number(match[1]), hash });
      }
    } catch (error) {
      if (error.code !== "ENOENT") {
        console.warn(`[scene] ${name} cannot be read yet: ${error.message}`);
      }
    }
  };

  const startWatching = async () => {
    try {
      lastIndex = await readFile(join(dir, "index.json"), "utf8");
      const index = JSON.parse(lastIndex);
      for (const version of index.versions) {
        const name = `${String(version.id).padStart(3, "0")}.json`;
        hashes.set(name, hashText(await readFile(join(dir, name), "utf8")));
      }
    } catch (error) {
      console.error(`[scene] cannot read the scene versions in ${dir}`, error);
    }
    watch(dir, (_type, name) => {
      if (!name || name.startsWith(".") || name.endsWith(".tmp")) {
        return;
      }
      clearTimeout(timers.get(name));
      timers.set(name, setTimeout(() => {
        timers.delete(name);
        void check(name);
      }, 60));
    });
    console.log(`[scene] versions folder: ${dir}`);
  };
  void startWatching();

  const files = async (request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      next();
      return;
    }
    const name = decodeURIComponent((request.url ?? "").split("?")[0].replace(/^\/+/, ""));
    if (name !== "index.json" && !VERSION_FILE.test(name)) {
      next();
      return;
    }
    try {
      const text = await readFile(join(dir, name), "utf8");
      response.statusCode = 200;
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Cache-Control", "no-store");
      response.end(text);
    } catch {
      response.statusCode = 404;
      response.end();
    }
  };

  const save = async (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    try {
      const { version, changes } = JSON.parse(await readBody(request));
      const result = await saveChanges(Number(version), changes, dir);
      if (result.missing) {
        sendJson(response, 404, { error: `version ${version} does not exist` });
        return;
      }
      if (!result.ok) {
        sendJson(response, 409, { conflicts: result.conflicts, hash: result.hash });
        return;
      }
      const name = `${String(version).padStart(3, "0")}.json`;
      // The tab that saved knows this hash; the other tabs hear about it now, the watcher stays quiet.
      if (hashes.get(name) !== result.hash) {
        hashes.set(name, result.hash);
        broadcast("file", { version: Number(version), hash: result.hash });
      }
      sendJson(response, 200, { hash: result.hash, text: result.text });
    } catch (error) {
      console.error("[scene] cannot save the scene", error);
      sendJson(response, 400, { error: String(error.message ?? error) });
    }
  };

  const versions = async (request, response, next) => {
    if (request.method !== "POST") {
      next();
      return;
    }
    try {
      const { label } = JSON.parse((await readBody(request)) || "{}");
      const result = await createVersion(label, dir);
      lastIndex = `${JSON.stringify(result.index, null, 2)}\n`;
      broadcast("index", result.index);
      sendJson(response, 200, result);
    } catch (error) {
      console.error("[scene] cannot create a version", error);
      sendJson(response, 400, { error: String(error.message ?? error) });
    }
  };

  const events = (request, response, next) => {
    if (request.method !== "GET") {
      next();
      return;
    }
    response.writeHead(200, {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write(": scene events\n\n");
    clients.add(response);
    const heartbeat = setInterval(() => {
      response.write(": ping\n\n");
    }, 15000);
    request.on("close", () => {
      clearInterval(heartbeat);
      clients.delete(response);
    });
  };

  // Connect middlewares, mounted by path. They go before the compression middleware: an event stream must not wait in a buffer.
  return [
    { name: "scene-files", path: "/scene/versions", middleware: files },
    { name: "scene-save", path: "/__scene/save", middleware: save },
    { name: "scene-versions", path: "/__scene/versions", middleware: versions },
    { name: "scene-events", path: "/__scene/events", middleware: events },
  ];
}

export { createSceneServer };
