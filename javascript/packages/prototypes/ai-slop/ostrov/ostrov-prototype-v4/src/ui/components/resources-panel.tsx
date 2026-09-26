import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TResourceId } from "../../core/exports";
import type { TCalmAction } from "../../domain/registry";

/**
 * Ten counters in three columns, exactly the order of `01-spec-image-6.png`.
 * Each chip carries `data-resource`, because S5 measures the chips with
 * `getBoundingClientRect` to aim the tax-phase flights at them.
 */

type TResourcesPanelRegistrySlice = {
  calm: TCalmAction;
};

type TResourcesPanelProps = {
  registry: TResourcesPanelRegistrySlice;
};

type TResourceRow = {
  readonly id: TResourceId;
  readonly glyph: string;
  readonly labelRu: string;
  /** The modifier the value span carries: toxicity is green, the insane count pink. */
  readonly tone: "plain" | "toxic" | "insane";
};

const RESOURCE_ROWS: readonly TResourceRow[] = [
  { id: "food", glyph: "🍗", labelRu: "Еда", tone: "plain" },
  { id: "stone", glyph: "🪨", labelRu: "Камень", tone: "plain" },
  { id: "wood", glyph: "🪵", labelRu: "Дерево", tone: "plain" },
  { id: "population", glyph: "🧍", labelRu: "Население", tone: "plain" },
  { id: "hammers", glyph: "⚒️", labelRu: "Молотки", tone: "plain" },
  { id: "science", glyph: "📖", labelRu: "Наука", tone: "plain" },
  { id: "scouting", glyph: "🔭", labelRu: "Разведка", tone: "plain" },
  { id: "mana", glyph: "💠", labelRu: "Мана", tone: "plain" },
  { id: "toxicity", glyph: "☣️", labelRu: "Токсичность", tone: "toxic" },
  { id: "insane", glyph: "🤖", labelRu: "Сумасшедшие", tone: "insane" },
];

const CALM_LABEL_RU = "Успокоить (3 💠 + 2 🍗)";

const FRACTION_DIGITS = 1;

/**
 * The chip the tax animation is flashing right now. The insane counter gets the
 * red alarm, every other chip the plain gold pulse (S5).
 */
const pulseClassName = (resource: TResourceId, pulsed: TResourceId | null): string => {
  if (pulsed !== resource) {
    return "";
  }

  if (resource === "insane") {
    return " resource-chip--alarm";
  }

  return " resource-chip--pulse";
};

/** A whole number prints bare; a fraction prints to one decimal, as in the reference. */
const formatAmount = (amount: number): string => {
  if (!Number.isFinite(amount)) {
    return "0";
  }

  if (Number.isInteger(amount)) {
    return String(amount);
  }

  return amount.toFixed(FRACTION_DIGITS);
};

const ResourcesPanel: FC<TResourcesPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const resources = store.game.resources.value;
  const pulsed = store.anim.pulse.value;

  return (
    <div className="panel resources-panel">
      <div className="resources-panel__grid">
        {RESOURCE_ROWS.map((row) => {
          return (
            <div
              key={row.id}
              className={`resource-chip${pulseClassName(row.id, pulsed)}`}
              data-resource={row.id}
            >
              <span className="resource-chip__glyph">
                {row.glyph}
              </span>

              <span className={`resource-chip__value resource-chip__value--${row.tone}`}>
                {formatAmount(resources[row.id])}
              </span>

              <span className="resource-chip__label">
                {row.labelRu}
              </span>
            </div>
          );
        })}
      </div>

      <button
        type="button"
        className="resources-panel__calm"
        disabled={!Number.isFinite(resources.insane) || resources.insane === 0}
        onClick={() => registry.calm()}
      >
        {CALM_LABEL_RU}
      </button>
    </div>
  );
};

export type { TResourcesPanelRegistrySlice };
export { ResourcesPanel };
