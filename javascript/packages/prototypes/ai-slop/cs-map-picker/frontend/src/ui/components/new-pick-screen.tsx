import { useState } from "react";
import type { FC, FormEvent } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import type { TAppRegistry } from "../../domain/registry";
import type { TFormat } from "../../domain/types";
import { useStore } from "../../store/store";
import { FORMAT_LABEL } from "../labels";
import { Roster } from "./roster";

type TNewPickScreenProps = {
  registry: TAppRegistry;
};

const FORMAT_HINT: Record<TFormat, string> = {
  bo1: "Семь банов по очереди. Последняя карта — игровая.",
  bo3: "Бан, бан, пик, пик, бан, бан, бан. Последняя карта — решающая.",
};

const NewPickScreen: FC<TNewPickScreenProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const meta = store.meta.value;
  const [format, setFormat] = useState<TFormat>("bo1");
  const [teamA, setTeamA] = useState("");
  const [teamB, setTeamB] = useState("");

  if (!meta) {
    return <div className="panel muted">Загрузка…</div>;
  }

  const teamById = new Map(meta.teams.map((team) => [team.id, team]));
  const canSubmit = teamA && teamB && teamA !== teamB && !store.formBusy.value;

  const submit = (event: FormEvent) => {
    event.preventDefault();
    if (canSubmit) {
      void registry.createPick(format, teamA, teamB);
    }
  };

  const teamSelect = (label: string, value: string, onChange: (id: string) => void, other: string) => {
    const team = teamById.get(value);
    return (
      <label className="field">
        <span>{label}</span>
        <select value={value} onChange={(event) => onChange(event.target.value)}>
          <option value="">Выбери команду</option>
          {meta.teams.map((option) => (
            <option key={option.id} value={option.id} disabled={option.id === other}>
              {option.name}
            </option>
          ))}
        </select>
        {team && <Roster team={team} />}
      </label>
    );
  };

  return (
    <form className="panel form" onSubmit={submit}>
      <h1>Новые пики</h1>

      <div className="field">
        <span>Формат</span>
        <div className="segmented">
          {meta.formats.map((option) => (
            <button
              key={option}
              type="button"
              className={option === format ? "segment segment-active" : "segment"}
              onClick={() => setFormat(option)}
            >
              {FORMAT_LABEL[option]}
            </button>
          ))}
        </div>
        <span className="muted small">{FORMAT_HINT[format]}</span>
      </div>

      <div className="team-pickers">
        {teamSelect("Твоя команда", teamA, setTeamA, teamB)}
        {teamSelect("Соперник", teamB, setTeamB, teamA)}
      </div>

      {store.formError.value && <div className="error">{store.formError.value}</div>}

      <div className="form-actions">
        <button type="button" className="button" onClick={() => registry.navigate({ name: "home" })}>
          Назад
        </button>
        <button type="submit" className="button button-primary" disabled={!canSubmit}>
          Создать и получить код
        </button>
      </div>
    </form>
  );
};

export { NewPickScreen };
