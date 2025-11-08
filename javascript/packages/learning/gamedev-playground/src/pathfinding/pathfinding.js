import { canvas } from "@hw/html-lib";

const pathfinding = () => {
  const c = canvas({ width: 930, height: 930 });

  const ctx = c.htmlElement.getContext("2d");

  return c;
}

export { pathfinding };