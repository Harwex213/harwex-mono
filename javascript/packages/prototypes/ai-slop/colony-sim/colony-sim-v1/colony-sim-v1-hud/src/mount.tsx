import { render } from "preact";
import type { Dispatcher } from "@hw/colony-sim-v1-core";
import { EngineProvider } from "./engine-context";
import { App } from "./App";

// The HUD's whole entry point: a DOM tree over the canvas, wired to one command
// sink. It takes an element rather than finding one itself — where the HUD lives on
// the page is the app's layout decision, not the HUD's.
function mountHud(engine: Dispatcher, mount: Element): void {
  render(
    <EngineProvider value={engine}>
      <App />
    </EngineProvider>,
    mount,
  );
}

export { mountHud };
