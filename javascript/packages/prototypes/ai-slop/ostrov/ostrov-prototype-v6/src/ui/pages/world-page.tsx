import { useSignals } from "@preact/signals-react/runtime";
import { EndTurnPanel } from "../components/end-turn-panel";
import { Globe } from "../components/globe";
import { NoticeToast } from "../components/notice-toast";
import { PlayersPanel } from "../components/players-panel";
import { ResourcesPanel } from "../components/resources-panel";
import { TrailEventModal } from "../components/trail-event-modal";
import { TurnPanel } from "../components/turn-panel";
import { WorldCellPanel } from "../components/world-cell-panel";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";

type TWorldPageProps = {
  registry: TAppRegistry;
};

/**
 * The exploration phase, on the globe. The wireframe keeps the same shell as
 * the island page minus the build tools: players, turn, resources, end turn.
 */
const WorldPage: FC<TWorldPageProps> = ({ registry }) => {
  useSignals();

  return (
    <div className="island-page">
      <Globe registry={registry} />

      <div className="island-page__top-left">
        <PlayersPanel registry={registry} />
      </div>

      <div className="island-page__top-center">
        <TurnPanel />
      </div>

      <WorldCellPanel registry={registry} />

      <div className="island-page__bottom">
        <ResourcesPanel registry={registry} />

        <EndTurnPanel registry={registry} />
      </div>

      <NoticeToast />

      <TrailEventModal registry={registry} />
    </div>
  );
};

export { WorldPage };
