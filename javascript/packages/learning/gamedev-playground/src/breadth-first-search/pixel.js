const PIXEL_SIZE = 30;

const point = (point) => point[0] + "-" + point[1];
const pointXY = (x, y) => x + "-" + y;
const xy = (point) => point.split("-").map((v) => Number(v));

const drawPixel = (ctx, x, y, stroke, fill) => {
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.strokeRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
  ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
};

export {
  PIXEL_SIZE,
  drawPixel,
  point,
  pointXY,
  xy,
};