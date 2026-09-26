import { useSignals } from "@preact/signals-react/runtime";
import { CellPanel } from "../components/cell-panel";
import { EndTurnPanel } from "../components/end-turn-panel";
import { EventModal } from "../components/event-modal";
import { PlayersPanel } from "../components/players-panel";
import { ResourcesPanel } from "../components/resources-panel";
import { TurnPill } from "../components/turn-pill";
import { WorldGlobe } from "../world-globe/world-globe";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

/**
 * The exploration phase (plan §3.7). The globe fills the page and the same four
 * panels as the island page float over it at the same positions, so the two
 * phases read as one screen. The cell panel takes the place of the biome modal.
 */

type TWorldPageProps = {
  registry: TAppRegistry;
};

const WorldPage: FC<TWorldPageProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const toast = store.ui.toast.value;

  return (
    <div className="world-page">
      <div className="world-page__canvas-slot">
        <WorldGlobe registry={registry} />
      </div>

      <PlayersPanel registry={registry} />

      <TurnPill />

      <ResourcesPanel registry={registry} />

      <EndTurnPanel registry={registry} />

      <CellPanel registry={registry} />

      <EventModal registry={registry} />

      {toast === null ? null : (
        <div className="world-page__toast">
          {toast}
        </div>
      )}
    </div>
  );
};

export { WorldPage };
