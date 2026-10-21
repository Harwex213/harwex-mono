// Brush tips are kept as horizontal spans instead of a bitmap mask. Painting a
// span is one array fill per row, and the same span list draws the hover preview
// on the overlay, so what the cursor shows is what the layer gets.

type BrushShape = "circle" | "square";

type Span = {
  dy: number;
  x0: number;
  x1: number;
};

type BrushMask = {
  size: number;
  shape: BrushShape;
  spans: Span[];
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

const MIN_SIZE = 1;
const MAX_SIZE = 256;

function clampSize(size: number): number {
  return Math.max(MIN_SIZE, Math.min(MAX_SIZE, Math.round(size)));
}

function buildMask(rawSize: number, shape: BrushShape): BrushMask {
  const size = clampSize(rawSize);
  const start = -Math.floor((size - 1) / 2);
  const end = start + size - 1;
  const spans: Span[] = [];

  if (shape === "square") {
    for (let dy = start; dy <= end; dy += 1) {
      spans.push({ dy, x0: start, x1: end });
    }

    return { size, shape, spans, minX: start, minY: start, maxX: end, maxY: end };
  }

  // The centre sits between pixels on even sizes, hence the half-pixel offsets.
  // The extra quarter pixel on the radius is what turns size 3 into a cross and
  // size 5 into a round tip, matching how a pixel editor draws small circles.
  const centre = (size - 1) / 2;
  const radius = centre + 0.25;
  const radiusSquared = radius * radius;
  let minX = end;
  let maxX = start;

  for (let dy = start; dy <= end; dy += 1) {
    const offsetY = dy - (start + centre);
    const half = Math.sqrt(Math.max(0, radiusSquared - offsetY * offsetY));
    const x0 = Math.ceil(start + centre - half);
    const x1 = Math.floor(start + centre + half);

    if (x1 < x0) {
      continue;
    }

    spans.push({ dy, x0, x1 });
    minX = Math.min(minX, x0);
    maxX = Math.max(maxX, x1);
  }

  return { size, shape, spans, minX, minY: start, maxX, maxY: end };
}

// Pointer samples arrive with gaps — a fast drag skips dozens of pixels — so a
// stroke stamps the tip along the segment between two samples. `visit` gets
// integer centres only, because a fractional centre would land the tip on a
// half pixel and the fill would be antialiased.
function walkLine(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  visit: (x: number, y: number) => void,
): void {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const steps = Math.max(Math.abs(dx), Math.abs(dy));

  if (steps === 0) {
    visit(x0, y0);

    return;
  }

  for (let step = 0; step <= steps; step += 1) {
    const t = step / steps;

    visit(Math.round(x0 + dx * t), Math.round(y0 + dy * t));
  }
}

export {
  MAX_SIZE,
  MIN_SIZE,
  buildMask,
  clampSize,
  walkLine,
  type BrushMask,
  type BrushShape,
  type Span,
};
