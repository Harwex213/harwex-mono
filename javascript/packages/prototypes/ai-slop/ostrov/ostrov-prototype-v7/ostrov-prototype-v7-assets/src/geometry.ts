type Rect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type Size = {
  width: number;
  height: number;
};

// A point inside a frame, named in 0..1 of that frame.
type UnitPoint = {
  x: number;
  y: number;
};

// A slice of a frame, named in 0..1 of that frame. A manifest places its parts
// this way, so one declaration paints at any size.
type UnitRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const insetRect = (frame: Rect, inset: number): Rect => {
  return {
    x: frame.x + inset,
    y: frame.y + inset,
    width: Math.max(frame.width - inset * 2, 0),
    height: Math.max(frame.height - inset * 2, 0),
  };
};

const centerOf = (frame: Rect): { x: number; y: number } => {
  return {
    x: frame.x + frame.width / 2,
    y: frame.y + frame.height / 2,
  };
};

const frameOf = (size: Size, x: number, y: number): Rect => {
  return {
    x,
    y,
    width: size.width,
    height: size.height,
  };
};

const areaOf = (frame: Rect, area: UnitRect): Rect => {
  return {
    x: frame.x + area.x * frame.width,
    y: frame.y + area.y * frame.height,
    width: area.width * frame.width,
    height: area.height * frame.height,
  };
};

const pointOf = (box: Rect, point: UnitPoint): { x: number; y: number } => {
  return {
    x: box.x + point.x * box.width,
    y: box.y + point.y * box.height,
  };
};

// The same slice, named by its centre. A decoration is easier to read that way.
const boxAt = (x: number, y: number, width: number, height: number): UnitRect => {
  return {
    x: x - width / 2,
    y: y - height / 2,
    width,
    height,
  };
};

// The mirror of a point set across the middle of its box. One hammer is drawn,
// the second is this.
const mirrorX = (points: readonly UnitPoint[]): UnitPoint[] => {
  return points.map((point) => {
    return {
      x: 1 - point.x,
      y: point.y,
    };
  });
};

export type { Rect, Size, UnitPoint, UnitRect };
export { areaOf, boxAt, centerOf, frameOf, insetRect, mirrorX, pointOf };
