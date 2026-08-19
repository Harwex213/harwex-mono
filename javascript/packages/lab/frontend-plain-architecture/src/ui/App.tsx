import { DetailsPanel } from "./DetailsPanel";
import { FiltersPanel } from "./FiltersPanel";
import { LobbyGrid } from "./LobbyGrid";
import { NoticeBar } from "./NoticeBar";
import { TopBar } from "./TopBar";
import "./styles.css";

// Layer 1: ui. `App` reads no signal of its own — every panel below it pulls
// what it needs out of the store it finds in context.

function App() {
  return (
    <div className="lc-app">
      <TopBar />
      <div className="lc-body">
        <FiltersPanel />
        <LobbyGrid />
        <DetailsPanel />
      </div>
      <NoticeBar />
    </div>
  );
}

export { App };
