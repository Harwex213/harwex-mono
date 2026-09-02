import { useEffect } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TCurtainAdvanceAction, TCurtainCloseAction } from "../../domain/registry";

/** Pause between two curtain lines. */
const LINE_DELAY = 650;

/** How long the finished list stays before the curtain lifts by itself. */
const CLOSE_DELAY = 1600;

type TTurnCurtainRegistrySlice = {
  curtainAdvanceAction: TCurtainAdvanceAction;
  curtainCloseAction: TCurtainCloseAction;
};

type TTurnCurtainProps = {
  registry: TTurnCurtainRegistrySlice;
};

/**
 * The "world is alive" moment between two turns: the lines of the resolved turn
 * appear one by one, phantom events mixed with real ones.
 */
const TurnCurtain: FC<TTurnCurtainProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const shown = store.ui.curtainShown.value;
  const lines = game.curtainLines;
  const open = game.phase === "curtain";

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    if (shown < lines.length) {
      const timer = setTimeout(registry.curtainAdvanceAction, LINE_DELAY);

      return () => clearTimeout(timer);
    }

    const timer = setTimeout(registry.curtainCloseAction, CLOSE_DELAY);

    return () => clearTimeout(timer);
  }, [open, shown, lines.length, registry]);

  if (!open) {
    return null;
  }

  return (
    <div className="overlay overlay--curtain">
      <div className="curtain">
        <div className="curtain__title">Ход {game.turn - 1} → {game.turn}</div>
        <ul className="curtain__lines">
          {lines.slice(0, shown).map((line, index) => (
            <li key={index} className={`curtain__line ${index === 0 ? "curtain__line--head" : ""}`}>
              {line}
            </li>
          ))}
          {shown < lines.length ? <li className="curtain__line curtain__line--pending">…</li> : null}
        </ul>
        <button className="btn" onClick={registry.curtainCloseAction}>
          {shown < lines.length ? "Пропустить" : "Продолжить"}
        </button>
      </div>
    </div>
  );
};

export { TurnCurtain };
