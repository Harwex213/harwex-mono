// Draws a pointy-top regular hexagon (a vertex at top and bottom) centered on
// (x, y). `height` is the full vertical extent (top vertex to bottom vertex);
// the width follows from a regular hexagon (√3/2 · height). `colors` carries the
// paint: { fill, stroke } — either may be omitted to skip that pass.
const renderPointTopHexagon = (ctx, x, y, height, styling = {}) => {
  const r = height / 2; // circumradius: center to the top/bottom vertex
  const halfWidth = (Math.sqrt(3) / 2) * r;

  // clockwise from the top vertex
  const points = [
    [x, y - r],
    [x + halfWidth, y - r / 2],
    [x + halfWidth, y + r / 2],
    [x, y + r],
    [x - halfWidth, y + r / 2],
    [x - halfWidth, y - r / 2],
  ];

  ctx.beginPath();
  ctx.moveTo(points[0][0], points[0][1]);
  for (let i = 1; i < points.length; i += 1) {
    ctx.lineTo(points[i][0], points[i][1]);
  }
  ctx.closePath();

  if (styling.fill) {
    ctx.fillStyle = styling.fill.style;
    ctx.fill();
  }

  if (styling.stroke) {
    ctx.lineWidth = styling.stroke.width;
    ctx.strokeStyle = styling.stroke.style;
    ctx.stroke();
  }
};

export { renderPointTopHexagon };
