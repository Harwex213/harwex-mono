import { type FC, useCallback } from "react";
import type { TArmyUnit } from "@hw/faenwald-core";
import { Select, Input, Button, IconButton } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import { UnitSubForm } from "./shared/unit-sub-form";
import s from "../event-modal.module.css";

export const WarArmyCorrectionForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);
  const units = (data.units as Partial<TArmyUnit>[]) ?? [];

  const addUnit = useCallback(() => {
    onChange({ ...data, units: [...units, {}] });
  }, [data, onChange, units]);

  const removeUnit = useCallback((index: number) => {
    onChange({ ...data, units: units.filter((_, i) => i !== index) });
  }, [data, onChange, units]);

  const updateUnit = useCallback((index: number, unit: Partial<TArmyUnit>) => {
    const updated = [...units];
    updated[index] = unit;
    onChange({ ...data, units: updated });
  }, [data, onChange, units]);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.armyId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, armyId: v })}
        options={armyOptions}
        placeholder="Select army"
      />
      <Select
        value={(data.provinceId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, provinceId: v })}
        options={provinceOptions}
        placeholder="Province"
      />
      <Input
        label="Army name"
        value={(data.name as string) ?? ""}
        onChange={(e) => onChange({ ...data, name: e.target.value })}
      />
      <div className={s.listHeader}>
        <span className={s.listLabel}>Units</span>
        <Button variant="ghost" size="sm" onClick={addUnit}>+ Add unit</Button>
      </div>
      {units.map((unit, i) => (
        <div key={i} className={s.listItem}>
          <div className={s.listHeader}>
            <span className={s.listLabel}>Unit {i + 1}</span>
            <IconButton size="sm" onClick={() => removeUnit(i)}>&#10005;</IconButton>
          </div>
          <UnitSubForm
            unit={unit}
            onChange={(u) => updateUnit(i, u)}
            gameContext={gameContext}
          />
        </div>
      ))}
    </div>
  );
};
