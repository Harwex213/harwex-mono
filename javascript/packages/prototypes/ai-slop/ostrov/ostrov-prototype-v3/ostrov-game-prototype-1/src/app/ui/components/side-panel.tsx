import { FactionsPanel } from "./factions-panel";
import { IslandPanel } from "./island-panel";
import { LogPanel } from "./log-panel";
import { TechPanel } from "./tech-panel";
import { TilePanel } from "./tile-panel";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";
import type { TPanelTab } from "../../store/store";

const TABS: { id: TPanelTab; label: string }[] = [
  { id: "tile", label: "Гекс" },
  { id: "island", label: "Остров" },
  { id: "tech", label: "Технологии" },
  { id: "factions", label: "Фракции" },
  { id: "log", label: "Журнал" },
];

type TSidePanelProps = {
  registry: TAppRegistry;
};

const SidePanel: FC<TSidePanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const tab = store.ui.panelTab.value;

  return (
    <aside className="panel">
      <nav className="panel__tabs">
        {TABS.map((entry) => (
          <button key={entry.id} className={`tab ${tab === entry.id ? "tab--active" : ""}`} onClick={() => registry.setPanelTabAction(entry.id)}>
            {entry.label}
          </button>
        ))}
      </nav>

      <div className="panel__body">
        {tab === "tile" ? <TilePanel registry={registry} /> : null}
        {tab === "island" ? <IslandPanel registry={registry} /> : null}
        {tab === "tech" ? <TechPanel registry={registry} /> : null}
        {tab === "factions" ? <FactionsPanel /> : null}
        {tab === "log" ? <LogPanel /> : null}
      </div>
    </aside>
  );
};

export { SidePanel };
