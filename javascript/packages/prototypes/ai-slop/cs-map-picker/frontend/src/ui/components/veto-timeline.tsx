import type { FC } from "react";
import { SEQUENCES, sideOfStep } from "../../domain/sequence";
import type { TMap, TPickView } from "../../domain/types";
import { teamOf } from "../labels";

type TVetoTimelineProps = {
  pick: TPickView;
  maps: Map<string, TMap>;
};

const VetoTimeline: FC<TVetoTimelineProps> = ({ pick, maps }) => {
  const firstSide = pick.firstSide;

  return (
    <ol className="timeline">
      {SEQUENCES[pick.format].map((kind, step) => {
        const action = pick.actions[step];
        const isCurrent = pick.next?.step === step;
        const side = firstSide ? sideOfStep(firstSide, step) : null;
        const className = ["timeline-step", `timeline-${kind}`, action ? "timeline-done" : "", isCurrent ? "timeline-current" : ""].join(" ");
        return (
          <li key={step} className={className}>
            <span className="timeline-kind">{kind === "ban" ? "Бан" : "Пик"}</span>
            <span className="timeline-team">{side ? teamOf(pick, side).name : "—"}</span>
            <span className="timeline-map">{action ? (maps.get(action.map)?.name ?? action.map) : isCurrent ? "выбирает…" : ""}</span>
          </li>
        );
      })}
      <li className={pick.decider ? "timeline-step timeline-decider timeline-done" : "timeline-step timeline-decider"}>
        <span className="timeline-kind">{pick.format === "bo3" ? "Решающая" : "Игровая"}</span>
        <span className="timeline-team">остаётся</span>
        <span className="timeline-map">{pick.decider ? (maps.get(pick.decider)?.name ?? pick.decider) : ""}</span>
      </li>
    </ol>
  );
};

export { VetoTimeline };
