import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSetNicknameAction, TStartGameAction } from "../../domain/registry";

type TMainMenuRegistrySlice = {
  setNicknameAction: TSetNicknameAction;
  startGameAction: TStartGameAction;
};

type TMainMenuPageProps = {
  registry: TMainMenuRegistrySlice;
};

/** The nickname is also the world seed, so the same name grows the same island. */
const MainMenuPage: FC<TMainMenuPageProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const nickname = store.game.nickname.value;

  return (
    <div className="main-menu">
      <h1 className="main-menu__title">
        {"Toxic Island"}
      </h1>

      <p className="main-menu__subtitle">
        {"Прототип фазы строительства"}
      </p>

      <form
        className="panel main-menu__form"
        onSubmit={(event) => {
          event.preventDefault();
          registry.startGameAction();
        }}
      >
        <label className="main-menu__label" htmlFor="nickname">
          {"Ник игрока"}
        </label>

        <input
          id="nickname"
          className="main-menu__input"
          value={nickname}
          onChange={(event) => registry.setNicknameAction(event.target.value)}
        />

        <button type="submit" className="button button--primary">
          {"Начать игру"}
        </button>
      </form>
    </div>
  );
};

export { MainMenuPage };
