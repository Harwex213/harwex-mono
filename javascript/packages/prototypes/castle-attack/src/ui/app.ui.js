import { div } from "@hw/html-lib";
import { clsx } from "@hw/utils";
import classes from "./app.module.css";
import { renderMap } from "./map/map.ui.js";

const renderUI = (htmlElement) => {
  const container = div({ className: clsx(classes.colors, classes.variables, classes.container) });

  container.child(renderMap());

  htmlElement.appendChild(container.htmlElement);
};

export { renderUI };
