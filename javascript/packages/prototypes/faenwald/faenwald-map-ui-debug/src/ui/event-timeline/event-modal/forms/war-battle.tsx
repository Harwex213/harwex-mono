import { type FC, useCallback } from "react";
import { Select, Button, IconButton } from "../../../kit";
import { type TFormProps, getArmyOptions, getProvinceOptions } from "./form-types";
import s from "../event-modal.module.css";

const WINNER_OPTIONS = [
  { value: "pending", label: "Pending" },
  { value: "attacker", label: "Attacker" },
  { value: "defender", label: "Defender" },
];

export const WarBattleForm: FC<TFormProps> = ({ data, onChange, gameContext }) => {
  const armyOptions = getArmyOptions(gameContext);
  const provinceOptions = getProvinceOptions(gameContext);
  const attack = (data.attack as string[]) ?? [];
  const defense = (data.defense as string[]) ?? [];

  const updateList = useCallback((key: string, list: string[], index: number, value: string) => {
    const updated = [...list];
    updated[index] = value;
    onChange({ ...data, [key]: updated });
  }, [data, onChange]);

  const addToList = useCallback((key: string, list: string[]) => {
    onChange({ ...data, [key]: [...list, ""] });
  }, [data, onChange]);

  const removeFromList = useCallback((key: string, list: string[], index: number) => {
    onChange({ ...data, [key]: list.filter((_, i) => i !== index) });
  }, [data, onChange]);

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
        <Button variant="ghost" size="sm" onClick={() => addToList("attack", attack)}>+ Add</Button>
      </div>
      {attack.map((id, i) => (
        <div key={i} className={s.formRow}>
          <Select
            value={id}
            onValueChange={(v) => updateList("attack", attack, i, v)}
            options={armyOptions}
            placeholder={`Attacker ${i + 1}`}
          />
          <IconButton size="sm" onClick={() => removeFromList("attack", attack, i)}>&#10005;</IconButton>
        </div>
      ))}

      <div className={s.listHeader}>
        <span className={s.listLabel}>Defenders</span>
        <Button variant="ghost" size="sm" onClick={() => addToList("defense", defense)}>+ Add</Button>
      </div>
      {defense.map((id, i) => (
        <div key={i} className={s.formRow}>
          <Select
            value={id}
            onValueChange={(v) => updateList("defense", defense, i, v)}
            options={armyOptions}
            placeholder={`Defender ${i + 1}`}
          />
          <IconButton size="sm" onClick={() => removeFromList("defense", defense, i)}>&#10005;</IconButton>
        </div>
      ))}
    </div>
  );
};
