import { type FC, useCallback } from "react";
import { Select, Button, IconButton } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import s from "../event-modal.module.css";

export const WarSiegeStartedForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);
  const armies = (data.armies as string[]) ?? [];

  const addArmy = useCallback(() => {
    onChange({ ...data, armies: [...armies, ""] });
  }, [data, onChange, armies]);

  const removeArmy = useCallback((index: number) => {
    onChange({ ...data, armies: armies.filter((_, i) => i !== index) });
  }, [data, onChange, armies]);

  const updateArmy = useCallback((index: number, value: string) => {
    const updated = [...armies];
    updated[index] = value;
    onChange({ ...data, armies: updated });
  }, [data, onChange, armies]);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.provinceId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, provinceId: v })}
        options={provinceOptions}
        placeholder="Province"
      />
      <div className={s.listHeader}>
        <span className={s.listLabel}>Besieging armies</span>
        <Button variant="ghost" size="sm" onClick={addArmy}>+ Add</Button>
      </div>
      {armies.map((armyId, i) => (
        <div key={i} className={s.formRow}>
          <Select
            value={armyId}
            onValueChange={(v) => updateArmy(i, v)}
            options={armyOptions}
            placeholder={`Army ${i + 1}`}
          />
          <IconButton size="sm" onClick={() => removeArmy(i)}>&#10005;</IconButton>
        </div>
      ))}
    </div>
  );
};
