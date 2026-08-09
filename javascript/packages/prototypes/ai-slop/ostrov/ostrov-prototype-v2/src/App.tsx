import { BuildDock } from "./ui/BuildDock";
import { CloudCanvas } from "./ui/CloudCanvas";
import { MapCanvas } from "./ui/MapCanvas";
import { Minimap } from "./ui/Minimap";
import { ResourceBar } from "./ui/ResourceBar";

function App(): React.JSX.Element {
  return (
    <div className="app">
      <CloudCanvas />
      <MapCanvas />
      {/* The overlay is `pointer-events: none` and each control turns them back
          on for itself, so nothing here ever lets a click through to the map.
          The treasury sits along the top, clear of the minimap and the dock. */}
      <div className="overlay">
        <ResourceBar />
        <Minimap />
        <BuildDock />
      </div>
    </div>
  );
}

export { App };
