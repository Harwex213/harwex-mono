import { config } from "@hw/ostrov-prototype-v2-config";
import { useSignals } from "@preact/signals-react/runtime";
import { useState } from "react";
import { hexKey } from "../hex/coords";
import { armyLimit } from "../state/army";
import type { Barracks } from "../state/barracks";
import {
  armyPlanned,
  barracksVersion,
  barracksView,
  cancelTraining,
  enqueueTraining,
  repeatsOn,
  selectedBarracks,
  toggleRepeat,
  trainRefusal,
} from "../state/barracks";
import { stock } from "../state/resources";
import { armyUsed } from "../state/units";
import { TRAIN_TIME_SPEEDUP } from "../tuning";
import type { UnitId } from "../units/catalog";
import { allUnitIds, trainingSeconds, unitPrice, unitSpec } from "../units/catalog";
import { RepeatIcon, ResourceIcon, UnitGlyph } from "./glyphs";
import { Tooltip } from "./Tooltip";

/**
 * The barracks: what it can train, what it is training, and what it is told to
 * keep training.
 *
 * It opens on a click on a barracks and closes the moment the player clicks
 * anywhere else, because it hangs off the selected hex and nothing else. Opening
 * the build menu drops that selection, so the two panels are never up together.
 *
 * The layout follows the build menu rather than inventing a second language: one
 * icon tile per unit, the price in the same icons the treasury counts in, and
 * everything else — the numbers, the role, the training time — in a tooltip that
 * opens with no delay. The repeat toggle sits against the tile it repeats.
 */

/** `25` → `0:25`. The panel shows the designer's number, not the sped-up one. */
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

type HoverTarget = {
  id: UnitId;
  rect: DOMRect;
};

/** Everything about one unit that does not fit on its tile. */
function UnitTip({ target }: { target: HoverTarget }): React.JSX.Element {
  useSignals();
  const spec = unitSpec(target.id);
  const held = stock.value;

  return (
    <Tooltip anchor={target.rect} side="above">
      <span className="tip-name">{spec.label}</span>
      <span className="tip-costs">
        {spec.costFood > 0 ? (
          <span className="tip-cost" data-short={held.food < spec.costFood}>
            <ResourceIcon kind="food" />
            {spec.costFood}
          </span>
        ) : null}
        {spec.costWood > 0 ? (
          <span className="tip-cost" data-short={held.wood < spec.costWood}>
            <ResourceIcon kind="wood" />
            {spec.costWood}
          </span>
        ) : null}
        {spec.costGold > 0 ? (
          <span className="tip-cost" data-short={held.gold < spec.costGold}>
            <ResourceIcon kind="gold" />
            {spec.costGold}
          </span>
        ) : null}
        <span className="tip-cost">
          <ResourceIcon kind="time" />
          {formatTime(spec.trainTimeSec)}
        </span>
      </span>
      <span className="tip-stats">
        <span>Здоровье {spec.maxHp}</span>
        <span>Урон {spec.damage}</span>
        <span>Скорость {spec.attackSpeed}/с</span>
        <span>Дальность {spec.attackRangeHex}</span>
      </span>
      <span className="tip-desc">{spec.description}</span>
    </Tooltip>
  );
}

type RowProps = {
  record: Barracks;
  id: UnitId;
  onHover: (target: HoverTarget | null) => void;
};

/** One trainable unit: the tile that orders it and the toggle that repeats it. */
function UnitRow({ record, id, onHover }: RowProps): React.JSX.Element {
  useSignals();
  const spec = unitSpec(id);
  const price = unitPrice(id);
  const held = stock.value;
  const refusal = trainRefusal(record, id);
  const repeating = repeatsOn(record.key, id);

  const show = (event: React.PointerEvent<HTMLElement> | React.FocusEvent<HTMLElement>): void => {
    onHover({ id, rect: event.currentTarget.getBoundingClientRect() });
  };

  return (
    <div className="unit-row">
      <button
        type="button"
        className="build-tile unit-tile"
        aria-label={`Нанять: ${spec.label}`}
        data-affordable={refusal === ""}
        onClick={() => enqueueTraining(record.key, id, performance.now())}
        onPointerEnter={show}
        onFocus={show}
        onPointerLeave={() => onHover(null)}
        onBlur={() => onHover(null)}
      >
        <UnitGlyph id={id} />
      </button>
      <div className="unit-meta">
        <span className="unit-name">{spec.label}</span>
        <span className="tip-costs">
          {(price.food ?? 0) > 0 ? (
            <span className="tip-cost" data-short={held.food < (price.food ?? 0)}>
              <ResourceIcon kind="food" />
              {price.food}
            </span>
          ) : null}
          {(price.wood ?? 0) > 0 ? (
            <span className="tip-cost" data-short={held.wood < (price.wood ?? 0)}>
              <ResourceIcon kind="wood" />
              {price.wood}
            </span>
          ) : null}
          {(price.gold ?? 0) > 0 ? (
            <span className="tip-cost" data-short={held.gold < (price.gold ?? 0)}>
              <ResourceIcon kind="gold" />
              {price.gold}
            </span>
          ) : null}
          <span className="tip-cost">
            <ResourceIcon kind="time" />
            {formatTime(spec.trainTimeSec)}
          </span>
        </span>
      </div>
      <button
        type="button"
        className="repeat-toggle"
        aria-pressed={repeating}
        aria-label={`Повтор: ${spec.label}`}
        title="Нанимать без остановки"
        onClick={() => toggleRepeat(record.key, id)}
      >
        <RepeatIcon />
      </button>
    </div>
  );
}

/**
 * The queue: the order in training with its bar, and the ones behind it.
 *
 * The bar is a CSS animation whose duration is the training time and whose key
 * is the order's own id, so it runs by itself and this component never renders
 * per frame. Its length is the sped-up demo time, which is what the player is
 * actually waiting through.
 */
function Queue({ record }: { record: Barracks }): React.JSX.Element {
  const front = record.queue[0];
  if (!front) {
    return <p className="barracks-idle">Очередь пуста</p>;
  }
  const spec = unitSpec(front.unitId);
  const seconds = trainingSeconds(front.unitId);
  const started = front.startedAt ?? performance.now();
  // The bar picks up where the order actually is, which matters when the panel
  // is opened halfway through one.
  const elapsed = Math.max(0, (performance.now() - started) / 1000);

  return (
    <div className="barracks-queue">
      <div className="queue-head">
        <UnitGlyph id={front.unitId} />
        <span className="unit-name">{spec.label}</span>
        <button
          type="button"
          className="queue-cancel"
          aria-label="Отменить заказ"
          onClick={() => cancelTraining(record.key, front.id)}
        >
          ×
        </button>
      </div>
      <div className="queue-bar">
        <i
          key={front.id}
          style={{
            animationDuration: `${seconds}s`,
            animationDelay: `${-Math.min(elapsed, seconds)}s`,
          }}
        />
      </div>
      {record.queue.length > 1 ? (
        <div className="queue-rest">
          {record.queue.slice(1).map((entry) => (
            <button
              type="button"
              key={entry.id}
              className="queue-chip"
              aria-label={`Убрать из очереди: ${unitSpec(entry.unitId).label}`}
              onClick={() => cancelTraining(record.key, entry.id)}
            >
              <UnitGlyph id={entry.unitId} />
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function BarracksPanel(): React.JSX.Element | null {
  useSignals();
  const barracks = selectedBarracks.value;
  // Read so the panel re-renders when a queue, a repeat flag or a rally moves.
  barracksVersion.value;
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  if (!barracks) {
    return null;
  }
  const record = barracksView(hexKey(barracks.q, barracks.r));
  if (!record) {
    return null;
  }
  const used = armyUsed.value;
  const limit = armyLimit.value;
  const planned = armyPlanned();
  const full = planned >= limit;
  const moved = record.rally.q !== barracks.q || record.rally.r !== barracks.r;

  return (
    <aside className="barracks-panel" aria-label="Казарма">
      <header className="barracks-head">
        <h2>Казарма</h2>
        <span className="barracks-army" data-full={full}>
          Армия {used}/{limit}
        </span>
      </header>
      <div className="unit-rows">
        {allUnitIds().map((id) => (
          <UnitRow record={record} id={id} key={id} onHover={setHovered} />
        ))}
      </div>
      <Queue record={record} />
      {record.paused ? (
        <p className="barracks-warn">Повтор ждёт: {record.paused}</p>
      ) : null}
      <p className="barracks-hint">
        {moved ? "Точка сбора поставлена." : "Правый клик по гексу — точка сбора."}
        {` Найм ускорен ×${TRAIN_TIME_SPEEDUP}, очередь до ${config.army.queueLimit}.`}
      </p>
      {hovered ? <UnitTip target={hovered} /> : null}
    </aside>
  );
}

export { BarracksPanel };
