import { BattleModal } from "./components/battle-modal";
import { SidePanel } from "./components/side-panel";
import { TopBar } from "./components/top-bar";
import { TurnCurtain } from "./components/turn-curtain";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../store/store";
import { WorldMap } from "./components/world-map";
import type { FC } from "react";
import type { TAppRegistry } from "../domain/registry";

type TAppProps = {
  registry: TAppRegistry;
};

const EndOverlay: FC<{ registry: TAppRegistry }> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;

  if (game.phase !== "ended") {
    return null;
  }

  const victory = game.result === "victory";

  return (
    <div className="overlay">
      <div className={`end ${victory ? "end--victory" : "end--defeat"}`}>
        <div className="end__title">{victory ? "Победа" : "Поражение"}</div>
        <p className="end__text">
          {victory
            ? `Ядро Цитадели Нексус пало на ходу ${game.turn}. Два племени прошли путь от глины до плазмы.`
            : `Оба Центра Власти уничтожены на ходу ${game.turn}. Острова забудут ваши имена.`}
        </p>
        <button className="btn btn--primary" onClick={registry.newGameAction}>
          {"Новая партия"}
        </button>
      </div>
    </div>
  );
};

const App: FC<TAppProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const hint = store.ui.hint.value;

  return (
    <div className="app">
      <TopBar registry={registry} />

      <div className="app__main">
        <div className="app__map">
          <WorldMap registry={registry} />
          {hint !== null ? <div className="hint">{hint}</div> : null}
        </div>

        <SidePanel registry={registry} />
      </div>

      <TurnCurtain registry={registry} />
      <BattleModal registry={registry} />
      <EndOverlay registry={registry} />
    </div>
  );
};

export { App };
