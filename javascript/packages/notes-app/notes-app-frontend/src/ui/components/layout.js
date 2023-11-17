import { div, h1 } from "@hw/html-lib";
import { divider } from "./divider/divider.js";
import classes from "./leftbar.module.css";

const leftBar = () => {
    const leftBar = div({ className: classes.leftBar }).children(
        h1({ className: classes.title }).content("Topics"),
        divider(),
    );

    return leftBar;
};

const layout = () => {
    const container = div({ className: classes.layout }).children(leftBar(), div().children());
};

export { layout };
