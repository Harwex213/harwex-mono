import { memo, useCallback, useState } from "react";
import type { MapEngine } from "../../core/map-engine/map-engine";
import type { TGameTurnPhaseEvent } from "@hw/faenwald-core";
import { Button, IconButton, ScrollArea } from "../kit";
import { EventModal } from "./event-modal/event-modal";
import clsx from "clsx";
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
  const gameContext = mapEngine.gameContextData!;

  const [turn, setTurn] = useState(() => mapEngine.currentTurn);
  const [phase, setPhase] = useState(() => mapEngine.currentPhase);

  const [isAddMode, setIsAddMode] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState<"create" | "edit">("create");
  const [insertAfterIndex, setInsertAfterIndex] = useState<number | undefined>();
  const [editingEvent, setEditingEvent] = useState<TGameTurnPhaseEvent | null>(null);
  const [editingEventIndex, setEditingEventIndex] = useState<number | undefined>();

  const changeTurn = useCallback((newTurn: number) => {
    setTurn(newTurn);
    setPhase(0);
    setIsAddMode(false);
    mapEngine.changeTurnAndPhase(String(newTurn), String(0));
  }, [mapEngine]);

  const changePhase = useCallback((newPhase: number) => {
    setPhase(newPhase);
    setIsAddMode(false);
    mapEngine.changeTurnAndPhase(String(turn), String(newPhase));
  }, [mapEngine]);

  const handleAddClick = useCallback(() => {
    const events = gameContext?.turns[turn]?.phases[phase] ?? [];
    if (events.length === 0) {
      setModalMode("create");
      setInsertAfterIndex(undefined);
      setEditingEvent(null);
      setEditingEventIndex(undefined);
      setModalOpen(true);
    } else {
      setIsAddMode((prev) => !prev);
    }
  }, [gameContext, turn, phase]);

  const handleInsertSlotClick = useCallback((afterIndex: number | undefined) => {
    setModalMode("create");
    setInsertAfterIndex(afterIndex);
    setEditingEvent(null);
    setEditingEventIndex(undefined);
    setIsAddMode(false);
    setModalOpen(true);
  }, []);

  const handleEventClick = useCallback((event: TGameTurnPhaseEvent, index: number) => {
    setModalMode("edit");
    setEditingEvent(event);
    setEditingEventIndex(index);
    setInsertAfterIndex(undefined);
    setIsAddMode(false);
    setModalOpen(true);
  }, []);

  const handleSave = useCallback(() => {
    setModalOpen(false);
    setEditingEvent(null);
    setEditingEventIndex(undefined);
    mapEngine.reload();
  }, [mapEngine]);

  const minTurn = 0;
  const maxTurn = gameContext.gameState.currentTurn;
  const isCurrentTurn = turn === maxTurn;

  const minPhase = 0;
  const maxPhase = isCurrentTurn
    ? gameContext.gameState.currentPhase
    : 11;

  const events = gameContext.turns[turn - 1]?.phases[phase - 1] ?? [];

  console.log(123, events);

  return (
    <div className={s.container}>
      <div className={s.turnRow}>
        <IconButton disabled={turn <= minTurn} onClick={() => changeTurn(turn - 1)}>
          &#8592;
        </IconButton>
        <span className={s.turnLabel}>Turn {turn}</span>
        <IconButton disabled={turn >= maxTurn} onClick={() => changeTurn(turn + 1)}>
          &#8594;
        </IconButton>
      </div>

      <div className={s.phaseRow}>
        <IconButton disabled={phase <= minPhase} onClick={() => changePhase(phase - 1)}>
          &#8592;
        </IconButton>

        <ScrollArea direction="horizontal" className={s.eventsScroll}>
          {events.length === 0 ? (
            <span className={s.empty}>No events in phase {phase}</span>
          ) : (
            events.map((event, index) => (
              <span key={event.event.eventId ?? index} style={{ display: "contents" }}>
                {isAddMode ? (
                  <button
                    className={s.insertSlot}
                    onClick={() => handleInsertSlotClick(index === 0 ? undefined : index - 1)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  size="md"
                  className={s.eventCard}
                  onClick={() => handleEventClick(event, index)}
                >
                  {getEventLabel(event)}
                </Button>
                {isAddMode && index === events.length - 1 ? (
                  <button
                    className={s.insertSlot}
                    onClick={() => handleInsertSlotClick(index)}
                  />
                ) : null}
              </span>
            ))
          )}
        </ScrollArea>

        <IconButton disabled={phase >= maxPhase} onClick={() => changePhase(phase + 1)}>
          &#8594;
        </IconButton>

        <IconButton
          size="md"
          className={clsx(s.addIconButton, isAddMode && s.addModeActive)}
          onClick={handleAddClick}
        >
          +
        </IconButton>
      </div>

      <EventModal
        open={modalOpen}
        onOpenChange={setModalOpen}
        mode={modalMode}
        insertAfterIndex={insertAfterIndex}
        event={editingEvent}
        eventIndex={editingEventIndex}
        gameContext={gameContext}
        turn={turn}
        phase={phase}
        onSave={handleSave}
      />
    </div>
  );
});
