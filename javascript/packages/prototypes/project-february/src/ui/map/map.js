import { canvas } from "@hw/html-lib";
import { div } from "@hw/html-lib";

const renderMap = (container) => () => {
    const canvasContainer = canvas();

    const layout = div().children([div()]);

    container.child(canvasContainer);
};

export { renderMap };
