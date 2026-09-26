import { useSignals } from "@preact/signals-react/runtime";
import { getTech, isAvailable, TECHS } from "../../core/techs";
import { getUnit } from "../../core/units";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TTechBranch } from "../../core/techs";
import type { TCloseTechModalAction, TResearchTechAction } from "../../domain/registry";

const BRANCH_LABELS: Readonly<Record<TTechBranch, string>> = {
  military: "Война",
  economy: "Хозяйство",
  ecology: "Экология",
};

type TTechModalRegistrySlice = {
  closeTechModalAction: TCloseTechModalAction;
  researchTechAction: TResearchTechAction;
};

type TTechModalProps = {
  registry: TTechModalRegistrySlice;
};

/**
 * The spec leaves the technology screen blank, so this tree is invented. Every
 * technology pays out into a phase that exists: units for the clearing phase,
 * a discount for the build phase, cleaner air for the tax phase.
 */
const TechModal: FC<TTechModalProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const researched = store.game.researched.value;
  const science = store.derived.humanPlayer.value?.resources.science ?? 0;

  if (!store.ui.techModalOpen.value) {
    return null;
  }

  const owned = new Set(researched);

  return (
    <div className="modal-backdrop" onClick={registry.closeTechModalAction}>
      <div className="panel modal modal--wide" onClick={(click) => click.stopPropagation()}>
        <h2 className="modal__title">
          {`Технологии — 📖 ${science}`}
        </h2>

        <div className="tech-grid">
          {(Object.keys(BRANCH_LABELS) as TTechBranch[]).map((branch) => (
            <div className="tech-branch" key={branch}>
              <h3 className="tech-branch__title">
                {BRANCH_LABELS[branch]}
              </h3>

              {TECHS.filter((tech) => tech.branch === branch).map((tech) => {
                const isOwned = owned.has(tech.id);
                const available = isAvailable(tech, researched);
                const affordable = science >= tech.cost;

                return (
                  <button
                    type="button"
                    className={`tech-card ${isOwned ? "tech-card--owned" : ""} ${available ? "" : "tech-card--locked"}`}
                    key={tech.id}
                    disabled={isOwned || !available || !affordable}
                    onClick={() => registry.researchTechAction(tech.id)}
                  >
                    <span className="tech-card__head">
                      <span className="tech-card__label">
                        {tech.label}
                      </span>

                      <span className={affordable || isOwned ? "tech-card__cost" : "tech-card__cost cost--short"}>
                        {isOwned ? "изучено" : `📖 ${tech.cost}`}
                      </span>
                    </span>

                    <span className="tech-card__description">
                      {tech.description}
                    </span>

                    {tech.unlocks.length > 0 ? (
                      <span className="tech-card__unlocks">
                        {tech.unlocks.map((unitId) => `${getUnit(unitId).emoji} ${getUnit(unitId).label}`).join(", ")}
                      </span>
                    ) : null}

                    {tech.requires.length > 0 && !isOwned ? (
                      <span className="tech-card__requires">
                        {`Нужно: ${tech.requires.map((id) => getTech(id).label).join(", ")}`}
                      </span>
                    ) : null}
                  </button>
                );
              })}
            </div>
          ))}
        </div>

        <div className="modal__buttons">
          <button type="button" className="button" onClick={registry.closeTechModalAction}>
            {"Закрыть"}
          </button>
        </div>
      </div>
    </div>
  );
};

export { TechModal };
