import { compilePath } from "@hw/html-lib";

const PATHS = {
    HOME: "/home",
    TOPIC: "/topics/:topicId",
    NOTE: "/topics/:topicId/:date",
};

const routes = {
    home: compilePath(PATHS.HOME),
    topic: compilePath(PATHS.TOPIC),
    note: compilePath(PATHS.NOTE),
};

export { PATHS, routes };
