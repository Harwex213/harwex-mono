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
import { StartPanel } from "../components/start-panel";
import { TaxPickModal } from "../components/tax-pick-modal";
import { TechModal } from "../components/tech-modal";
import { ToolsPanel } from "../components/tools-panel";
import { ToxicPanel } from "../components/toxic-panel";
import { TurnPanel } from "../components/turn-panel";
import { Vignette } from "../components/vignette";
import { WaitingOverlay } from "../components/waiting-overlay";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TIslandPageProps = {
  registry: TAppRegistry;
};

/**
 * The start phase and the build phase happen here. The layout follows the two
 * wireframes of the island page. At the start of the game there are only the
 * players list top left and the "Начать" button bottom centre. In the build
 * phase the turn is top centre, and along the bottom sit the resources, the
 * two tool icons, the buildings panel and the end-turn button. The island's
 * toxicity meter and its slot sit on the right, above the end-turn button.
 */
const IslandPage: FC<TIslandPageProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const isReadonly = store.derived.isReadonly.value;
  const viewed = store.derived.viewedPlayer.value;
  const stage = store.game.stage.value;
  const isStartPhase = stage === "setup" || stage === "starting";
  const hudClass = stage === "entering" ? "island-page__hud--entering" : "";
  const waitingClass = store.derived.isHumanReady.value ? "island-page--waiting" : "";

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
      registry.closeTaxPickAction();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [registry]);

  return (
    <div className={`island-page ${waitingClass}`}>
      <IslandCanvas registry={registry} />

      <HexTooltip />

      <div className="island-page__top-left">
        <PlayersPanel registry={registry} />
      </div>

      {isStartPhase ? null : (
        <div className={`island-page__top-center ${hudClass}`}>
          <TurnPanel />
        </div>
      )}

      {isStartPhase ? null : (
        <div className={`island-page__right ${hudClass}`}>
          <ToxicPanel registry={registry} />
        </div>
      )}

      {isStartPhase ? (
        <div className="island-page__start">
          <StartPanel registry={registry} />
        </div>
      ) : null}

      {!isStartPhase && isReadonly ? (
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
      ) : null}

      {!isStartPhase && !isReadonly ? (
        <div className={`island-page__bottom ${hudClass}`}>
          <ResourcesPanel registry={registry} />

          <div className="island-page__actions">
            <ToolsPanel registry={registry} />

            <BuildingsPanel registry={registry} />
          </div>

          <EndTurnPanel registry={registry} />
        </div>
      ) : null}

      {stage === "starting" || stage === "entering" ? <Vignette mode={stage} /> : null}

      <WaitingOverlay />

      <FlightsLayer />

      <HexModal registry={registry} />

      <NoticeToast />

      <DemolishModal registry={registry} />

      <TechModal registry={registry} />

      <TaxPickModal registry={registry} />
    </div>
  );
};

export { IslandPage };
