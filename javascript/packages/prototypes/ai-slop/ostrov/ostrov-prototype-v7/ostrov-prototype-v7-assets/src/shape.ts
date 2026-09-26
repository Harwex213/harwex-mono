import { colorOf } from "./palette";
import { areaOf, centerOf, insetRect, pointOf } from "./geometry";
import type { ColorName } from "./palette";
import type { Rect, UnitPoint, UnitRect } from "./geometry";

// A shape is declared against the frame it is painted into, never in absolute
// coordinates. That is what lets one manifest stretch to any bounds. `area`
// picks the slice of the frame the shape sits in, `inset` shrinks that slice by
// a few pixels, a polygon names its corners inside what is left, and `turn`
// spins the result around its own centre.
type ShapeNode = {
  shape: "rect" | "circle" | "ellipse" | "polygon";
  area?: UnitRect;
  inset?: number;
  turn?: number;
  radius?: number;
  points?: readonly UnitPoint[];
  fill?: ColorName;
  stroke?: ColorName;
  strokeWidth?: number;
};

// The only Canvas-aware code in the package. A spritesheet backend replaces this
// file and leaves every manifest untouched.
const traceRect = (ctx: CanvasRenderingContext2D, box: Rect, radius: number): void => {
  const limit = Math.min(radius, box.width / 2, box.height / 2);

  ctx.beginPath();
  ctx.moveTo(box.x + limit, box.y);
  ctx.arcTo(box.x + box.width, box.y, box.x + box.width, box.y + box.height, limit);
  ctx.arcTo(box.x + box.width, box.y + box.height, box.x, box.y + box.height, limit);
  ctx.arcTo(box.x, box.y + box.height, box.x, box.y, limit);
  ctx.arcTo(box.x, box.y, box.x + box.width, box.y, limit);
  ctx.closePath();
};

const traceCircle = (ctx: CanvasRenderingContext2D, box: Rect): void => {
  const center = centerOf(box);
  const radius = Math.min(box.width, box.height) / 2;

  ctx.beginPath();
  ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
};

const traceEllipse = (ctx: CanvasRenderingContext2D, box: Rect): void => {
  const center = centerOf(box);

  ctx.beginPath();
  ctx.ellipse(center.x, center.y, box.width / 2, box.height / 2, 0, 0, Math.PI * 2);
};

const tracePolygon = (
  ctx: CanvasRenderingContext2D,
  box: Rect,
  points: readonly UnitPoint[],
): void => {
  ctx.beginPath();

  let started = false;

  for (const point of points) {
    const spot = pointOf(box, point);

    if (started) {
      ctx.lineTo(spot.x, spot.y);
    } else {
      ctx.moveTo(spot.x, spot.y);
      started = true;
    }
  }

  ctx.closePath();
};

const traceNode = (ctx: CanvasRenderingContext2D, node: ShapeNode, box: Rect): void => {
  if (node.shape === "circle") {
    traceCircle(ctx, box);

    return;
  }

  if (node.shape === "ellipse") {
    traceEllipse(ctx, box);

    return;
  }

  if (node.shape === "polygon") {
    tracePolygon(ctx, box, node.points ?? []);

    return;
  }

  traceRect(ctx, box, node.radius ?? 0);
};

const paintShape = (
  ctx: CanvasRenderingContext2D,
  node: ShapeNode,
  frame: Rect,
): void => {
  const area = node.area ? areaOf(frame, node.area) : frame;
  const box = insetRect(area, node.inset ?? 0);
  const turn = node.turn ?? 0;

  ctx.save();

  if (turn !== 0) {
    const center = centerOf(box);

    ctx.translate(center.x, center.y);
    ctx.rotate(turn * Math.PI * 2);
    ctx.translate(-center.x, -center.y);
  }

  traceNode(ctx, node, box);

  if (node.fill) {
    ctx.fillStyle = colorOf(node.fill);
    ctx.fill();
  }

  if (node.stroke) {
    ctx.lineWidth = node.strokeWidth ?? 1;
    ctx.strokeStyle = colorOf(node.stroke);
    ctx.stroke();
  }

  ctx.restore();
};

const paintShapes = (
  ctx: CanvasRenderingContext2D,
  shapes: readonly ShapeNode[],
  frame: Rect,
): void => {
  ctx.save();
  ctx.lineJoin = "round";
  ctx.lineCap = "round";

  for (const node of shapes) {
    paintShape(ctx, node, frame);
  }

  ctx.restore();
};

export type { ShapeNode };
export { paintShapes };
