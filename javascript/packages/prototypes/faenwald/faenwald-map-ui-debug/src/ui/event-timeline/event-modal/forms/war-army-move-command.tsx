import { type FC, useCallback } from "react";
import { Select, Button, IconButton } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import s from "../event-modal.module.css";

export const WarArmyMoveCommandForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);
  const movement = (data.movement as string[]) ?? [];

  const addWaypoint = useCallback(() => {
    onChange({ ...data, movement: [...movement, ""] });
  }, [data, onChange, movement]);

  const removeWaypoint = useCallback((index: number) => {
    onChange({ ...data, movement: movement.filter((_, i) => i !== index) });
  }, [data, onChange, movement]);

  const updateWaypoint = useCallback((index: number, value: string) => {
    const updated = [...movement];
    updated[index] = value;
    onChange({ ...data, movement: updated });
  }, [data, onChange, movement]);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.armyId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, armyId: v })}
        options={armyOptions}
        placeholder="Select army"
      />
      <div className={s.listHeader}>
        <span className={s.listLabel}>Movement path</span>
        <Button variant="ghost" size="sm" onClick={addWaypoint}>+ Add</Button>
      </div>
      {movement.map((wp, i) => (
        <div key={i} className={s.formRow}>
          <Select
            value={wp}
            onValueChange={(v) => updateWaypoint(i, v)}
            options={provinceOptions}
            placeholder={`Waypoint ${i + 1}`}
          />
          <IconButton size="sm" onClick={() => removeWaypoint(i)}>&#10005;</IconButton>
        </div>
      ))}
    </div>
  );
};
