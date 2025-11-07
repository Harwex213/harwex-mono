import { drawPixel } from "./utils.js";

const draw_circle = (ctx, x_center, y_center, radius, color) => {
  let x = 0;
  let y = radius;
  let delta = 1 - radius;
  let incrX = 1;
  let incrY = -2 * radius;

  ctx.fillStyle = color;

  console.log(x_center, y_center, radius);

  while (y >= x) {
    console.log(x, y, delta, incrX, incrY);

    drawPixel(ctx, x_center + x, y_center + y);
    drawPixel(ctx, x_center + x, y_center - y);
    drawPixel(ctx, x_center - x, y_center + y);
    drawPixel(ctx, x_center - x, y_center - y);
    drawPixel(ctx, x_center + y, y_center + x);
    drawPixel(ctx, x_center + y, y_center - x);
    drawPixel(ctx, x_center - y, y_center + x);
    drawPixel(ctx, x_center - y, y_center - x);

    if (delta >= 0) {
      y--;
      incrY += 2;
      delta += incrY;
    }
    incrX += 2;
    x++;
    delta += incrX;
  }
}

function* draw_circle_generator(ctx, x_center, y_center, radius, color) {
  let x = 0;
  let y = radius;
  let delta = 1 - radius;
  let incrX = 1;
  let incrY = -2 * radius;

  ctx.fillStyle = color;

  console.log(x_center, y_center, radius);

  while (y >= x) {
    console.log(x, y, delta, incrX, incrY);

    drawPixel(ctx, x_center + x, y_center + y);
    drawPixel(ctx, x_center + x, y_center - y);
    drawPixel(ctx, x_center - x, y_center + y);
    drawPixel(ctx, x_center - x, y_center - y);
    drawPixel(ctx, x_center + y, y_center + x);
    drawPixel(ctx, x_center + y, y_center - x);
    drawPixel(ctx, x_center - y, y_center + x);
    drawPixel(ctx, x_center - y, y_center - x);

    if (delta >= 0) {
      y--;
      delta += incrY;
      incrY += 4;
    } else {
      delta += incrX;
      incrY += 2;
    }

    incrX += 2;
    x++;

    yield;
  }
}
