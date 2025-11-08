import { compilePath, div, switcher } from "@hw/html-lib";
import { tickWithFps } from "./src/tick-with-fps/tick-with-fps.js";
import { circleAlgorithm } from "./src/circle-algorithm/circle-algorithm.js";
import { pathfinding } from "./src/pathfinding/pathfinding.js";
import { breadthFirstSearch } from "./src/breadth-first-search/breadth-first-search.js";

const ROUTES = {
  tickWithFPS: { route: compilePath("/tick-with-fps"), render: tickWithFps },
  circleAlgorithm: { route: compilePath("/circle-algorithm"), render: circleAlgorithm },
  pathfinding: { route: compilePath("/pathfinding"), render: pathfinding },
  breadthFirstSearch: { route: compilePath("/breadth-first-search"), render: breadthFirstSearch },
};

const root = document.getElementById("root");

const container = div();

const switcherWithRoutes = switcher();

for (const { route, render } of Object.values(ROUTES)) {
  switcherWithRoutes.match(route, () => container.child(render()));
}

container.addFinalizer(switcherWithRoutes.listen());

root.appendChild(container.htmlElement);
