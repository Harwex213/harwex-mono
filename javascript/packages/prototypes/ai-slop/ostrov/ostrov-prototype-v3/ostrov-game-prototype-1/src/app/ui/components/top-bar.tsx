import { forecastIncome, TECH_BY_ID } from "../../../core/exports";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TPlayerId } from "../../../core/exports";
import type { TEndTurnAction, TNewGameAction, TSetActivePlayerAction, TSetSeedTextAction } from "../../domain/registry";

type TTopBarRegistrySlice = {
  setActivePlayerAction: TSetActivePlayerAction;
  endTurnAction: TEndTurnAction;
  setSeedTextAction: TSetSeedTextAction;
  newGameAction: TNewGameAction;
};

type TTopBarProps = {
  registry: TTopBarRegistrySlice;
};

const PHASE_LABELS = {
  planning: "Планирование",
  curtain: "Ход мира",
  battle: "Бой",
  ended: "Партия окончена",
} as const;

const signed = (value: number) => (value >= 0 ? `+${value}` : `${value}`);

const Seat: FC<{ player: TPlayerId; registry: TTopBarRegistrySlice }> = ({ player, registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const state = game.players[player];
  const active = store.ui.activePlayer.value === player;
  const income = forecastIncome(game, player);
  const canEnd = game.phase === "planning" && !state.defeated;

  return (
    <div
      className={`seat ${active ? "seat--active" : ""} ${state.defeated ? "seat--defeated" : ""}`}
      style={{ "--accent": state.accent } as React.CSSProperties}
    >
      <button className="seat__name" onClick={() => registry.setActivePlayerAction(player)} title="Сделать активным игроком">
        <span className="seat__dot" />
        {state.name}
        {state.defeated ? " · разгромлен" : ""}
      </button>

      <div className="res">
        <span className="res__chip" title="Производство: скорость строек и обучения">
          <b>⚙ {state.production}</b>
          <i>{signed(income.production)}</i>
        </span>
        <span className="res__chip" title="Еда: рост населения в поселениях">
          <b>✿ {state.food}</b>
          <i>{signed(income.food)}</i>
        </span>
        <span className="res__chip" title="Металлы: формирование армий">
          <b>⛏ {state.metals}</b>
          <i>{signed(income.metals)}</i>
        </span>
        <span className="res__chip" title="Население: расходуется на юнитов, каждые 4 жителя дают +1 производства">
          <b>☺ {state.population}</b>
          <i>{signed(income.population)}</i>
        </span>
      </div>

      <button
        className={`btn ${state.ready ? "btn--ready" : "btn--primary"}`}
        disabled={!canEnd || !active}
        onClick={registry.endTurnAction}
        title={active ? "" : "Сначала переключитесь на этого игрока"}
      >
        {state.ready ? "✓ Ход завершён" : "Завершить ход"}
      </button>
    </div>
  );
};

const TopBar: FC<TTopBarProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const research = game.research;
  const current = research.current === null ? null : TECH_BY_ID[research.current]!;
  const seedText = store.ui.seedText.value;

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__title">Остров</div>
        <div className="topbar__turn">
          Ход {game.turn} · {PHASE_LABELS[game.phase]}
        </div>
      </div>

      <Seat player="p1" registry={registry} />
      <Seat player="p2" registry={registry} />

      <div className="science" title="Наука общая на двух игроков">
        <div className="science__label">
          ✧ Наука · {current === null ? `в запасе ${research.banked}` : current.name}
        </div>
        <div className="bar">
          <div
            className="bar__fill bar__fill--science"
            style={{ width: current === null ? "0%" : `${Math.min(100, (research.progress / current.cost) * 100)}%` }}
          />
        </div>
        <div className="science__sub">{current === null ? "Выберите технологию во вкладке «Технологии»" : `${research.progress} / ${current.cost}`}</div>
      </div>

      <div className="seed">
        <input className="seed__input" value={seedText} onChange={(event) => registry.setSeedTextAction(event.target.value)} aria-label="Зерно мира" />
        <button className="btn" onClick={registry.newGameAction}>
          {"Новый мир"}
        </button>
      </div>
    </header>
  );
};

export { TopBar };
