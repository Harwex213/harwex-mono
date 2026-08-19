import { createRoot } from "react-dom/client";
import { createApi } from "./api";
import { createLobbySeed } from "./fixtures/lobby";
import { createRegistry } from "./registry";
import { createStore } from "./store/createStore";
import { scenarios } from "./testing/scenarios";
import type { ScenarioName } from "./testing/scenario-names";
import { App } from "./ui/App";
import { AppProviders } from "./ui/context";
import { ReadyFlag } from "./ui/ReadyFlag";

// The screenshot harness. It is the app entry with one line changed: a named
// scenario runs against the fresh store before React mounts. That is the whole
// payoff of the layering — no network stub, no clicking a path to a state, no
// component-level test rig.

const DEFAULT_SCENARIO: ScenarioName = "lobby-default";

function readScenarioName(): string {
  const requested = new URLSearchParams(window.location.search).get("scenario");
  if (requested === null || requested === "") {
    return DEFAULT_SCENARIO;
  }
  return requested;
}

function isScenarioName(name: string): name is ScenarioName {
  return Object.hasOwn(scenarios, name);
}

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing from harness.html");
}

const name = readScenarioName();
if (!isScenarioName(name)) {
  document.documentElement.dataset.harnessError = "unknown-scenario";
  container.className = "lc-harness-error";
  container.textContent = `Unknown scenario "${name}". Known scenarios: ${Object.keys(scenarios).join(", ")}`;
} else {
  const store = createStore(createLobbySeed());
  const registry = createRegistry({
    store,
    api: createApi(),
  });
  scenarios[name].setup?.({ store, registry });
  window.harness = {
    store,
    registry,
    scenarioName: name,
  };
  createRoot(container).render(
    <AppProviders store={store} registry={registry}>
      <App />
      <ReadyFlag />
    </AppProviders>,
  );
}
