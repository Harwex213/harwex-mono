import { canvas } from "@hw/html-lib";
import { draw_circle2_generator } from "./variant-2.js";

const circleAlgorithm = () => {
  const c = canvas({ width: 930, height: 930 });

  const ctx = c.htmlElement.getContext("2d");

  // draw_circle(ctx, 15, 15, +"15", "green");
  // draw_circle(ctx, 15, 15, +"14", "green");
  // draw_circle(ctx, 15, 15, +"13", "green");
  // draw_circle(ctx, 15, 15, +"12", "green");
  // draw_circle(ctx, 15, 15, +"11", "green");
  // draw_circle(ctx, 15, 15, +"10", "green");
  // draw_circle(ctx, 15, 15, +"09", "green");
  // draw_circle(ctx, 15, 15, +"08", "green");
  // draw_circle(ctx, 15, 15, +"07", "green");
  // draw_circle(ctx, 15, 15, +"06", "green");
  // draw_circle(ctx, 15, 15, +"05", "green");
  // draw_circle(ctx, 15, 15, +"04", "green");
  // draw_circle(ctx, 15, 15, +"03", "green");
  // draw_circle(ctx, 15, 15, +"02", "green");
  // draw_circle(ctx, 15, 15, +"01", "green");

  // draw_circle2(ctx, 15, 15, 0, 15, "green");

  const interator = draw_circle2_generator(ctx, 15, 15, 10, 15, "green");

  document.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      interator.next();
    }
  });

  return c;
};

export { circleAlgorithm };