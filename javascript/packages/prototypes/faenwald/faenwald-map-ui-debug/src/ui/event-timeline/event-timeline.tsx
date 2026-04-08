import { memo, useCallback, useState } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import type { TGameTurnPhaseEvent } from "@hw/faenwald-core";
import s from "./event-timeline.module.css";

const EVENT_TYPE_LABELS: Record<string, string> = {
  TSystemEvent_Snapshot: "System",
  TWarEvent_Battle: "Battle",
  TWarEvent_ArmyMoved: "Move",
  TWarEvent_ArmyMoveCommand: "Move Cmd",
  TWarEvent_ProvincePillaged: "Pillage",
  TWarEvent_ArmyCorrection: "Correction",
  TWarEvent_UnitStartCreating: "Recruit",
  TWarEvent_UnitCreated: "Unit Ready",
  TWarEvent_SiegeStarted: "Siege",
  TWarEvent_FortressAssault: "Assault",
};

const getEventLabel = (event: TGameTurnPhaseEvent): string => {
  return EVENT_TYPE_LABELS[event.event.type] ?? event.event.type;
};

type TEventTimelineProps = {
  mapEngine: MapEngine;
};

export const EventTimeline = memo<TEventTimelineProps>(({ mapEngine }) => {
  const gameContext = mapEngine.gameContextData;

  const [turn, setTurn] = useState(() => mapEngine.currentTurn);
  const [phase, setPhase] = useState(() => mapEngine.currentPhase);

  const changeTurn = useCallback((newTurn: number) => {
    setTurn(newTurn);
    setPhase(0);
    mapEngine.turn = String(newTurn);
    mapEngine.phase = String(0);
  }, [mapEngine]);

  const changePhase = useCallback((newPhase: number) => {
    setPhase(newPhase);
    mapEngine.phase = String(newPhase);
  }, [mapEngine]);

  if (!gameContext) return null;

  const minTurn = 0;
  const maxTurn = gameContext.gameState.currentTurn;
  const isCurrentTurn = turn === maxTurn;

  const minPhase = 0;
  const maxPhase = isCurrentTurn
    ? gameContext.gameState.currentPhase
    : 11;

  const events = gameContext.turns[turn]?.phases[phase] ?? [];

  return (
    <div className={s.container}>
      <div className={s.turnRow}>
        <button
          className={s.navButton}
          disabled={turn <= minTurn}
          onClick={() => changeTurn(turn - 1)}
        >
          ←
        </button>
        <span className={s.turnLabel}>Turn {turn}</span>
        <button
          className={s.navButton}
          disabled={turn >= maxTurn}
          onClick={() => changeTurn(turn + 1)}
        >
          →
        </button>
      </div>

      <div className={s.phaseRow}>
        <button
          className={s.navButton}
          disabled={phase <= minPhase}
          onClick={() => changePhase(phase - 1)}
        >
          ←
        </button>

        <div className={s.eventsScroll}>
          {events.length === 0 ? (
            <span className={s.empty}>No events in phase {phase}</span>
          ) : (
            events.map((event, index) => (
              <button
                key={event.event.eventId ?? index}
                className={s.eventCard}
                onClick={() => {/* TODO: open event modal */}}
              >
                {getEventLabel(event)}
              </button>
            ))
          )}
        </div>

        <button
          className={s.navButton}
          disabled={phase >= maxPhase}
          onClick={() => changePhase(phase + 1)}
        >
          →
        </button>

        <button
          className={s.addButton}
          onClick={() => {/* TODO: add event */}}
        >
          +
        </button>
      </div>
    </div>
  );
});
