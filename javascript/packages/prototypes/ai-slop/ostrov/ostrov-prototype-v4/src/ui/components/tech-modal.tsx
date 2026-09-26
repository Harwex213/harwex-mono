import { useSignals } from "@preact/signals-react/runtime";
import { useEffect } from "react";
import { TECHS, TECH_ORDER, computeTaxYields, isTechAvailable } from "../../core/exports";
import { RESOURCE_GLYPHS } from "./hex-popup";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TTechId } from "../../core/exports";
import type { TCloseTechModalAction, TSetResearchTargetAction } from "../../domain/registry";

/**
 * The full-screen technologies modal of plan §3.2 and §3.3: one card per tech,
 * one tech in research at a time, prerequisites written out as a "требует"
 * line instead of drawn arrows. `Esc` and the X close it.
 */

type TTechModalRegistrySlice = {
  closeTechModal: TCloseTechModalAction;
  setResearchTarget: TSetResearchTargetAction;
};

type TTechModalProps = {
  registry: TTechModalRegistrySlice;
};

const TITLE_RU = "Технологии";
const CLOSE_LABEL = "×";
const REQUIRES_RU = "требует";
const RESEARCHED_RU = "Изучено";
const LOCKED_RU = "Недоступно";
const ACTIVE_RU = "В исследовании";
const AVAILABLE_RU = "Доступно";
const SCIENCE_HINT_RU = "Наука за ход";
const NO_SCIENCE_RU = "нет производства науки";

/** One of the four card states, as the class modifier and the caption both name it. */
const cardStateOf = (
  tech: TTechId,
  researched: readonly TTechId[],
): "researched" | "available" | "locked" => {
  if (researched.includes(tech) === true) {
    return "researched";
  }

  if (isTechAvailable(tech, researched) === true) {
    return "available";
  }

  return "locked";
};

const STATE_CAPTIONS_RU: Readonly<Record<"researched" | "available" | "locked", string>> = {
  researched: RESEARCHED_RU,
  available: AVAILABLE_RU,
  locked: LOCKED_RU,
};

const TechModal: FC<TTechModalProps> = ({ registry }) => {
  useSignals();

  const store = useStore();
  const open = store.ui.techModalOpen.value;

  useEffect(() => {
    if (open === false) {
      return;
    }

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Escape") {
        return;
      }

      registry.closeTechModal();
    };

    document.addEventListener("keydown", onKeyDown);

    return () => {
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open, registry]);

  if (open === false) {
    return null;
  }

  const researched = store.game.researched.value;
  const researching = store.game.researching.value;
  const progress = store.game.researchProgress.value;
  const island = store.derived.viewedIsland.value;
  const insane = store.game.resources.value.insane;
  const sciencePerTurn = island === null
    ? 0
    : computeTaxYields(island, researched, insane).reduce((total, entry) => {
      return entry.resource === "science" ? total + entry.amount : total;
    }, 0);

  return (
    <div className="tech-modal" role="dialog" aria-label={TITLE_RU}>
      <div className="tech-modal__header">
        <h2 className="tech-modal__title">
          {TITLE_RU}
        </h2>

        <div className="tech-modal__science">
          {sciencePerTurn === 0
            ? `${RESOURCE_GLYPHS.science} ${NO_SCIENCE_RU}`
            : `${RESOURCE_GLYPHS.science} ${SCIENCE_HINT_RU}: ${sciencePerTurn}`}
        </div>

        <button
          type="button"
          className="tech-modal__close"
          aria-label="Закрыть"
          onClick={() => registry.closeTechModal()}
        >
          {CLOSE_LABEL}
        </button>
      </div>

      <div className="tech-modal__grid">
        {TECH_ORDER.map((tech) => {
          const info = TECHS[tech];
          const state = cardStateOf(tech, researched);
          const active = researching === tech;
          const gained = progress[tech] ?? 0;
          const className = active
            ? `tech-card tech-card--${state} tech-card--active`
            : `tech-card tech-card--${state}`;

          return (
            <button
              key={tech}
              type="button"
              className={className}
              data-tech={tech}
              onClick={() => registry.setResearchTarget(tech)}
            >
              <span className="tech-card__name">
                {info.nameRu}
              </span>

              <span className="tech-card__cost">
                {`${RESOURCE_GLYPHS.science} ${info.cost}`}
              </span>

              <span className="tech-card__progress">
                {`${gained} / ${info.cost}`}
              </span>

              <span className="tech-card__description">
                {info.descriptionRu}
              </span>

              {info.requires.length === 0 ? null : (
                <span className="tech-card__requires">
                  {`${REQUIRES_RU}: ${info.requires.map((required) => TECHS[required].nameRu).join(", ")}`}
                </span>
              )}

              <span className="tech-card__state">
                {active ? ACTIVE_RU : STATE_CAPTIONS_RU[state]}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};

export type { TTechModalRegistrySlice };
export { TechModal };
