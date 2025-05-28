import { div } from "@hw/html-lib";
import classes from "./divider.module.css";

const divider = () => {
    return div({ className: classes.dividerContainer }).child(div({ className: classes.divider }));
};

export { divider };
