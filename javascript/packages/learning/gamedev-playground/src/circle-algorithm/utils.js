const PIXEL_SIZE = 30;

const drawPixel = (ctx, x, y) => {
  ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
}

const drawLineX = (ctx, px1, x2, y) => {
  let x1 = px1;
  while (x1 <= x2) {
    drawPixel(ctx, x1++, y);
  }
}

const drawLineY = (ctx, x, py1, y2) => {
  let y1 = py1;
  while (y1 <= y2) {
    drawPixel(ctx, x, y1++);
  }
}

export {
  drawPixel,
  drawLineX,
  drawLineY,
}