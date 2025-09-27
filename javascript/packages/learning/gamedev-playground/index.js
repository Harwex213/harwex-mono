import { compilePath, div, switcher } from "@hw/html-lib";
import { tickWithFps } from "./src/tick-with-fps/tick-with-fps.js";

const ROUTES = {
  tickWithFPS: { route: compilePath("/tick-with-fps"), render: tickWithFps },
};

const root = document.getElementById("root");

const container = div();

const switcherWithRoutes = switcher();

for (const { route, render } of Object.values(ROUTES)) {
  switcherWithRoutes.match(route, () => container.child(render()));
}

container.addFinalizer(switcherWithRoutes.listen());

root.appendChild(container.htmlElement);
