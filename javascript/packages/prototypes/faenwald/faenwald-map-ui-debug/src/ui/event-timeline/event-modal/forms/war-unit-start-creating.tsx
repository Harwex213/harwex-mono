import { type FC } from "react";
import type { TArmyUnitKind, TArmyUnitType } from "@hw/faenwald-core";
import { ARMY_UNIT_TYPE_TRANSLATE } from "@hw/faenwald-core";
import { Input, Select } from "../../../kit";
import { type TFormProps, getProvinceOptions, getHouseOptions } from "./form-types";
import s from "../event-modal.module.css";

const KIND_OPTIONS = [
  { value: "regular", label: "Regular" },
  { value: "liege", label: "Liege" },
  { value: "vassal", label: "Vassal" },
];

const TYPE_OPTIONS: { value: TArmyUnitType; label: string }[] = (
  Object.entries(ARMY_UNIT_TYPE_TRANSLATE) as [TArmyUnitType, string][]
).map(([value, label]) => ({ value, label }));

export const WarUnitStartCreatingForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const provinceOptions = getProvinceOptions(gameContext);
  const houseOptions = getHouseOptions(gameContext);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.houseId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, houseId: v })}
        options={houseOptions}
        placeholder="House"
      />
      <Select
        value={(data.provinceId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, provinceId: v })}
        options={provinceOptions}
        placeholder="Province"
      />
      <Select
        value={(data.unitKind as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, unitKind: v as TArmyUnitKind })}
        options={KIND_OPTIONS}
        placeholder="Unit kind"
      />
      <Select
        value={(data.unitType as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, unitType: v as TArmyUnitType })}
        options={TYPE_OPTIONS}
        placeholder="Unit type"
      />
      <Input
        label="Amount"
        type="number"
        value={(data.amount as string) ?? ""}
        onChange={(e) => onChange({ ...data, amount: Number(e.target.value) })}
      />
    </div>
  );
};
