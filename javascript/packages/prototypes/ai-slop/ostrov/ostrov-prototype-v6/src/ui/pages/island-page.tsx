import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import { BuildingsPanel } from "../components/buildings-panel";
import { DemolishModal } from "../components/demolish-modal";
import { EndTurnPanel } from "../components/end-turn-panel";
import { FlightsLayer } from "../components/flights-layer";
import { HexModal } from "../components/hex-modal";
import { HexTooltip } from "../components/hex-tooltip";
import { IslandCanvas } from "../components/island-canvas";
import { NoticeToast } from "../components/notice-toast";
import { PlayersPanel } from "../components/players-panel";
import { ResourcesPanel } from "../components/resources-panel";
import { TechModal } from "../components/tech-modal";
import { ToolsPanel } from "../components/tools-panel";
import { TurnPanel } from "../components/turn-panel";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TIslandPageProps = {
  registry: TAppRegistry;
};

/**
 * The build phase happens here. The layout follows the wireframe: players top
 * left, turn top centre, and along the bottom resources, the two tool icons,
 * the buildings panel and the end-turn button.
 */
const IslandPage: FC<TIslandPageProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const isReadonly = store.derived.isReadonly.value;
  const viewed = store.derived.viewedPlayer.value;

  // Escape is the way out of every armed tool and open panel.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      registry.disarmAction();
      registry.closeHexModalAction();
      registry.closeTechModalAction();
      registry.cancelDemolishAction();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [registry]);

  return (
    <div className="island-page">
      <IslandCanvas registry={registry} />

      <HexTooltip />

      <div className="island-page__top-left">
        <PlayersPanel registry={registry} />
      </div>

      <div className="island-page__top-center">
        <TurnPanel />
      </div>

      {isReadonly ? (
        <div className="island-page__readonly">
          <span className="island-page__readonly-label">
            {`Остров игрока ${viewed?.nickname ?? ""} — только просмотр`}
          </span>

          <button
            type="button"
            className="button"
            onClick={() => registry.navigateToIslandAction(null)}
          >
            {"Вернуться на свой остров"}
          </button>
        </div>
      ) : (
        <div className="island-page__bottom">
          <ResourcesPanel registry={registry} />

          <ToolsPanel registry={registry} />

          <BuildingsPanel registry={registry} />

          <EndTurnPanel registry={registry} />
        </div>
      )}

      <FlightsLayer />

      <HexModal registry={registry} />

      <NoticeToast />

      <DemolishModal registry={registry} />

      <TechModal registry={registry} />
    </div>
  );
};

export { IslandPage };
