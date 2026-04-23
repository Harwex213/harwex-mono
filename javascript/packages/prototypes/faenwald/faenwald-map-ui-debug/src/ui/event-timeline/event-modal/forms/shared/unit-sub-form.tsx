import { type FC, useMemo } from "react";
import type { TArmyUnit, TArmyUnitKind, TArmyUnitType, TArmyUnitRank } from "@hw/faenwald-core";
import { ARMY_UNIT_TEMPLATES, ARMY_UNIT_TYPE_TRANSLATE, ARMY_RANK_TO_TRANSLATE } from "@hw/faenwald-core";
import { Input, Select } from "../../../../kit";
import { getHouseOptions } from "../form-types";
import type { TGameContext } from "@hw/faenwald-core";
import s from "../../event-modal.module.css";

const KIND_OPTIONS = [
  { value: "regular", label: "Regular" },
  { value: "liege", label: "Liege" },
  { value: "vassal", label: "Vassal" },
];

const TYPE_OPTIONS: { value: TArmyUnitType; label: string }[] = (
  Object.entries(ARMY_UNIT_TYPE_TRANSLATE) as [TArmyUnitType, string][]
).map(([value, label]) => ({ value, label }));

const RANK_OPTIONS: { value: TArmyUnitRank; label: string }[] = (
  Object.entries(ARMY_RANK_TO_TRANSLATE) as [TArmyUnitRank, string][]
).map(([value, label]) => ({ value, label }));

type TUnitSubFormProps = {
  unit: Partial<TArmyUnit>;
  onChange: (unit: Partial<TArmyUnit>) => void;
  gameContext: TGameContext;
};

export const UnitSubForm: FC<TUnitSubFormProps> = ({ unit, onChange, gameContext }) => {
  const houseOptions = getHouseOptions(gameContext);

  const template = useMemo(() => {
    if (!unit.type) return null;
    return ARMY_UNIT_TEMPLATES[unit.type] ?? null;
  }, [unit.type]);

  return (
    <div className={s.formFields}>
      <div className={s.formRow}>
        <Select
          value={unit.kind ?? ""}
          onValueChange={(v) => onChange({ ...unit, kind: v as TArmyUnitKind })}
          options={KIND_OPTIONS}
          placeholder="Kind"
        />
        <Select
          value={unit.type ?? ""}
          onValueChange={(v) => {
            const tmpl = ARMY_UNIT_TEMPLATES[v as TArmyUnitType];
            onChange({
              ...unit,
              type: v as TArmyUnitType,
              baseHp: tmpl?.baseHp,
              baseAttack: tmpl?.baseAttack,
              baseMorale: tmpl?.baseMorale,
              baseSpeed: tmpl?.baseSpeed,
              baseCost: tmpl?.baseCost,
            });
          }}
          options={TYPE_OPTIONS}
          placeholder="Type"
        />
      </div>
      <div className={s.formRow}>
        <Input
          label="Amount"
          type="number"
          value={unit.amount ?? ""}
          onChange={(e) => onChange({ ...unit, amount: Number(e.target.value) })}
        />
        <Input
          label="Stripes"
          type="number"
          value={unit.stripes ?? ""}
          onChange={(e) => onChange({ ...unit, stripes: Number(e.target.value) })}
        />
        <Select
          value={unit.rank ?? ""}
          onValueChange={(v) => onChange({ ...unit, rank: v as TArmyUnitRank })}
          options={RANK_OPTIONS}
          placeholder="Rank"
        />
      </div>
      <Select
        value={unit.houseId ?? ""}
        onValueChange={(v) => onChange({ ...unit, houseId: v })}
        options={houseOptions}
        placeholder="House"
      />
      {template ? (
        <div className={s.formRow}>
          <Input label="HP" value={template.baseHp} readOnly />
          <Input label="ATK" value={template.baseAttack} readOnly />
          <Input label="MRL" value={template.baseMorale} readOnly />
          <Input label="SPD" value={template.baseSpeed} readOnly />
          <Input label="Cost" value={template.baseCost} readOnly />
        </div>
      ) : null}
    </div>
  );
};
