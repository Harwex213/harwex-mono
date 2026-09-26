import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TNavigateAction, TStartGameAction } from "../../domain/registry";

type TMainMenuPageRegistrySlice = {
  navigate: TNavigateAction;
  startGame: TStartGameAction;
};

type TMainMenuPageProps = {
  registry: TMainMenuPageRegistrySlice;
};

const DEFAULT_NICKNAME = "Игрок";

const NICKNAME_MAX_LENGTH = 24;

const SUBTITLE_RU = "Летающий остров, четыре фазы за ход и токсичность, которая сводит население с ума";

const MainMenuPage: FC<TMainMenuPageProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const started = store.game.started.value;

  const [nickname, setNickname] = useState<string>(DEFAULT_NICKNAME);

  const start = () => {
    registry.startGame(nickname);
  };

  return (
    <div className="page page--menu menu">
      <h1 className="menu__title">
        {"Toxic Island"}
      </h1>

      <p className="menu__subtitle">
        {SUBTITLE_RU}
      </p>

      <label className="menu__field">
        <span className="menu__label">
          {"Ник"}
        </span>

        <input
          className="menu__input"
          type="text"
          value={nickname}
          maxLength={NICKNAME_MAX_LENGTH}
          onChange={(event) => setNickname(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              start();
            }
          }}
        />
      </label>

      <div className="menu__actions">
        <button type="button" className="menu__button menu__button--primary" onClick={start}>
          {"Начать"}
        </button>

        {started ? (
          <button type="button" className="menu__button" onClick={() => registry.navigate("island")}>
            {"Продолжить"}
          </button>
        ) : null}
      </div>
    </div>
  );
};

export type { TMainMenuPageRegistrySlice };
export { MainMenuPage };
