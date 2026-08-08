import { InfoPanel } from "./ui/InfoPanel";
import { MapCanvas } from "./ui/MapCanvas";

function App(): React.JSX.Element {
  return (
    <div className="app">
      <MapCanvas />
      <div className="overlay">
        <InfoPanel />
      </div>
    </div>
  );
}

export { App };
