import { type FC, useCallback } from "react";
import { Select, Button, IconButton } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import s from "../event-modal.module.css";

const WINNER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "attacker", label: "Attacker" },
  { value: "defender", label: "Defender" },
];

export const WarFortressAssaultForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);
  const attack = (data.attack as string[]) ?? [];

  const addAttacker = useCallback(() => {
    onChange({ ...data, attack: [...attack, ""] });
  }, [data, onChange, attack]);

  const removeAttacker = useCallback((index: number) => {
    onChange({ ...data, attack: attack.filter((_, i) => i !== index) });
  }, [data, onChange, attack]);

  const updateAttacker = useCallback((index: number, value: string) => {
    const updated = [...attack];
    updated[index] = value;
    onChange({ ...data, attack: updated });
  }, [data, onChange, attack]);

  return (
    <div className={s.formFields}>
      <Select
        value={(data.provinceId as string) ?? ""}
        onValueChange={(v) => onChange({ ...data, provinceId: v })}
        options={provinceOptions}
        placeholder="Province"
      />
      <Select
        value={(data.winner as string) ?? "pending"}
        onValueChange={(v) => onChange({ ...data, winner: v })}
        options={WINNER_OPTIONS}
        placeholder="Winner"
      />

      <div className={s.listHeader}>
        <span className={s.listLabel}>Attackers</span>
        <Button variant="ghost" size="sm" onClick={addAttacker}>+ Add</Button>
      </div>
      {attack.map((id, i) => (
        <div key={i} className={s.formRow}>
          <Select
            value={id}
            onValueChange={(v) => updateAttacker(i, v)}
            options={armyOptions}
            placeholder={`Attacker ${i + 1}`}
          />
          <IconButton size="sm" onClick={() => removeAttacker(i)}>&#10005;</IconButton>
        </div>
      ))}
    </div>
  );
};
