import {
  generateColor,
  packOpaque,
  toHex,
  unpack,
} from "../colors/colors";
import type { DetectStats } from "../detect/detect-provinces";
import type { ProvinceRecord } from "../manifest/manifest";

// The province registry rules: how a province is created, how paint nobody
// claims is adopted, and the sentences that report an import or a detection.

type Province = ProvinceRecord & {
  hex: string;
};

function withHex(record: ProvinceRecord): Province {
  return { ...record, hex: toHex(unpack(record.color)) };
}

function takenColors(provinces: readonly Province[]): Set<number> {
  return new Set(provinces.map((province) => province.color));
}

// A new province gets a generated colour no other province holds.
function createProvince(id: number, taken: ReadonlySet<number>, name?: string): Province {
  const rgb = generateColor(id, taken);

  return {
    id,
    name: name ?? `Province ${id}`,
    kind: "land",
    color: packOpaque(rgb),
    hex: toHex(rgb),
  };
}

// The id after the highest one in use.
function nextIdAfter(provinces: readonly Province[]): number {
  return provinces.reduce((highest, province) => Math.max(highest, province.id), 0) + 1;
}

// Colours sitting in the layer that no manifest entry claims. They are adopted
// as provinces instead of being left as orphan paint: the alternative is an
// export whose image holds colours its manifest does not describe.
function adoptStrayColors(current: Province[], layerColors: Iterable<number>): Province[] {
  const known = takenColors(current);
  const strays = [...layerColors].filter((color) => !known.has(color));

  if (strays.length === 0) {
    return current;
  }

  let id = nextIdAfter(current) - 1;

  return [
    ...current,
    ...strays.map((color) => {
      id += 1;

      return withHex({ id, name: `Province ${id}`, kind: "land", color });
    }),
  ];
}

type ImportReport = {
  listed: number;
  adopted: number;
  skipped: number | null;
  dropped: number | null;
  manifestSource: string | null;
  mapName: string;
};

function importNotice(report: ImportReport): string {
  const { listed, adopted, skipped, dropped } = report;
  const parts = [`${listed} province${listed === 1 ? "" : "s"} from the manifest`];

  if (adopted > 0) {
    parts.push(`${adopted} unlisted colour${adopted === 1 ? "" : "s"} adopted`);
  }
  if (skipped !== null && skipped > 0) {
    parts.push(`${skipped} unusable entr${skipped === 1 ? "y" : "ies"} skipped`);
  }
  if (dropped !== null && dropped > 0) {
    parts.push(`${dropped} part-transparent pixels dropped`);
  }
  if (report.manifestSource && report.manifestSource !== report.mapName) {
    parts.push(`manifest was exported from "${report.manifestSource}"`);
  }

  return `Loaded ${parts.join(", ")}.`;
}

function detectionNotice(count: number, stats: DetectStats): string {
  const parts = [`${count} land provinces across ${stats.keptBodies} landmasses`];

  if (stats.edgeBodies > 0) {
    parts.push(`${stats.edgeBodies} region${stats.edgeBodies === 1 ? "" : "s"} touching the frame ignored`);
  }
  if (stats.discardedSpecks > 0) {
    parts.push(`${stats.discardedSpecks} specks discarded`);
  }

  parts.push(`largest ${stats.largestArea.toLocaleString()} px, median ${stats.medianArea.toLocaleString()} px`);

  return `Detected ${parts.join(", ")}.`;
}

export {
  adoptStrayColors,
  createProvince,
  detectionNotice,
  importNotice,
  nextIdAfter,
  takenColors,
  withHex,
  type ImportReport,
  type Province,
};
