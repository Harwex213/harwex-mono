import { div, switcher } from "@hw/html-lib";
import { PATHS, routes } from "./routes.js";
import "./global.css";
import classes from "./app.module.css";
import { clsx } from "@hw/utils";

const renderUI = (htmlElement) => {
    const container = div({ className: clsx(classes.colors, classes.variables) });

    switcher(container).match(routes.home).defaultPath(PATHS.HOME);

    htmlElement.appendChild(container.htmlElement);
};

export { renderUI };
