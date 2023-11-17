import { compilePath, div, switcher } from "@hw/html-lib";
import { clsx } from "@hw/utils";
import classes from "./app.module.css";
import { renderMap } from "./map/map.js";
import { mapEditorUi } from "./map-editor/map-editor.js";

const PATHS = {
    MAP: "/map",
    MAP_EDITOR: "/map-editor",
};

const ROUTES = {
    MAP: compilePath(PATHS.MAP),
    MAP_EDITOR: compilePath(PATHS.MAP_EDITOR),
};

const renderUI = (htmlElement) => {
    const container = div({ className: clsx(classes.colors, classes.variables, classes.container) });

    const finalizer = switcher()
        .match(ROUTES.MAP_EDITOR, () => container.child(mapEditorUi()))
        .match(ROUTES.MAP, () => container.child(renderMap()))
        .defaultPath(PATHS.MAP)
        .listen();

    container.addFinalizer(finalizer);

    htmlElement.appendChild(container.htmlElement);
};

export { renderUI };
