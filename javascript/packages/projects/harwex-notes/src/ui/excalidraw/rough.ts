type TRandom = () => number;

type TPoint = readonly [number, number];

const createRandom = (seed: number): TRandom => {
  let state = seed >>> 0;

  return () => {
    state = (state + 0x6D2B79F5) >>> 0;

    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);

    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

const hashSeed = (source: string): number => {
  let hash = 2166136261;

  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const round = (value: number): string => value.toFixed(1);

const jitter = (random: TRandom, amount: number): number => (random() - 0.5) * 2 * amount;

const roughLine = (
  from: TPoint,
  to: TPoint,
  random: TRandom,
  amount = 1.5
): string => {
  const [x1, y1] = from;
  const [x2, y2] = to;
  const startX = x1 + jitter(random, amount);
  const startY = y1 + jitter(random, amount);
  const endX = x2 + jitter(random, amount);
  const endY = y2 + jitter(random, amount);
  const controlX = (x1 + x2) / 2 + jitter(random, amount * 2.4);
  const controlY = (y1 + y2) / 2 + jitter(random, amount * 2.4);

  return `M ${round(startX)} ${round(startY)} Q ${round(controlX)} ${round(controlY)} ${round(endX)} ${round(endY)}`;
};

const roughRectPath = (
  x: number,
  y: number,
  width: number,
  height: number,
  random: TRandom
): string => {
  const corners: readonly TPoint[] = [
    [x, y],
    [x + width, y],
    [x + width, y + height],
    [x, y + height],
  ];

  const segments: string[] = [];

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < corners.length; index += 1) {
      const from = corners[index];
      const to = corners[(index + 1) % corners.length];
      if (from === undefined || to === undefined) {
        continue;
      }

      segments.push(roughLine(from, to, random));
    }
  }

  return segments.join(" ");
};

const midpoint = (from: TPoint, to: TPoint): TPoint => [
  (from[0] + to[0]) / 2,
  (from[1] + to[1]) / 2,
];

const smoothClosedPath = (points: readonly TPoint[]): string => {
  const first = points[0];
  const last = points[points.length - 1];
  if (first === undefined || last === undefined) {
    return "";
  }

  const start = midpoint(last, first);
  const segments: string[] = [`M ${round(start[0])} ${round(start[1])}`];

  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    if (current === undefined || next === undefined) {
      continue;
    }

    const end = midpoint(current, next);
    segments.push(
      `Q ${round(current[0])} ${round(current[1])} ${round(end[0])} ${round(end[1])}`
    );
  }

  return `${segments.join(" ")} Z`;
};

const ELLIPSE_SAMPLES = 14;

const roughEllipsePath = (
  x: number,
  y: number,
  width: number,
  height: number,
  random: TRandom
): string => {
  const centerX = x + width / 2;
  const centerY = y + height / 2;
  const radiusX = width / 2;
  const radiusY = height / 2;
  const passes: string[] = [];

  for (let pass = 0; pass < 2; pass += 1) {
    const points: TPoint[] = [];

    for (let index = 0; index < ELLIPSE_SAMPLES; index += 1) {
      const angle = (index / ELLIPSE_SAMPLES) * Math.PI * 2 + jitter(random, 0.06);

      points.push([
        centerX + Math.cos(angle) * (radiusX + jitter(random, 2.2)),
        centerY + Math.sin(angle) * (radiusY + jitter(random, 2.2)),
      ]);
    }

    passes.push(smoothClosedPath(points));
  }

  return passes.join(" ");
};

const ARROW_HEAD_LENGTH = 14;
const ARROW_HEAD_ANGLE = 0.42;

const roughArrowPath = (points: readonly TPoint[], random: TRandom): string => {
  const segments: string[] = [];

  for (let pass = 0; pass < 2; pass += 1) {
    for (let index = 0; index < points.length - 1; index += 1) {
      const from = points[index];
      const to = points[index + 1];
      if (from === undefined || to === undefined) {
        continue;
      }

      segments.push(roughLine(from, to, random, 1.2));
    }
  }

  const tip = points[points.length - 1];
  const previous = points[points.length - 2];
  if (tip === undefined || previous === undefined) {
    return segments.join(" ");
  }

  const angle = Math.atan2(tip[1] - previous[1], tip[0] - previous[0]);

  for (const side of [-1, 1]) {
    const headAngle = angle + Math.PI + side * ARROW_HEAD_ANGLE;
    const head: TPoint = [
      tip[0] + Math.cos(headAngle) * ARROW_HEAD_LENGTH,
      tip[1] + Math.sin(headAngle) * ARROW_HEAD_LENGTH,
    ];

    segments.push(roughLine(tip, head, random, 0.9));
  }

  return segments.join(" ");
};

export type { TPoint, TRandom };
export { createRandom, hashSeed, roughArrowPath, roughEllipsePath, roughRectPath };
