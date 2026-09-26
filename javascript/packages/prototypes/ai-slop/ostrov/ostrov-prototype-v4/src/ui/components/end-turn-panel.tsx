import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TPhase } from "../../core/exports";
import type { TEndTurnAction } from "../../domain/registry";

/**
 * The round medallion of `01-spec-image-2.png`, drawn in CSS: a gold ring, a
 * dark centre, four quadrant glyphs split by an X and a banner above. It is the
 * only phase-advance control, and `Space` and `Enter` are bound to it.
 */

type TEndTurnPanelRegistrySlice = {
  endTurn: TEndTurnAction;
};

type TEndTurnPanelProps = {
  registry: TEndTurnPanelRegistrySlice;
};

/** What the button promises to do next, per plan §3.2. */
const PHASE_BUTTON_LABELS_RU: Readonly<Record<TPhase, string>> = {
  build: "Собрать налоги",
  tax: "В разведку",
  exploration: "Зачистка",
  clearing: "Следующий ход",
};

/** Hammer, skull, sword and wheat, the four quadrants of the reference medallion. */
const QUADRANT_GLYPHS: readonly string[] = ["⚒", "💀", "⚔", "🌾"];

const isTypingTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }

  if (target.isContentEditable) {
    return true;
  }

  return ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
};

const EndTurnPanel: FC<TEndTurnPanelProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const phase = store.game.phase.value;
  const busy = store.game.busy.value;

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== " " && event.key !== "Enter") {
        return;
      }

      if (isTypingTarget(event.target)) {
        return;
      }

      event.preventDefault();

      // The action itself refuses while the game is busy, so the shortcut needs no guard.
      registry.endTurn();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [registry]);

  return (
    <div className="panel end-turn-panel">
      <div className="end-turn-panel__banner">
        {PHASE_BUTTON_LABELS_RU[phase]}
      </div>

      <button
        type="button"
        className="end-turn-panel__medallion"
        disabled={busy}
        title={PHASE_BUTTON_LABELS_RU[phase]}
        onClick={() => registry.endTurn()}
      >
        <span className="end-turn-panel__cross" />

        {QUADRANT_GLYPHS.map((glyph, index) => {
          return (
            <span key={glyph} className={`end-turn-panel__quadrant end-turn-panel__quadrant--${index}`}>
              {glyph}
            </span>
          );
        })}
      </button>
    </div>
  );
};

export type { TEndTurnPanelRegistrySlice };
export { EndTurnPanel, PHASE_BUTTON_LABELS_RU };
