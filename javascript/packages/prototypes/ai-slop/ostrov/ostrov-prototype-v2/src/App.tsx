import { BuildDock } from "./ui/BuildDock";
import { CloudCanvas } from "./ui/CloudCanvas";
import { MapCanvas } from "./ui/MapCanvas";
import { Minimap } from "./ui/Minimap";

function App(): React.JSX.Element {
  return (
    <div className="app">
      <CloudCanvas />
      <MapCanvas />
      <div className="overlay">
        <Minimap />
        <BuildDock />
      </div>
    </div>
  );
}

export { App };
