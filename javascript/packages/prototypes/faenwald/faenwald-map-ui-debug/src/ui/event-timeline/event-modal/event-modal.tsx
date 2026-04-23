import { type FC, useCallback, useEffect, useMemo, useState } from "react";
import type {
  TGameContext,
  TGameTurnPhaseEvent,
  TGameTurnPhaseEventType,
  TGameTurnPhaseWarEventSubtype,
} from "@hw/faenwald-core";
import { createEvent } from "@hw/faenwald-core";
import { Button, Dialog, DialogTitle, Select } from "../../kit";
import { WarProvincePillagedForm } from "./forms/war-province-pillaged";
import { WarArmyMovedForm } from "./forms/war-army-moved";
import { WarArmyMoveCommandForm } from "./forms/war-army-move-command";
import { WarSiegeStartedForm } from "./forms/war-siege-started";
import { WarUnitStartCreatingForm } from "./forms/war-unit-start-creating";
import { WarUnitCreatedForm } from "./forms/war-unit-created";
import { WarArmyCorrectionForm } from "./forms/war-army-correction";
import { WarBattleForm } from "./forms/war-battle";
import { WarFortressAssaultForm } from "./forms/war-fortress-assault";
import s from "./event-modal.module.css";

const EVENT_TYPE_OPTIONS = [
  { value: "system", label: "System" },
  { value: "war", label: "War" },
];

const WAR_SUBTYPE_OPTIONS: { value: TGameTurnPhaseWarEventSubtype; label: string }[] = [
  { value: "TWarEvent_ProvincePillaged", label: "Province Pillaged" },
  { value: "TWarEvent_Battle", label: "Battle" },
  { value: "TWarEvent_FortressAssault", label: "Fortress Assault" },
  { value: "TWarEvent_SiegeStarted", label: "Siege Started" },
  { value: "TWarEvent_ArmyMoved", label: "Army Moved" },
  { value: "TWarEvent_ArmyMoveCommand", label: "Army Move Command" },
  { value: "TWarEvent_ArmyCorrection", label: "Army Correction" },
  { value: "TWarEvent_UnitStartCreating", label: "Unit Start Creating" },
  { value: "TWarEvent_UnitCreated", label: "Unit Created" },
];

const SYSTEM_SUBTYPE_OPTIONS = [
  { value: "TSystemEvent_Snapshot", label: "Snapshot" },
];

type TEventModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  mode: "create" | "edit";
  insertAfterIndex?: number;
  event: TGameTurnPhaseEvent | null;
  eventIndex?: number;
  gameContext: TGameContext;
  turn: number;
  phase: number;
  onSave: () => void;
};

export const EventModal: FC<TEventModalProps> = ({
  open, onOpenChange, mode, insertAfterIndex, event, eventIndex, gameContext, turn, phase, onSave,
}) => {
  const [eventType, setEventType] = useState<TGameTurnPhaseEventType>("war");
  const [subtype, setSubtype] = useState<string>("");
  const [formData, setFormData] = useState<Record<string, unknown>>({});
  const [originalJson, setOriginalJson] = useState<string>("");

  const isEdit = mode === "edit";

  useEffect(() => {
    if (open && event && isEdit) {
      setEventType(event.type);
      setSubtype(event.event.type);
      const { type: _t, eventId: _eid, ...rest } = event.event as Record<string, unknown>;
      setFormData(rest);
      setOriginalJson(JSON.stringify(rest));
    } else if (open && !isEdit) {
      setEventType("war");
      setSubtype("");
      setFormData({});
      setOriginalJson("");
    }
  }, [open, event, isEdit]);

  const subtypeOptions = useMemo(
    () => eventType === "system" ? SYSTEM_SUBTYPE_OPTIONS : WAR_SUBTYPE_OPTIONS,
    [eventType],
  );

  const handleTypeChange = useCallback((value: string) => {
    setEventType(value as TGameTurnPhaseEventType);
    setSubtype("");
    setFormData({});
  }, []);

  const handleSubtypeChange = useCallback((value: string) => {
    setSubtype(value);
    setFormData({});
  }, []);

  const isDirty = isEdit ? JSON.stringify(formData) !== originalJson : true;

  const isValid = useMemo(() => {
    if (!subtype) return false;
    if (subtype === "TSystemEvent_Snapshot") return true;
    const values = Object.values(formData);
    if (values.length === 0) return false;
    return values.every((v) => v !== "" && v !== undefined && v !== null);
  }, [subtype, formData]);

  const canSave = isValid && isDirty;

  const handleSave = useCallback(async () => {
    if (!canSave) return;

    const eventId = isEdit
      ? (event!.event as { eventId: string }).eventId
      : String(gameContext.counters.globalEvent++);

    const builtEvent: TGameTurnPhaseEvent = eventType === "system"
      ? { type: "system", event: { type: "TSystemEvent_Snapshot" as const, eventId } }
      : {
        type: "war",
        event: { type: subtype, eventId, ...formData } as TGameTurnPhaseEvent & { type: "war" } extends {
          event: infer E
        } ? E : never
      };

    createEvent(gameContext, { event: builtEvent, afterIndex: insertAfterIndex, turn, phase });

    onSave();
  }, [canSave, isEdit, event, eventIndex, gameContext, turn, phase, eventType, subtype, formData, insertAfterIndex, onSave]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogTitle>{isEdit ? "Edit Event" : "Create Event"}</DialogTitle>

      <div className={s.selectRow}>
        <Select
          value={eventType}
          onValueChange={handleTypeChange}
          options={EVENT_TYPE_OPTIONS}
          placeholder="Event type"
          disabled={isEdit}
        />
        <Select
          value={subtype}
          onValueChange={handleSubtypeChange}
          options={subtypeOptions}
          placeholder="Subtype"
          disabled={isEdit}
        />
      </div>

      <div className={s.formArea}>
        {!subtype ? (
          <span className={s.emptyForm}>Select event type and subtype</span>
        ) : subtype === "TSystemEvent_Snapshot" ? (
          <span className={s.emptyForm}>No additional fields</span>
        ) : (
          <EventSubtypeForm
            subtype={subtype}
            formData={formData}
            onChange={setFormData}
            gameContext={gameContext}
          />
        )}
      </div>

      <div className={s.footer}>
        <Button variant="primary" disabled={!canSave} onClick={handleSave}>
          {isEdit ? "Update" : "Create"}
        </Button>
      </div>
    </Dialog>
  );
};

type TSubtypeFormProps = {
  subtype: string;
  formData: Record<string, unknown>;
  onChange: (data: Record<string, unknown>) => void;
  gameContext: TGameContext;
};

const EventSubtypeForm: FC<TSubtypeFormProps> = ({ subtype, formData, onChange, gameContext }) => {
  switch (subtype) {
    case "TWarEvent_ProvincePillaged":
      return <WarProvincePillagedForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_ArmyMoved":
      return <WarArmyMovedForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_ArmyMoveCommand":
      return <WarArmyMoveCommandForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_SiegeStarted":
      return <WarSiegeStartedForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_UnitStartCreating":
      return <WarUnitStartCreatingForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_UnitCreated":
      return <WarUnitCreatedForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_ArmyCorrection":
      return <WarArmyCorrectionForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_Battle":
      return <WarBattleForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    case "TWarEvent_FortressAssault":
      return <WarFortressAssaultForm data={formData} onChange={onChange} gameContext={gameContext}/>;
    default:
      return <span className={s.emptyForm}>Unknown event type</span>;
  }
};
