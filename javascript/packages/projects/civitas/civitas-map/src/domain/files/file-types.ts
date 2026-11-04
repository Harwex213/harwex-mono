// What a file is, judged from its name and MIME type. Takes the two fields
// rather than a `File`, so the rules are testable without a browser.

type FileLike = {
  name: string;
  type: string;
};

const MAP_IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp"];

function isMapImageFile(file: FileLike): boolean {
  if (MAP_IMAGE_TYPES.includes(file.type)) {
    return true;
  }

  // Some file managers hand over an empty MIME type, so the extension is the
  // fallback rather than the primary check.
  return /\.(png|jpe?g|webp)$/i.test(file.name);
}

function isPngFile(file: FileLike): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

function isJsonFile(file: FileLike): boolean {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

// The countries file of an export is `<export>.countries.json`, beside the
// manifest `<export>.json`. Both are JSON, so the name tells them apart.
function isCountriesFile(file: FileLike): boolean {
  return /\.countries\.json$/i.test(file.name);
}

// The file name without its extension, used to name an export after its map.
function baseName(filename: string): string {
  return filename.replace(/\.[^./\\]+$/, "") || "map";
}

export {
  baseName,
  isCountriesFile,
  isJsonFile,
  isMapImageFile,
  isPngFile,
  type FileLike,
};
