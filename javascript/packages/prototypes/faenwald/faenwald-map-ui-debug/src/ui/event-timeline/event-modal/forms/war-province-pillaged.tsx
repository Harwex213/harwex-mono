import { type FC } from "react";
import { Input, Select } from "../../../kit";
import { type TFormProps, getArmyOptions } from "./form-types";
import s from "../event-modal.module.css";

export const WarProvincePillagedForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.armyId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, armyId: v })}
        options={armyOptions}
        placeholder="Select army"
      />
      <Input
        label="Percent"
        type="number"
        value={(data.percent as string) ?? ""}
        onChange={(e) => onChange({ ...data, percent: Number(e.target.value) })}
      />
    </div>
  );
};
