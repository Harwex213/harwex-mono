import { FC, memo } from "react";
import { CanvasStage } from "@/ui/canvas-stage";
import classes from "./app.module.css";

const App: FC = memo(() => {
    return (
        <div className={classes.container}>
            <CanvasStage />
        </div>
    );
});

export { App };
