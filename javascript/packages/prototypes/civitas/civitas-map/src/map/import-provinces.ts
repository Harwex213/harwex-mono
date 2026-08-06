import { alphaOf, fromHex, packOpaque, type Rgb } from "./colors";
import type { ProvinceKind, ProvinceRecord } from "./manifest";

// Reads an export back in. The pair is the province PNG (the pixels) and the
// manifest (the names, kinds and ids). Either half is accepted alone: the image
// carries the geometry, the manifest carries everything the image cannot.

type ParsedManifest = {
  records: ProvinceRecord[];
  source: string | null;
  skipped: number;
};

type DecodedPixels = {
  pixels: Uint32Array;
  dropped: number;
};

const KINDS: ProvinceKind[] = ["land", "sea", "lake"];

function isPngFile(file: File): boolean {
  return file.type === "image/png" || /\.png$/i.test(file.name);
}

function isJsonFile(file: File): boolean {
  return file.type === "application/json" || /\.json$/i.test(file.name);
}

function colorOf(entry: Record<string, unknown>): number | null {
  const rgb = entry.rgb;

  if (Array.isArray(rgb) && rgb.length >= 3) {
    const channels = rgb.slice(0, 3).map((value) => Number(value));

    if (channels.every((value) => Number.isInteger(value) && value >= 0 && value <= 255)) {
      return packOpaque({ r: channels[0], g: channels[1], b: channels[2] } as Rgb);
    }
  }

  if (typeof entry.hex === "string") {
    const parsed = fromHex(entry.hex);

    if (parsed) {
      return packOpaque(parsed);
    }
  }

  return null;
}

function kindOf(value: unknown): ProvinceKind {
  if (typeof value === "string" && (KINDS as string[]).includes(value)) {
    return value as ProvinceKind;
  }

  return "land";
}

// Ids address a province for renaming and deleting, and key the list in React,
// so a file with repeated or missing ids gets the offenders renumbered rather
// than being rejected.
function idAllocator(): (preferred: unknown) => number {
  const used = new Set<number>();
  let next = 1;

  return (preferred: unknown) => {
    const value = Number(preferred);

    if (Number.isInteger(value) && value > 0 && !used.has(value)) {
      used.add(value);

      return value;
    }

    while (used.has(next)) {
      next += 1;
    }

    used.add(next);

    return next;
  };
}

function parseManifest(text: string, width: number, height: number): ParsedManifest {
  let payload: unknown;

  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error("the manifest is not valid JSON");
  }

  if (!payload || typeof payload !== "object") {
    throw new Error("the manifest is not a JSON object");
  }

  const root = payload as Record<string, unknown>;
  const list = root.provinces;

  if (!Array.isArray(list)) {
    throw new Error("the manifest has no `provinces` array");
  }

  const map = (root.map ?? {}) as Record<string, unknown>;
  const manifestWidth = Number(map.width);
  const manifestHeight = Number(map.height);

  // A manifest built for another map would place every province somewhere else,
  // so a size mismatch is refused rather than imported.
  if (
    Number.isInteger(manifestWidth) &&
    Number.isInteger(manifestHeight) &&
    (manifestWidth !== width || manifestHeight !== height)
  ) {
    throw new Error(
      `the manifest describes a ${manifestWidth}×${manifestHeight} map, this one is ${width}×${height}`,
    );
  }

  const nextId = idAllocator();
  const taken = new Set<number>();
  const records: ProvinceRecord[] = [];
  let skipped = 0;

  for (const raw of list) {
    if (!raw || typeof raw !== "object") {
      skipped += 1;

      continue;
    }

    const entry = raw as Record<string, unknown>;
    const color = colorOf(entry);

    // Without a colour an entry cannot be matched to any pixel, and two entries
    // sharing a colour would make the image ambiguous.
    if (color === null || taken.has(color)) {
      skipped += 1;

      continue;
    }

    taken.add(color);

    const id = nextId(entry.id);

    records.push({
      id,
      name: typeof entry.name === "string" && entry.name.length > 0 ? entry.name : `Province ${id}`,
      kind: kindOf(entry.kind),
      color,
    });
  }

  return {
    records,
    source: typeof map.source === "string" ? map.source : null,
    skipped,
  };
}

async function decodePixels(file: File, width: number, height: number): Promise<DecodedPixels> {
  const bitmap = await createImageBitmap(file);

  try {
    if (bitmap.width !== width || bitmap.height !== height) {
      throw new Error(
        `the province image is ${bitmap.width}×${bitmap.height}, the map is ${width}×${height}`,
      );
    }

    const canvas = document.createElement("canvas");

    canvas.width = width;
    canvas.height = height;

    const ctx = canvas.getContext("2d", { willReadFrequently: true });

    if (!ctx) {
      throw new Error("2d canvas context unavailable");
    }

    // Untransformed and unsmoothed, so this is a pixel-for-pixel copy.
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(bitmap, 0, 0);

    const image = ctx.getImageData(0, 0, width, height);
    const pixels = new Uint32Array(image.data.buffer as ArrayBuffer);
    let dropped = 0;

    // Anything not fully opaque is cleared, and cleared means exactly zero.
    //
    // Dropping rather than snapping to opaque is deliberate. A canvas stores
    // pixels premultiplied, so reading a part-transparent one back cannot return
    // its original colour — rgba(192,64,64,200) comes out as 193,64,64 — and a
    // province is identified by an exact colour. Keeping such a pixel would
    // invent a province that matches no manifest entry. Exports from this editor
    // are always fully opaque or fully clear, so this only fires on images from
    // elsewhere, and the count is reported.
    //
    // Clear pixels have to be zero and not merely alpha-zero: flood fill
    // compares whole values, and invisible pixels carrying different colours
    // would stop a fill for no visible reason.
    for (let index = 0; index < pixels.length; index += 1) {
      const value = pixels[index];
      const alpha = alphaOf(value);

      if (alpha === 255) {
        continue;
      }

      if (alpha > 0) {
        dropped += 1;
      }

      pixels[index] = 0;
    }

    return { pixels, dropped };
  } finally {
    bitmap.close();
  }
}

export { decodePixels, isJsonFile, isPngFile, parseManifest, type DecodedPixels, type ParsedManifest };
