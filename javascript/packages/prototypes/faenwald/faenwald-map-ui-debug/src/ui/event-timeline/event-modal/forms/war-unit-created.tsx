import { type FC } from "react";
import type { TArmyUnit } from "@hw/faenwald-core";
import { Select } from "../../../kit";
import { type TFormProps, getArmyOptions } from "./form-types";
import { UnitSubForm } from "./shared/unit-sub-form";
import s from "../event-modal.module.css";

export const WarUnitCreatedForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const unit = (data.unit as Partial<TArmyUnit>) ?? {};

  return (
    <div className={s.formFields}>
      <Select
        value={(data.armyId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, armyId: v })}
        options={armyOptions}
        placeholder="Select army"
      />
      <UnitSubForm
        unit={unit}
        onChange={(u) => onChange({ ...data, unit: u })}
        gameContext={gameContext}
      />
    </div>
  );
};
