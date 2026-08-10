import type { BuildingId, CategoryId } from "../buildings/catalog";
import { RESOURCE_COLOURS } from "../render/palette";
import type { UnitId } from "../units/catalog";

/**
 * Every glyph the build panel draws, on one 24×24 grid.
 *
 * Two vocabularies live here. The resource icons — wood, stone, gold, time —
 * are the same path strings the config editor uses in `src/editor/icons.tsx`,
 * copied rather than imported: the editor module is a page of that app, not part
 * of the config library's public entry, and one shared icon package for four
 * paths is not worth building yet. They are a candidate for that package later;
 * until then the two apps speak one visual language by copy. Food is this app's
 * own: the editor never had to draw it. The colours come from `palette.ts`,
 * which the crates on the map read too.
 *
 * The category and building glyphs are the panel's own. Every one of them is a
 * silhouette rather than a picture: the tiles are 40 and 46 pixels wide, so a
 * shape either reads as one blob at that size or does not read at all.
 */

type ResourceIconKind = "wood" | "stone" | "gold" | "food" | "time";

/** Copied from `@hw/ostrov-prototype-v2-config` `src/editor/icons.tsx`. */
const RESOURCE_PATHS: Record<ResourceIconKind, string> = {
  wood: "M12 2 L17.5 10.5 H14.6 L19.5 17.4 H4.5 L9.4 10.5 H6.5 Z M10.6 17.4 H13.4 V22 H10.6 Z",
  stone: "M4.5 14.6 L7.6 6.4 L13.6 3.4 L20 9.6 L18 19.6 L8 20.6 Z",
  gold:
    "M2.6 12 A9.4 9.4 0 1 0 21.4 12 A9.4 9.4 0 1 0 2.6 12 Z" +
    " M7.4 12 A4.6 4.6 0 1 0 16.6 12 A4.6 4.6 0 1 0 7.4 12 Z",
  // An ear of wheat: a stalk with four pairs of grains. A loaf reads as a stone
  // at this size, and a coin is already taken.
  food:
    "M11.2 22 V11.4 H12.8 V22 Z" +
    " M12 3.2 C13.6 4.6 13.6 6.6 12 8 C10.4 6.6 10.4 4.6 12 3.2 Z" +
    " M11.2 6.6 C11.2 8.6 10.2 9.8 8.2 10 C8.2 8 9.2 6.8 11.2 6.6 Z" +
    " M12.8 6.6 C14.8 6.8 15.8 8 15.8 10 C13.8 9.8 12.8 8.6 12.8 6.6 Z" +
    " M11.2 10.4 C11.2 12.4 10.2 13.6 8.2 13.8 C8.2 11.8 9.2 10.6 11.2 10.4 Z" +
    " M12.8 10.4 C14.8 10.6 15.8 11.8 15.8 13.8 C13.8 13.6 12.8 12.4 12.8 10.4 Z",
  time: "M5.6 2.4 H18.4 V4.6 L13.2 12 L18.4 19.4 V21.6 H5.6 V19.4 L10.8 12 L5.6 4.6 Z",
};

type ResourceIconProps = {
  kind: ResourceIconKind;
  className?: string;
};

function ResourceIcon({ kind, className }: ResourceIconProps): React.JSX.Element {
  return (
    <svg className={className ?? "tip-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={RESOURCE_PATHS[kind]} fill={RESOURCE_COLOURS[kind]} fillRule="evenodd" />
    </svg>
  );
}

/**
 * A saw blade, teeth generated rather than typed: ten identical ramps are the
 * one thing that says "sawmill" at 26 pixels, and ten hand-written vertices
 * would be ten chances to fat-finger a decimal.
 */
function sawBladePath(): string {
  const teeth = 10;
  const outer = 10.6;
  const inner = 8.1;
  const step = (Math.PI * 2) / teeth;
  const parts: string[] = [];
  for (let tooth = 0; tooth < teeth; tooth += 1) {
    const base = tooth * step;
    const x1 = 12 + Math.cos(base) * inner;
    const y1 = 12 + Math.sin(base) * inner;
    const x2 = 12 + Math.cos(base + step * 0.42) * outer;
    const y2 = 12 + Math.sin(base + step * 0.42) * outer;
    parts.push(`${tooth === 0 ? "M" : "L"}${x1.toFixed(2)} ${y1.toFixed(2)} L${x2.toFixed(2)} ${y2.toFixed(2)}`);
  }
  // The hub is punched out by the even-odd rule, so the blade reads as a ring.
  return `${parts.join(" ")} Z M9.2 12 A2.8 2.8 0 1 0 14.8 12 A2.8 2.8 0 1 0 9.2 12 Z`;
}

const SAW_BLADE = sawBladePath();

/** One filled silhouette, or a pair when a glyph needs a struck line as well. */
function filled(path: string): React.JSX.Element {
  return <path d={path} fill="currentColor" fillRule="evenodd" />;
}

/**
 * One upright sword. The war section of the build panel wears it, and so does
 * the army counter in the top bar — the same shape has to mean "soldiers" in
 * both places or the counter is just another number.
 */
const SWORD_PATH =
  "M12 1.4 L14.8 6.6 V13.2 H9.2 V6.6 Z M5.2 13.2 H18.8 V16.2 H5.2 Z" +
  " M10.5 16.2 H13.5 V19.8 H10.5 Z M9.4 19.8 H14.6 V22.4 H9.4 Z";

const CATEGORY_GLYPHS: Record<CategoryId, React.JSX.Element> = {
  // A crown, not a castle: the castle silhouette is taken by the building below it.
  core: (
    <g>
      {filled("M2.6 6.2 L7.4 11.4 L12 3.6 L16.6 11.4 L21.4 6.2 L19.6 17 H4.4 Z")}
      {filled("M4.4 18.4 H19.6 V21.2 H4.4 Z")}
    </g>
  ),
  // Three coins seen edge on. A stack, never the single ring that means gold.
  economics: (
    <g fill="currentColor">
      <ellipse cx="12" cy="18.4" rx="9.4" ry="3.1" />
      <ellipse cx="12" cy="12" rx="9.4" ry="3.1" />
      <ellipse cx="12" cy="5.6" rx="9.4" ry="3.1" />
    </g>
  ),
  // One upright sword, not two crossed ones: at 18 pixels a pair of blades
  // collapses into a plain ✕, and a single silhouette keeps its edges.
  war: filled(SWORD_PATH),
  defense: filled("M12 2.4 L20.6 5.6 V12.2 C20.6 16.8 17 20.4 12 21.8 C7 20.4 3.4 16.8 3.4 12.2 V5.6 Z"),
  magic: filled("M12 1.8 C13.1 8.4 15.6 10.9 22.2 12 C15.6 13.1 13.1 15.6 12 22.2 C10.9 15.6 8.4 13.1 1.8 12 C8.4 10.9 10.9 8.4 12 1.8 Z"),
};

const BUILDING_GLYPHS: Record<BuildingId, React.JSX.Element> = {
  // A crenellated wall between two towers, with the gate punched through.
  castle1: filled(
    "M2.4 21.6 V8.4 H4 V6.2 H5.6 V8.4 H7.2 V6.2 H8.8 V8.4 H9.6 V4.2 H11.2 V2 H12.8 V4.2 H14.4 V8.4" +
      " H15.2 V6.2 H16.8 V8.4 H18.4 V6.2 H20 V8.4 H21.6 V21.6 Z" +
      " M10.2 21.6 V16.4 A1.8 1.8 0 0 1 13.8 16.4 V21.6 Z",
  ),
  hut1: filled("M12 2.8 L21.8 11.2 H18.6 V21.2 H5.4 V11.2 H2.2 Z M10.2 21.2 V14.6 H13.8 V21.2 Z"),
  // A claimed banner: the controller's whole job is planting a flag on ground.
  islandController1: filled("M5.6 2.4 H8 V21.6 H5.6 Z M9.2 3.6 L20.4 8.2 L9.2 12.8 Z"),
  sawmill1: filled(SAW_BLADE),
  mill1: (
    <g>
      <path
        d="M12 8.6 L5.4 2.8 M12 8.6 L18.6 2.8 M12 8.6 L5.4 14.4 M12 8.6 L18.6 14.4"
        stroke="currentColor"
        strokeWidth="2.4"
        strokeLinecap="round"
        fill="none"
      />
      {filled("M9 21.6 L10.6 10.4 H13.4 L15 21.6 Z")}
    </g>
  ),
  mine1: filled(
    "M2.4 9.6 C6 4.6 18 4.6 21.6 9.6 C17.6 7.8 14.4 7.6 12 9.4 C9.6 7.6 6.4 7.8 2.4 9.6 Z" +
      " M10.9 9 H13.1 V21.8 H10.9 Z",
  ),
  // A tent, not a helmet: at 26 pixels a helmet is a blob and a tent is a tent.
  barracks1: filled(
    "M12 2.4 L22 21.6 H2 Z M9.4 21.6 C9.8 17 10.7 14.2 12 12.2 C13.3 14.2 14.2 17 14.6 21.6 Z",
  ),
};

/**
 * The units, on the same terms as the buildings: one silhouette each, told
 * apart by the piece of kit rather than by the figure, because at 29 pixels
 * every figure is the same figure.
 */
const UNIT_GLYPHS: Record<UnitId, React.JSX.Element> = {
  // A pick over a shoulder. The barracks never shows it — a worker is labour —
  // but the roster is complete, so a designer who flips its role gets a glyph.
  worker: filled(
    "M2.6 8.4 C7 4 17 4 21.4 8.4 L19.8 10.6 C16 7.4 8 7.4 4.2 10.6 Z" +
      " M10.6 9.4 H13.4 L12.8 21.8 H11.2 Z",
  ),
  // A closed helm: dome, brow band and the slit. Not a sword — the sword is the
  // war section of the build panel, and one glyph may only mean one thing.
  swordsman: filled(
    "M4.2 12.4 A7.8 7.8 0 0 1 19.8 12.4 V15.4 H15.2 V21.4 H8.8 V15.4 H4.2 Z" +
      " M7.4 10.6 H16.6 V13 H7.4 Z",
  ),
  // A drawn bow: the stave, the string and the nocked arrow.
  archer: (
    <g>
      <path
        d="M7.6 2.8 A10.4 10.4 0 0 1 7.6 21.2"
        stroke="currentColor"
        strokeWidth="2.6"
        strokeLinecap="round"
        fill="none"
      />
      <path d="M7.6 2.8 L7.6 21.2" stroke="currentColor" strokeWidth="1.4" fill="none" />
      {filled("M3.4 11 H17.4 V13 H3.4 Z M17 8.6 L21.8 12 L17 15.4 Z")}
    </g>
  ),
};

/**
 * Two arrows chasing each other round a circle: the standing symbol for "keep
 * doing this". Drawn as a stroked arc with a solid head, so it stays legible at
 * the 22 pixels the toggle is.
 */
const REPEAT_GLYPH: React.JSX.Element = (
  <g>
    <path
      d="M5.4 12 A6.6 6.6 0 0 1 16.9 7.6 M18.6 12 A6.6 6.6 0 0 1 7.1 16.4"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      fill="none"
    />
    {filled("M17.6 3.6 L18.6 9.2 L13.2 8 Z M6.4 20.4 L5.4 14.8 L10.8 16 Z")}
  </g>
);

type GlyphProps = {
  className: string;
  children: React.ReactNode;
};

function Glyph({ className, children }: GlyphProps): React.JSX.Element {
  return (
    <svg className={className} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      {children}
    </svg>
  );
}

function CategoryGlyph({ id }: { id: CategoryId }): React.JSX.Element {
  return <Glyph className="cat-glyph">{CATEGORY_GLYPHS[id]}</Glyph>;
}

function BuildingGlyph({ id }: { id: BuildingId }): React.JSX.Element {
  return <Glyph className="tile-glyph">{BUILDING_GLYPHS[id]}</Glyph>;
}

function UnitGlyph({ id }: { id: UnitId }): React.JSX.Element {
  return <Glyph className="tile-glyph">{UNIT_GLYPHS[id]}</Glyph>;
}

function RepeatIcon(): React.JSX.Element {
  return <Glyph className="repeat-glyph">{REPEAT_GLYPH}</Glyph>;
}

/** The sword of the war section, at the size of a resource icon. */
function ArmyIcon({ className }: { className?: string }): React.JSX.Element {
  return (
    <svg className={className ?? "tip-icon"} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={SWORD_PATH} fill={RESOURCE_COLOURS.stone} fillRule="evenodd" />
    </svg>
  );
}

export type { ResourceIconKind };
export { ArmyIcon, BuildingGlyph, CategoryGlyph, RepeatIcon, ResourceIcon, UnitGlyph };
