import { canvas, div, input } from "@hw/html-lib";
import { signal } from "@hw/signals";
import classes from "./breadth-first-search.module.css";
import { Grid } from "./grid.js";
import { PIXEL_SIZE } from "./pixel.js";
import { renderGrid } from "./render-grid.js";

const map = (iteration) => {
  const grid = new Grid({
    width: 40,
    height: 20,
    initPoint: [3, 3],
    targetPoint: [17, 17],
  });

  const c = canvas({
    width: grid.width * PIXEL_SIZE,
    height: grid.height * PIXEL_SIZE,
    onMouseDown: (e) => {
      const selectedX = Math.trunc(e.clientX / PIXEL_SIZE);
      const selectedY = Math.trunc(e.clientY / PIXEL_SIZE);

      grid.onMouseDown(selectedX, selectedY);
    },
    onMouseUp: () => {
      grid.onMouseUp();
    },
    onMouseMove: (e) => {
      const selectedX = Math.trunc(e.clientX / PIXEL_SIZE);
      const selectedY = Math.trunc(e.clientY / PIXEL_SIZE);

      grid.onMouseMove(selectedX, selectedY);
    },
  });

  const ctx = c.htmlElement.getContext("2d");

  const render = (iterationThreshold) => {
    const path = grid.searchTarget(iterationThreshold);
    renderGrid(ctx, grid, path);
  }

  grid.bindContainerElement(c.htmlElement);
  grid.registerOnChange(() => {
    render(iteration.peek());
  });

  c.assocEffect(() => {
    const currentIteration = iteration.value;
    render(currentIteration);
  })

  return c;
}

const slider = (iteration) => {
  const slider = input({
    className: classes.slider,
    type: "range",
    step: 1,
    min: 0,
    max: 150,
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