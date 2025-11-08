import { canvas, div, input } from "@hw/html-lib";
import { signal } from "@hw/signals";
import classes from "./breadth-first-search.module.css";

const MAP_WIDTH = 40;
const MAP_HEIGHT = 20;
const PIXEL_SIZE = 30;

const POINT_TYPE = {
  NOT_REACHED: "NOT_REACHED",
  REACHED: "REACHED",
  BOUNDARY: "BOUNDARY",
  FRONTIER: "FRONTIER",
  INIT: "INIT",
  TARGET: "TARGET",
  PATH: "PATH",
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
  },
  STROKE: {
    [POINT_TYPE.NOT_REACHED]: "#ffffff",
    [POINT_TYPE.REACHED]: "#ffffff",
    [POINT_TYPE.BOUNDARY]: "#ffffff",
    [POINT_TYPE.FRONTIER]: "#0082FFFF",
    [POINT_TYPE.INIT]: "#ffffff",
    [POINT_TYPE.TARGET]: "#ffffff",
    [POINT_TYPE.PATH]: "#ffffff",
  }
}

class SetWithLocalStorage {
  #set;
  #key;

  constructor(key) {
    this.#key = key;
    this.#set = new Set(JSON.parse(localStorage.getItem(`breadthFirstSearch/${this.#key}`)));
  }

  has(examined) {
    return this.#set.has(examined);
  }

  values() {
    return this.#set.values();
  }

  add(examined) {
    this.#set.add(examined);
    localStorage.setItem(`breadthFirstSearch/${this.#key}`, JSON.stringify([...this.#set]));
  }

  delete(examined) {
    this.#set.delete(examined);
    localStorage.setItem(`breadthFirstSearch/${this.#key}`, JSON.stringify([...this.#set]));
  }
}

const drawPixel = (ctx, x, y, stroke, fill) => {
  ctx.strokeStyle = stroke;
  ctx.fillStyle = fill;
  ctx.strokeRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
  ctx.fillRect(x * PIXEL_SIZE, y * PIXEL_SIZE, PIXEL_SIZE, PIXEL_SIZE);
};

const drawGrid = (ctx, initPoint, boundary, reached, frontier, target, cameFrom, path) => {
  ctx.reset();

  for (let x = 0; x < MAP_WIDTH; x++) {
    for (let y = 0; y < MAP_HEIGHT; y++) {
      const point = x + "-" + y;

      let pointType = POINT_TYPE.NOT_REACHED;
      if (reached.has(point)) {
        pointType = POINT_TYPE.REACHED;
      }
      if (boundary.has(point)) {
        pointType = POINT_TYPE.BOUNDARY;
      }
      if (frontier.has(point)) {
        pointType = POINT_TYPE.FRONTIER;
      }

      drawPixel(ctx, x, y, COLORS.STROKE[pointType], COLORS.FILL[pointType]);
    }
  }

  for (const point of [...frontier]) {
    const [x, y] = point.split("-");

    drawPixel(ctx, Number(x), Number(y), COLORS.STROKE[POINT_TYPE.FRONTIER], COLORS.FILL[POINT_TYPE.FRONTIER]);
  }

  drawPixel(ctx, initPoint[0], initPoint[1], COLORS.STROKE[POINT_TYPE.INIT], COLORS.FILL[POINT_TYPE.INIT]);
  drawPixel(ctx, target[0], target[1], COLORS.STROKE[POINT_TYPE.TARGET], COLORS.FILL[POINT_TYPE.TARGET]);

  for (const point of path) {
    const [x, y] = point.split("-");

    drawPixel(ctx, Number(x), Number(y), COLORS.STROKE[POINT_TYPE.PATH], COLORS.FILL[POINT_TYPE.PATH]);
  }
}

const map = (iteration) => {
  const boundary = new SetWithLocalStorage("boundary");
  let reached = new Set();
  let frontier = new Set();
  let cameFrom = {};
  let path = [];
  let isMouseDown = false;
  let operation = "unknown";
  const initPoint = [3, 3];
  const target = [17, 17];

  const expandFrontier = (examinedX, examinedY) => {
    const point = examinedX + "-" + examinedY;

    const maybeFrontier = [
      [Math.min(MAP_WIDTH, examinedX + 1), examinedY],
      [Math.max(0, examinedX - 1), examinedY],
      [examinedX, Math.min(MAP_HEIGHT, examinedY + 1)],
      [examinedX, Math.max(0, examinedY - 1)],
    ];

    for (const [x, y] of maybeFrontier) {
      const newFrontierPoint = x + "-" + y;

      if (boundary.has(newFrontierPoint)) {
        continue;
      }

      if (reached.has(newFrontierPoint)) {
        continue;
      }

      cameFrom[newFrontierPoint] = point;
      frontier.add(newFrontierPoint);

      if (target[0] === x && target[1] === y) {
        return true;
      }
    }

    frontier.delete(point);
    reached.add(point);

    return false;
  }

  const constructPath = () => {
    let current = target[0] + "-" + target[1];
    const start = initPoint[0] + "-" + initPoint[1];
    while (current !== start) {
      path.push(current);
      current = cameFrom[current];
    }
  };

  function* frontierLoop() {
    cameFrom = {};
    path = [];
    reached = new Set();
    frontier = new Set();

    frontier.add(initPoint[0] + "-" + initPoint[1]);

    const iterator = frontier.values();

    let next = iterator.next();

    while (next.done === false) {
      if (path.length > 0) {
        break;
      }

      const temp = [...frontier.values()];

      for (const point of temp) {
        const [x, y] = point.split("-");
        const foundTarget = expandFrontier(Number(x), Number(y));
        if (foundTarget) {
          constructPath();
          break;
        }
      }

      next = iterator.next();

      yield;
    }
  }

  const c = canvas({
    width: MAP_WIDTH * PIXEL_SIZE,
    height: MAP_HEIGHT * PIXEL_SIZE,
    onMouseDown: (e) => {
      isMouseDown = true;

      const selectedX = Math.trunc(e.clientX / PIXEL_SIZE);
      const selectedY = Math.trunc(e.clientY / PIXEL_SIZE);

      if (initPoint[0] === selectedX && initPoint[1] === selectedY) {
        operation = "initpoint";
        return;
      }

      const point = selectedX + "-" + selectedY;

      if (boundary.has(point)) {
        boundary.delete(point);
        operation = "remove";
      } else {
        boundary.add(point);
        operation = "add";
      }

      drawGrid(ctx, initPoint, boundary, reached, frontier, target, cameFrom, path);
    },
    onMouseUp: (e) => {
      isMouseDown = false;
    },
    onMouseMove: (e) => {
      const selectedX = Math.trunc(e.clientX / PIXEL_SIZE);
      const selectedY = Math.trunc(e.clientY / PIXEL_SIZE);

      if (initPoint[0] === selectedX && initPoint[1] === selectedY) {
        c.htmlElement.style.cursor = "pointer";
      } else {
        c.htmlElement.style.cursor = "default";
      }

      if (!isMouseDown) {
        return;
      }

      const point = selectedX + "-" + selectedY;

      if (operation === "initpoint") {
        initPoint[0] = selectedX;
        initPoint[1] = selectedY;

        drawGrid(ctx, initPoint, boundary, reached, frontier, target, cameFrom, path);
        return;
      }

      if (operation === "remove") {
        boundary.delete(point);
      } else {
        boundary.add(point);
      }

      drawGrid(ctx, initPoint, boundary, reached, frontier, target, cameFrom, path);
    },
  });

  const ctx = c.htmlElement.getContext("2d");

  drawGrid(ctx, initPoint, boundary, reached, frontier, target, cameFrom, path);

  c.assocEffect(() => {
    const currentIteration = iteration.value;
    const frontierIterator = frontierLoop();

    for (let i = 0; i < currentIteration; i++) {
      frontierIterator.next();
    }

    drawGrid(ctx, initPoint, boundary, reached, frontier, target, cameFrom, path);
  })

  return c;
}

const slider = (iteration) => {
  const slider = input({
    className: classes.slider,
    type: "range",
    step: 1,
    min: 0,
    max: 300,
    value: iteration.peek(),
    onInput: (e) => {
      iteration.value = e.target.valueAsNumber;
      console.log(iteration.peek());
    }
  });

  slider.assocEffect(() => {
    const currentIteration = iteration.value;
    slider.props({ value: currentIteration });
  });

  return slider;
}

const breadthFirstSearch = () => {
  const iteration = signal(0);

  const container = div().children([
    map(iteration),
    div().child(slider(iteration)),
  ]);

  return container;
};

export { breadthFirstSearch };