import { useSignals } from "@preact/signals-react/runtime";
import { isAvailable } from "../../domain/tech/empire";
import { layoutOf } from "../../domain/tech/layout";
import { BRANCH_LABEL, techOf } from "../../domain/tech/tech-tree";
import { createViewport, radiusOf, toCanvas } from "../render/snowflake-renderer";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TAppRegistry } from "../../domain/registry";
import type { TEffect } from "../../domain/tech/types";

type TTechPopupProps = {
  registry: TAppRegistry;
};

const POPUP_WIDTH = 300;
const POPUP_GAP = 16;

const EFFECT_KIND_LABEL: Record<TEffect["kind"], string> = {
  unlockBuilding: "Постройка",
  unlockUnit: "Юнит",
  improveBuilding: "Улучшение постройки",
  improveUnit: "Улучшение юнита",
};

const describeEffect = (effect: TEffect): string => {
  switch (effect.kind) {
    case "unlockBuilding":
    case "unlockUnit":
      return effect.target;
    case "improveBuilding":
    case "improveUnit":
      return `${effect.target} — ${effect.note}`;
  }
};

const TechPopup: FC<TTechPopupProps> = ({ registry }) => {
  useSignals();
  const store = useStore();

  const selectedId = store.viewState.selectedId.value;
  if (!selectedId) {
    return null;
  }

  const tech = techOf(selectedId);
  const researched = store.techState.researched.value;
  const learning = store.techState.learning.value;
  const done = researched.includes(tech.id);
  const available = isAvailable(tech.id, researched);
  const isLearningThis = learning?.techId === tech.id;
  const missing = tech.requires.filter((requirement) => !researched.includes(requirement));

  // Anchor to the node through the same viewport the canvas draws with.
  const size = store.viewState.canvasSize.value;
  const viewport = createViewport(size.width, size.height, store.viewState.camera.value);
  const center = toCanvas(viewport, layoutOf(tech.id).point);
  const radius = radiusOf(tech) * viewport.scale;
  const placeLeft = center.x + radius + POPUP_GAP + POPUP_WIDTH > size.width;
  const left = placeLeft ? center.x - radius - POPUP_GAP - POPUP_WIDTH : center.x + radius + POPUP_GAP;
  const top = Math.min(Math.max(8, center.y - 40), Math.max(8, size.height - 260));

  return (
    <div className="popup" style={{ left, top, width: POPUP_WIDTH }}>
      <header className="popup__header">
        <span className="popup__icon">
          {tech.icon}
        </span>

        <div className="popup__heading">
          <h2 className="popup__title">
            {tech.name}
          </h2>

          <span className={`popup__branch popup__branch--${tech.branch}`}>
            {BRANCH_LABEL[tech.branch]}
          </span>
        </div>

        <button type="button" className="popup__close" aria-label="Закрыть" onClick={() => registry.selectTechAction(null)}>
          {"×"}
        </button>
      </header>

      <p className="popup__description">
        {tech.description}
      </p>

      <ul className="effects">
        {tech.effects.map((effect, index) => (
          <li key={index} className={`effect effect--${effect.kind}`}>
            <span className="effect__kind">
              {EFFECT_KIND_LABEL[effect.kind]}
            </span>

            <span className="effect__text">
              {describeEffect(effect)}
            </span>
          </li>
        ))}
      </ul>

      {done ? (
        <p className="popup__status popup__status--done">
          {"Изучено"}
        </p>
      ) : isLearningThis ? (
        <p className="popup__status">
          {"Изучается…"}
        </p>
      ) : available ? (
        <button
          type="button"
          className="button button--primary"
          disabled={learning !== null}
          onClick={() => registry.startLearningAction(tech.id)}
        >
          {"Начать изучение"}
        </button>
      ) : (
        <p className="popup__status">
          {`Сначала изучите: ${missing.map((id) => techOf(id).name).join(", ")}`}
        </p>
      )}
    </div>
  );
};

export { TechPopup };
