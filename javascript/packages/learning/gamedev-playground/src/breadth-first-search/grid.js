import { SetWithLocalStorage } from "./set-with-local-storage.js";
import { point, pointXY, xy } from "./pixel.js";

class Grid {
  width;
  height;

  boundary;
  reached;
  frontier;
  cameFrom;

  initPoint;
  targetPoint;

  containerElement;
  isMouseDown;
  mouseOperation;

  onChange;

  constructor({
    width,
    height,
    initPoint,
    targetPoint,
    containerElement,
  }) {
    this.width = width;
    this.height = height;

    this.boundary = new SetWithLocalStorage("boundary");
    this.cameFrom = {};
    this.reached = new Set();
    this.frontier = new Set();

    this.initPoint = initPoint;
    this.targetPoint = targetPoint;

    this.containerElement = undefined;
    this.isMouseDown = false;
    this.mouseOperation = "unset";

    this.onChange = undefined;
  }

  /**
   * Call this method to register `onChange` function which will be fired when
   * `Grid` instance is changed, thus it is necessary to rerender
   */
  registerOnChange(onChange) {
    this.onChange = onChange;
  }

  bindContainerElement(containerElement) {
    this.containerElement = containerElement;
  }

  #constructPath() {
    const path = [];
    const {
      initPoint,
      targetPoint,
      cameFrom,
    } = this;

    let current = point(targetPoint);
    const start = point(initPoint);
    while (current !== start) {
      path.push(current);
      current = cameFrom[current];
    }
    path.push(current);

    return path;
  }

  #expandFrontier(point) {
    const {
      width,
      height,
      boundary,
      reached,
      cameFrom,
      frontier,
      targetPoint,
    } = this;
    const [examinedX, examinedY] = xy(point);

    const maybeFrontier = [
      [Math.min(width, examinedX + 1), examinedY],
      [Math.max(0, examinedX - 1), examinedY],
      [examinedX, Math.min(height, examinedY + 1)],
      [examinedX, Math.max(0, examinedY - 1)],
    ];

    for (const [x, y] of maybeFrontier) {
      const newFrontierPoint = pointXY(x, y);

      if (boundary.has(newFrontierPoint)) {
        continue;
      }

      if (reached.has(newFrontierPoint)) {
        continue;
      }

      cameFrom[newFrontierPoint] = point;
      frontier.add(newFrontierPoint);

      if (targetPoint[0] === x && targetPoint[1] === y) {
        return true;
      }
    }

    frontier.delete(point);
    reached.add(point);

    return false;
  }

  #setCursorHover() {
    if (this.containerElement) {
      this.containerElement.style.cursor = "pointer";
    }
  }

  #setCursorDefault() {
    if (this.containerElement) {
      this.containerElement.style.cursor = "default";
    }
  }

  isTargetXY(x, y) {
    return this.targetPoint[0] === x && this.targetPoint[1] === y;
  }

  isInitXY(x, y) {
    return this.initPoint[0] === x && this.initPoint[1] === y;
  }

  searchTarget(iterationThreshold) {
    this.cameFrom = {};
    this.reached = new Set();
    this.frontier = new Set();

    const {
      frontier,
      initPoint,
    } = this;

    frontier.add(point(initPoint));

    const frontierIterator = frontier.values();

    let waveIteration = -1;

    while (frontier.size !== 0 && waveIteration < iterationThreshold) {
      const iterations = frontier.size;

      for (let i = 0; i < iterations; i++) {
        const { value: point } = frontierIterator.next();

        const foundTarget = this.#expandFrontier(point);
        if (foundTarget) {
          return this.#constructPath();
        }
      }

      waveIteration++;
    }

    return [];
  }

  onMouseDown(x, y) {
    this.isMouseDown = true;

    const { boundary, initPoint, targetPoint } = this;

    if (initPoint[0] === x && initPoint[1] === y) {
      this.mouseOperation = "change-init-point";

      return;
    }
    if (targetPoint[0] === x && targetPoint[1] === y) {
      this.mouseOperation = "change-target-point";

      return;
    }

    const selectedPoint = pointXY(x, y);

    if (boundary.has(selectedPoint)) {
      boundary.delete(selectedPoint);
      this.mouseOperation = "remove-boundary";
    } else {
      boundary.add(selectedPoint);
      this.mouseOperation = "add-boundary";
    }

    this?.onChange();
  }

  onMouseUp() {
    this.isMouseDown = false;
  }

  onMouseMove(x, y) {
    const { isMouseDown, mouseOperation, boundary, initPoint, targetPoint } = this;

    const isInitPoint = this.isInitXY(x, y);
    const isTargetPoint = this.isTargetXY(x, y);

    if (isInitPoint || isTargetPoint) {
      this.#setCursorHover();
    } else {
      this.#setCursorDefault();
    }

    if (!isMouseDown) {
      return;
    }

    if (mouseOperation === "change-init-point") {
      initPoint[0] = x;
      initPoint[1] = y;

      this?.onChange();

      return;
    }
    if (mouseOperation === "change-target-point") {
      targetPoint[0] = x;
      targetPoint[1] = y;

      this?.onChange();

      return;
    }

    const highlightedPoint = pointXY(x, y);

    if (mouseOperation === "add-boundary") {
      boundary.add(highlightedPoint);
    }
    if (mouseOperation === "remove-boundary") {
      boundary.delete(highlightedPoint);
    }

    this?.onChange();
  }
}

export { Grid };
