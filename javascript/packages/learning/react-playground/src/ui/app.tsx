import { FC, memo } from "react";
import { Switch, Route, BrowserRouter } from "react-router-dom";
import classes from "./app.module.css";
import { router } from "./router-di";
import "./wireframe/wireframe";

const App: FC = memo(() => {

    return (
        <BrowserRouter>
            <div className={`${classes.variables} ${classes.container}`}>
                <Switch>
                    {Object.entries(router.routes).map(([path, component]) => (
                        <Route key={path} path={path} component={component} />
                    ))}
                </Switch>
            </div>
        </BrowserRouter>
    )
});

export { App };