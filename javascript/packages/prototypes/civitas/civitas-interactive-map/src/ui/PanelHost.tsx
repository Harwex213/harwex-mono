import { useSignals } from "@preact/signals-react/runtime";
import { CountryOverviewPanel } from "./CountryOverviewPanel";
import { EconomicsPanel } from "./EconomicsPanel";
import { ProvincesOverviewPanel } from "./ProvincesOverviewPanel";
import { openPanelId } from "../state/panel-store";

// Renders the panel named by `openPanelId`, or nothing. Each panel component
// renders its own `<Panel>` with its own title, so a panel owns its heading text.

function PanelHost() {
  useSignals();

  const open = openPanelId.value;

  if (open === "country") {
    return <CountryOverviewPanel />;
  }
  if (open === "provinces") {
    return <ProvincesOverviewPanel />;
  }
  if (open === "economics") {
    return <EconomicsPanel />;
  }
  return null;
}

export { PanelHost };
