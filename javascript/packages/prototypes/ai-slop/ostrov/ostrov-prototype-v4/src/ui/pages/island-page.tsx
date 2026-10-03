import { useSignals } from "@preact/signals-react/runtime";
import { BiomeModal } from "../components/biome-modal";
import { BuildingsPanel } from "../components/buildings-panel";
import { DemolishIcon } from "../components/demolish-icon";
import { EndTurnPanel } from "../components/end-turn-panel";
import { EventModal } from "../components/event-modal";
import { HexPopup } from "../components/hex-popup";
import { IslandCanvas } from "../island-canvas/island-canvas";
import { PlayersPanel } from "../components/players-panel";
import { PurgeIcon } from "../components/purge-icon";
import { ResourcesPanel } from "../components/resources-panel";
import { TaxFlightLayer } from "../tax-flight/tax-flight-layer";
import { TechIcon } from "../components/tech-icon";
import { TechModal } from "../components/tech-modal";
import { TurnPill } from "../components/turn-pill";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

/**
 * The wireframe of `01-spec-schema-1.svg`: the canvas fills the whole page and
 * the panels float over it. A foreign island loses the resources panel, the
 * tools column and the buildings panel, and gains a back button (spec node-58).
 */

type TIslandPageProps = {
  registry: TAppRegistry;
};

const BACK_LABEL_RU = "← Назад к своему острову";

const IslandPage: FC<TIslandPageProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const isReadonly = store.derived.isReadonly.value;
  const toast = store.ui.toast.value;

  return (
    <div className="island-page">
      {/* A click anywhere on the board lands the tax glyphs at once; the action
          itself refuses outside the flying stage, so the build phase is unharmed. */}
      <div className="island-page__canvas-slot" onClick={() => registry.skipFlights()}>
        <IslandCanvas registry={registry} />
      </div>

      <PlayersPanel registry={registry} />

      <TurnPill />

      {isReadonly ? (
        <button type="button" className="island-page__back" onClick={() => registry.navigate("island")}>
          {BACK_LABEL_RU}
        </button>
      ) : (
        <>
          <ResourcesPanel registry={registry} />

          <div className="island-page__tools">
            <DemolishIcon registry={registry} />

            <TechIcon registry={registry} />

            <PurgeIcon registry={registry} />
          </div>

          <div className="island-page__buildings-slot">
            <BuildingsPanel registry={registry} />
          </div>
        </>
      )}

      <EndTurnPanel registry={registry} />

      <HexPopup />

      <BiomeModal registry={registry} />

      <TaxFlightLayer registry={registry} />

      <TechModal registry={registry} />

      {/* Riots and trail events can fire while the island page is on screen. */}
      <EventModal registry={registry} />

      {toast === null ? null : (
        <div className="island-page__toast">
          {toast}
        </div>
      )}
    </div>
  );
};

export { IslandPage };
