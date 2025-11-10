import { drawPixel, pointXY, xy } from "./pixel.js";

const POINT_TYPE = {
  NOT_REACHED: "NOT_REACHED",
  REACHED: "REACHED",
  BOUNDARY: "BOUNDARY",
  FRONTIER: "FRONTIER",
  INIT: "INIT",
  TARGET: "TARGET",
  PATH: "PATH",
  PATH_INIT: "PATH_INIT",
  PATH_TARGET: "PATH_TARGET",
}

const COLORS = {
  FILL: {
    [POINT_TYPE.NOT_REACHED]: "#ddd5d5",
    [POINT_TYPE.REACHED]: "#d6b28d",
    [POINT_TYPE.BOUNDARY]: "#8c745e",
    [POINT_TYPE.FRONTIER]: "#ddd5d5",
    [POINT_TYPE.INIT]: "#ff0000",
    [POINT_TYPE.TARGET]: "#20fa24",
    [POINT_TYPE.PATH]: "#ce05e8",
    [POINT_TYPE.PATH_INIT]: "#ff0000",
    [POINT_TYPE.PATH_TARGET]: "#20fa24",
  },
  STROKE: {
    [POINT_TYPE.NOT_REACHED]: "#ffffff",
    [POINT_TYPE.REACHED]: "#ffffff",
    [POINT_TYPE.BOUNDARY]: "#ffffff",
    [POINT_TYPE.FRONTIER]: "#0082FFFF",
    [POINT_TYPE.INIT]: "#ffffff",
    [POINT_TYPE.TARGET]: "#ffffff",
    [POINT_TYPE.PATH]: "#ffffff",
    [POINT_TYPE.PATH_INIT]: "#ce05e8",
    [POINT_TYPE.PATH_TARGET]: "#ce05e8",
  }
}

const renderGrid = (ctx, grid, path) => {
  const {
    initPoint,
    targetPoint,
    boundary,
    reached,
    frontier,
  } = grid;

  ctx.reset();

  for (let x = 0; x < grid.width; x++) {
    for (let y = 0; y < grid.height; y++) {
      const renderedPoint = pointXY(x, y);

      let pointType = POINT_TYPE.NOT_REACHED;
      if (reached.has(renderedPoint)) {
        pointType = POINT_TYPE.REACHED;
      }
      if (boundary.has(renderedPoint)) {
        pointType = POINT_TYPE.BOUNDARY;
      }
      if (frontier.has(renderedPoint)) {
        pointType = POINT_TYPE.FRONTIER;
      }

      drawPixel(ctx, x, y, COLORS.STROKE[pointType], COLORS.FILL[pointType]);
    }
  }

  for (const point of [...frontier]) {
    const [x, y] = xy(point);

    drawPixel(ctx, Number(x), Number(y), COLORS.STROKE[POINT_TYPE.FRONTIER], COLORS.FILL[POINT_TYPE.FRONTIER]);
  }

  let initPointDrawn = false;
  let targetPointDrawn = false;

  for (const point of path) {
    const [x, y] = xy(point);

    drawPixel(ctx, Number(x), Number(y), COLORS.STROKE[POINT_TYPE.PATH], COLORS.FILL[POINT_TYPE.PATH]);

    if (initPoint[0] === x && initPoint[1] === y) {
      drawPixel(ctx, initPoint[0], initPoint[1], COLORS.STROKE[POINT_TYPE.PATH_INIT], COLORS.FILL[POINT_TYPE.PATH_INIT]);
      initPointDrawn = true;
    }
    if (targetPoint[1] === x && targetPoint[2] === y) {
      drawPixel(ctx, targetPoint[0], targetPoint[1], COLORS.STROKE[POINT_TYPE.PATH_TARGET], COLORS.FILL[POINT_TYPE.PATH_TARGET]);
      targetPointDrawn = true;
    }
  }

  if (initPointDrawn === false) {
    drawPixel(ctx, initPoint[0], initPoint[1], COLORS.STROKE[POINT_TYPE.INIT], COLORS.FILL[POINT_TYPE.INIT]);
  }
  if (targetPointDrawn === false) {
    drawPixel(ctx, targetPoint[0], targetPoint[1], COLORS.STROKE[POINT_TYPE.TARGET], COLORS.FILL[POINT_TYPE.TARGET]);
  }
}

export { renderGrid };
