import { readdir, stat } from "node:fs/promises";
import path from "node:path";

// The maps API of the dev server. A real backend replaces it later, so the
// response is the whole contract the app relies on:
//
//   GET /api/maps -> 200 { "images": [MapImage, ...] }
//   MapImage = { name, url, bytes, manifestUrl }
//
// `url` and `manifestUrl` are relative to the page. The images themselves are
// served by the dev server's static handler, not by this module.

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".webp"]);

// Lists the images in `directory`, sorted by name. An image whose stem also has a
// `.json` file beside it gets that file as `manifestUrl`: that pair is what the
// editor's export writes, and `Load provinces…` reads both halves.
async function listMapImages(directory, urlPrefix) {
  let names;
  try {
    names = await readdir(directory);
  } catch (error) {
    if (error && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const lowerNames = new Map();
  for (const name of names) {
    lowerNames.set(name.toLowerCase(), name);
  }

  const images = [];
  for (const name of names) {
    const extension = path.extname(name).toLowerCase();
    if (!IMAGE_EXTENSIONS.has(extension)) {
      continue;
    }
    const info = await stat(path.join(directory, name));
    if (!info.isFile()) {
      continue;
    }
    const stem = name.slice(0, name.length - extension.length);
    const manifestName = lowerNames.get((stem + ".json").toLowerCase()) ?? null;
    images.push({
      name,
      url: urlPrefix + encodeURIComponent(name),
      bytes: info.size,
      manifestUrl: manifestName === null ? null : urlPrefix + encodeURIComponent(manifestName),
    });
  }

  images.sort((left, right) => {
    if (left.name < right.name) {
      return -1;
    }
    if (left.name > right.name) {
      return 1;
    }
    return 0;
  });
  return images;
}

// A connect-style middleware for `devServer.setupMiddlewares`. It is mounted on a
// path, so `request.url` holds only what follows that path.
function createMapsApiMiddleware(options) {
  return (request, response, next) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      next();
      return;
    }
    const pathname = (request.url ?? "/").split("?")[0];
    if (pathname !== "/" && pathname !== "") {
      next();
      return;
    }
    listMapImages(options.directory, options.urlPrefix).then(
      (images) => {
        response.statusCode = 200;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.setHeader("Cache-Control", "no-store");
        response.end(request.method === "HEAD" ? undefined : JSON.stringify({ images }));
      },
      (error) => {
        response.statusCode = 500;
        response.setHeader("Content-Type", "application/json; charset=utf-8");
        response.end(JSON.stringify({ error: error instanceof Error ? error.message : String(error) }));
      },
    );
  };
}

export { createMapsApiMiddleware, listMapImages };
