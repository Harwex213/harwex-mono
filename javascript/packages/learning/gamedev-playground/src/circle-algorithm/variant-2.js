import { drawLineX, drawLineY } from "./utils.js";

const draw_circle2 = (ctx, xc, yc, inner, outer, color) => {
  let xo = outer;
  let xi = inner;
  let y = 0;
  let erro = 1 - xo;
  let erri = 1 - xi;

  ctx.fillStyle = color;

  while (xo >= y) {
    drawLineX(ctx, xc + xi, xc + xo, yc + y);
    drawLineY(ctx, xc + y, yc + xi, yc + xo);
    drawLineX(ctx, xc - xo, xc - xi, yc + y);
    drawLineY(ctx, xc - y, yc + xi, yc + xo);
    drawLineX(ctx, xc - xo, xc - xi, yc - y);
    drawLineY(ctx, xc - y, yc - xo, yc - xi);
    drawLineX(ctx, xc + xi, xc + xo, yc - y);
    drawLineY(ctx, xc + y, yc - xo, yc - xi);

    y++;

    if (erro < 0) {
      erro += 2 * y + 1;
    } else {
      xo--;
      erro += 2 * (y - xo + 1);
    }

    if (y > inner) {
      xi = y;
    } else {
      if (erri < 0) {
        erri += 2 * y + 1;
      } else {
        xi--;
        erri += 2 * (y - xi + 1);
      }
    }
  }
}

function* draw_circle2_generator(ctx, xc, yc, inner, outer, color) {
  let xo = outer;
  let xi = inner;
  let y = 0;
  let erro = 1 - xo;
  let erri = 1 - xi;

  ctx.fillStyle = color;

  console.log("xc", xc, "yc", yc, "inner", inner, "outer", outer);

  while (xo >= y) {
    console.log("xi", xi, "xo", xo, "y", y, "erro", erro, "erri", erri);

    drawLineX(ctx, xc + xi, xc + xo, yc + y);
    drawLineX(ctx, xc - xo, xc - xi, yc + y);
    drawLineX(ctx, xc - xo, xc - xi, yc - y);
    drawLineX(ctx, xc + xi, xc + xo, yc - y);

    drawLineY(ctx, xc + y, yc + xi, yc + xo);
    drawLineY(ctx, xc + y, yc - xo, yc - xi);
    drawLineY(ctx, xc - y, yc + xi, yc + xo);
    drawLineY(ctx, xc - y, yc - xo, yc - xi);

    y++;

    if (erro < 0) {
      erro += 2 * y + 1;
    } else {
      xo--;
      erro += 2 * (y - xo + 1);
    }

    if (y > inner) {
      xi = y;
    } else {
      if (erri < 0) {
        erri += 2 * y + 1;
      } else {
        xi--;
        erri += 2 * (y - xi + 1);
      }
    }

    yield;
  }
}

export { draw_circle2, draw_circle2_generator };
