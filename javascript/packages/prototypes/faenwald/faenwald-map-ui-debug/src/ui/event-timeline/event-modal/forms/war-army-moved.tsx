import { type FC } from "react";
import { Select } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import s from "../event-modal.module.css";

export const WarArmyMovedForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.armyId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, armyId: v })}
        options={armyOptions}
        placeholder="Select army"
      />
      <Select
        value={(data.newProvinceId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, newProvinceId: v })}
        options={provinceOptions}
        placeholder="Target province"
      />
    </div>
  );
};
