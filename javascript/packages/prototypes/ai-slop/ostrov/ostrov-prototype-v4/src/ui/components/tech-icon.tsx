import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TOpenTechModalAction } from "../../domain/registry";

/**
 * The purple flask of `01-spec-image-5.png`, bottom slot of the tools column,
 * directly under the pickaxe. The column itself is hidden on a foreign island,
 * so the button needs no readonly branch of its own.
 */

type TTechIconRegistrySlice = {
  openTechModal: TOpenTechModalAction;
};

type TTechIconProps = {
  registry: TTechIconRegistrySlice;
};

const TECH_GLYPH = "🧪";
const TECH_LABEL_RU = "Технологии";

const TechIcon: FC<TTechIconProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const researching = store.game.researching.value;

  return (
    <button
      type="button"
      className={researching === null ? "tech-icon" : "tech-icon tech-icon--researching"}
      title={TECH_LABEL_RU}
      onClick={() => registry.openTechModal()}
    >
      <span className="tech-icon__glyph">
        {TECH_GLYPH}
      </span>

      <span className="tech-icon__label">
        {TECH_LABEL_RU}
      </span>
    </button>
  );
};

export type { TTechIconRegistrySlice };
export { TechIcon };
