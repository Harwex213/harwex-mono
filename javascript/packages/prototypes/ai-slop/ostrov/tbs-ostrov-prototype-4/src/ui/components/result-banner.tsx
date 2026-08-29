import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { TRandomizeSeedAction } from "../../domain/registry";
import type { FC } from "react";

type TResultBannerRegistrySlice = {
  randomizeSeedAction: TRandomizeSeedAction;
};

type TResultBannerProps = {
  registry: TResultBannerRegistrySlice;
};

const ResultBanner: FC<TResultBannerProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const outcome = store.gameState.outcome.value;
  const turn = store.gameState.turn.value;
  if (outcome === "playing") {
    return null;
  }

  return (
    <div className={`result result--${outcome}`}>
      <p className="result__title">
        {outcome === "won" ? "Остров очищен" : "Остров потерян"}
      </p>
      <p className="result__detail">
        {outcome === "won"
          ? `Лагерь клана сожжён на ходу ${turn}.`
          : `Столица пала на ходу ${turn}.`}
      </p>
      <button type="button" className="button button--primary" onClick={registry.randomizeSeedAction}>
        {"Новый остров"}
      </button>
    </div>
  );
};

export { ResultBanner };
