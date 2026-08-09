/**
 * One icon vocabulary for the island economy, drawn two ways.
 *
 * Every icon is a path on a 24×24 grid. The canvas cards feed it to `Path2D`,
 * the DOM rows feed the same string to an `<svg>`, so a tech-tree card and a
 * field label can never drift apart. The silhouettes are picked to stay apart
 * at a few pixels: a tree, a boulder, a ring and an hourglass.
 */

type IconKind = "wood" | "stone" | "gold" | "food" | "time";

type IconSpec = {
  /** Path on a 24×24 grid, filled with the even-odd rule. */
  path: string;
  colour: string;
};

const ICONS: Record<IconKind, IconSpec> = {
  wood: {
    path: "M12 2 L17.5 10.5 H14.6 L19.5 17.4 H4.5 L9.4 10.5 H6.5 Z M10.6 17.4 H13.4 V22 H10.6 Z",
    colour: "#8ed07f",
  },
  stone: {
    path: "M4.5 14.6 L7.6 6.4 L13.6 3.4 L20 9.6 L18 19.6 L8 20.6 Z",
    colour: "#a9bccb",
  },
  gold: {
    path:
      "M2.6 12 A9.4 9.4 0 1 0 21.4 12 A9.4 9.4 0 1 0 2.6 12 Z" +
      " M7.4 12 A4.6 4.6 0 1 0 16.6 12 A4.6 4.6 0 1 0 7.4 12 Z",
    colour: "#ffd479",
  },
  food: {
    path:
      "M12 7.2 C14.6 4.4 20.4 5.4 20.4 11.4 C20.4 17 16.6 21.8 12 21.8" +
      " C7.4 21.8 3.6 17 3.6 11.4 C3.6 5.4 9.4 4.4 12 7.2 Z" +
      " M12.7 6.6 C13.4 3.6 15.8 2.2 18.4 2.2 C18.4 5 16.2 6.9 12.7 6.6 Z",
    colour: "#f0907f",
  },
  time: {
    path: "M5.6 2.4 H18.4 V4.6 L13.2 12 L18.4 19.4 V21.6 H5.6 V19.4 L10.8 12 L5.6 4.6 Z",
    colour: "#7fc0ff",
  },
};

/** Schema fields that carry one of these resources, on any page. */
const FIELD_ICONS: Record<string, IconKind> = {
  costWood: "wood",
  costStone: "stone",
  costGold: "gold",
  costFood: "food",
  rewardGold: "gold",
  rewardFood: "food",
  buildTimeSec: "time",
  trainTimeSec: "time",
};

const CACHE = new Map<IconKind, Path2D>();

function pathOf(kind: IconKind): Path2D {
  let cached = CACHE.get(kind);
  if (!cached) {
    cached = new Path2D(ICONS[kind].path);
    CACHE.set(kind, cached);
  }
  return cached;
}

function iconOfField(name: string): IconKind | null {
  return FIELD_ICONS[name] ?? null;
}

/**
 * Draws one icon with its top-left corner at `x, y`, `size` units wide. The
 * path is vector, so it stays sharp at any zoom and on any pixel ratio.
 */
function drawIcon(ctx: CanvasRenderingContext2D, kind: IconKind, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / 24, size / 24);
  ctx.fillStyle = ICONS[kind].colour;
  ctx.fill(pathOf(kind), "evenodd");
  ctx.restore();
}

type ResourceIconProps = {
  kind: IconKind;
  size?: number;
};

/** The same icon in the DOM, for field labels outside the canvas. */
function ResourceIcon({ kind, size = 14 }: ResourceIconProps): React.JSX.Element {
  return (
    <svg className="field-icon" width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" focusable="false">
      <path d={ICONS[kind].path} fill={ICONS[kind].colour} fillRule="evenodd" />
    </svg>
  );
}

export type { IconKind };
export { ResourceIcon, drawIcon, iconOfField };
