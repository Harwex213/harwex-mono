import { ResourcesPanel } from "@/ui/resources-panel";
import { ColonistsPanel } from "@/ui/colonists-panel";
import { InspectorPanel } from "@/ui/inspector-panel";
import { BottomBar } from "@/ui/bottom-bar";
import "@/ui/hud.css";

// DOM HUD overlaid on the pixi canvas: a resources readout in the top-right corner,
// a bar along the bottom edge, and the panels that dock above its two ends. App
// only composes them — each piece reads its own signals (auto-subscribed by
// @preact/signals) and writes back through engine.dispatch, so nothing has to be
// threaded through here.
function App() {
  return (
    <>
      <ResourcesPanel />
      <ColonistsPanel />
      <InspectorPanel />
      <BottomBar />
    </>
  );
}

export { App };
