import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TNextRoundAction, TRestartGameAction } from "../../domain/registry";

type TResultBannerRegistrySlice = {
  nextRoundAction: TNextRoundAction;
  restartGameAction: TRestartGameAction;
};

type TResultBannerProps = {
  registry: TResultBannerRegistrySlice;
};

const TITLE = {
  player: "Победа",
  enemy: "Поражение",
  draw: "Ничья",
  running: "",
};

const ResultBanner: FC<TResultBannerProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const phase = store.metaState.phase.value;
  const outcome = store.battleState.outcome.value;

  if (phase !== "result" && phase !== "over") {
    return null;
  }

  const isOver = phase === "over";

  return (
    <div className="banner">
      <p className={outcome === "player" ? "banner__title banner__title--win" : "banner__title"}>
        {isOver ? "Остров пал" : TITLE[outcome ?? "draw"]}
      </p>

      <p className="banner__text">
        {isOver
          ? `Продержались ${store.metaState.round.value} раундов, побед: ${store.metaState.wins.value}`
          : `Раунд ${store.metaState.round.value} завершён`}
      </p>

      {isOver ? (
        <button className="button button--primary" type="button" onClick={() => registry.restartGameAction()}>
          {"Начать заново"}
        </button>
      ) : (
        <button className="button button--primary" type="button" onClick={() => registry.nextRoundAction()}>
          {"Следующий раунд"}
        </button>
      )}
    </div>
  );
};

export { ResultBanner };
