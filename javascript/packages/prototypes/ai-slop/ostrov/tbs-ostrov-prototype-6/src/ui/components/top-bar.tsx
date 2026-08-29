import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { TPhase } from "../../store/store";

const PHASE_LABEL: Record<TPhase, string> = {
  prep: "Расстановка",
  battle: "Бой",
  result: "Итог раунда",
  over: "Остров пал",
};

const TopBar = () => {
  useSignals();
  const store = useStore();

  return (
    <div className="stats">
      <div className="stat">
        <span className="stat__label">
          {"Раунд"}
        </span>

        <span className="stat__value">
          {store.metaState.round.value}
        </span>
      </div>

      <div className="stat">
        <span className="stat__label">
          {"Золото"}
        </span>

        <span className="stat__value stat__value--gold">
          {store.metaState.gold.value}
        </span>
      </div>

      <div className="stat">
        <span className="stat__label">
          {"Прочность"}
        </span>

        <span className="stat__value stat__value--lives">
          {store.metaState.lives.value}
        </span>
      </div>

      <div className="stat">
        <span className="stat__label">
          {"Побед"}
        </span>

        <span className="stat__value">
          {store.metaState.wins.value}
        </span>
      </div>

      <div className="stat stat--wide">
        <span className="stat__label">
          {"Фаза"}
        </span>

        <span className="stat__value">
          {PHASE_LABEL[store.metaState.phase.value]}
        </span>
      </div>
    </div>
  );
};

export { PHASE_LABEL, TopBar };
