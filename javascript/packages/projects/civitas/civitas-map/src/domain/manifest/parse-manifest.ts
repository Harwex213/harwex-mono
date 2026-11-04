import {
  fromHex,
  packOpaque,
  type Rgb,
} from "../colors/colors";
import type { ProvinceKind, ProvinceRecord } from "./manifest";

// Reads the manifest half of an export back in. The pair is the province PNG
// (the pixels) and the manifest (the names, kinds and ids). Either half is
// accepted alone: the image carries the geometry, the manifest carries
// everything the image cannot.

type ParsedManifest = {
  records: ProvinceRecord[];
  source: string | null;
  skipped: number;
};

const KINDS: ProvinceKind[] = ["land", "sea", "lake"];

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

export {
  parseManifest,
  type ParsedManifest,
};
