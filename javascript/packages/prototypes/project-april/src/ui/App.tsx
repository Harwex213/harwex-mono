import { FC, memo } from "react";
import { dispatch } from "@/store/store.ts";
import { setMapResolutionAction } from "@/store/map/map-actions.ts";
import { mapHeightSignal, mapWidthSignal } from "@/store/map/map-selectors.ts";

const MapResolutionChanger: FC = memo(() => {
    const onClick = () => {
        dispatch(setMapResolutionAction(Math.ceil(Math.random() * 100), Math.ceil(Math.random() * 100)));
    };

    console.log("MapResolutionChanger: rerender");

    return <button onClick={onClick}>{"Click me"}</button>;
});

const MapResolution = memo(() => {
    console.log("MapResolution: rerender");

    return (
        <div>
            <div>
                <>{mapWidthSignal}</>
            </div>
            <div>
                <>{mapHeightSignal}</>
            </div>
        </div>
    );
});

const App: FC = memo(() => {
    console.log("App: rerender");

    return (
        <div>
            <h1>Project April</h1>
            <p>Welcome to your new React application!</p>

            <MapResolution />

            <MapResolutionChanger />
        </div>
    );
});

export { App };
