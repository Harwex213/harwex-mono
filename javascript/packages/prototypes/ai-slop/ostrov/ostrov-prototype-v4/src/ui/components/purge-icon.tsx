import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TTechId } from "../../core/exports";
import type { TTogglePurgeAction } from "../../domain/registry";

/**
 * The third slot of the tools column, under the technologies flask. It is the
 * only action a technology hands the player, so the button appears only once
 * «Ритуал очищения» is researched (plan §3.3).
 */

type TPurgeIconRegistrySlice = {
  togglePurge: TTogglePurgeAction;
};

type TPurgeIconProps = {
  registry: TPurgeIconRegistrySlice;
};

const PURGE_TECH: TTechId = "purge_ritual";
const PURGE_GLYPH = "💠";
const PURGE_LABEL_RU = "Очистить";
const PURGE_TITLE_RU = "Ритуал очищения: 5 💠 → −20 ☣️ с гекса";

const PurgeIcon: FC<TPurgeIconProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const researched = store.game.researched.value;
  const active = store.ui.purgeMode.value;

  if (researched.includes(PURGE_TECH) === false) {
    return null;
  }

  return (
    <button
      type="button"
      className={active ? "purge-icon purge-icon--active" : "purge-icon"}
      title={PURGE_TITLE_RU}
      aria-pressed={active}
      onClick={() => registry.togglePurge()}
    >
      <span className="purge-icon__glyph">
        {PURGE_GLYPH}
      </span>

      <span className="purge-icon__label">
        {PURGE_LABEL_RU}
      </span>
    </button>
  );
};

export type { TPurgeIconRegistrySlice };
export { PurgeIcon };
