import { render } from "preact";
import type { Dispatcher } from "@hw/colony-sim-v3-core";
import { App, EngineProvider } from "@hw/colony-sim-v3-hud";
import { DebugPanel } from "./debug-panel";

// The dev app composes the HUD itself instead of calling mountHud: the tree it
// wants is the shared one plus a panel that must exist only here. That is exactly
// what hud exports App and EngineProvider for — the alternative, a dev flag inside
// the hud package, would ship the debug panel to the real game and only hide it.
function mountDevHud(engine: Dispatcher, mount: Element): void {
  render(
    <EngineProvider value={engine}>
      <App />
      <DebugPanel />
    </EngineProvider>,
    mount,
  );
}

export { mountDevHud };
