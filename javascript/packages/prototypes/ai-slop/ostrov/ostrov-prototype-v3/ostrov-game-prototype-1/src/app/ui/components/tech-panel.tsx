import { BUILDING_DEFS, SQUAD_DEFS, TECH_BY_ID, TECH_DEFS, isKnown, isResearchable } from "../../../core/exports";
import { useSignals } from "@preact/signals-react/runtime";
import { useStore } from "../../store/store";
import type { FC } from "react";
import type { TSetResearchAction } from "../../domain/registry";

type TTechPanelRegistrySlice = {
  setResearchAction: TSetResearchAction;
};

type TTechPanelProps = {
  registry: TTechPanelRegistrySlice;
};

/** The shared tree, tier by tier: known, open for research, or still locked. */
const TechPanel: FC<TTechPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const game = store.game.value;
  const research = game.research;
  const current = research.current === null ? null : TECH_BY_ID[research.current]!;
  const tiers = [...new Set(TECH_DEFS.map((tech) => tech.tier))].sort((a, b) => a - b);

  return (
    <div className="stack">
      <div className="card">
        <div className="card__title">✧ Исследование</div>
        {current === null ? (
          <p className="card__text">Ничего не исследуется. Наука копится в запасе: {research.banked}. Выберите технологию ниже.</p>
        ) : (
          <>
            <div className="row">
              <span>{current.name}</span>
              <span className="muted">
                {research.progress} / {current.cost}
              </span>
            </div>
            <div className="bar">
              <div className="bar__fill bar__fill--science" style={{ width: `${Math.min(100, (research.progress / current.cost) * 100)}%` }} />
            </div>
          </>
        )}
        <div className="muted">Технологии общие: открытое одним игроком доступно обоим.</div>
      </div>

      {tiers.map((tier) => (
        <div key={tier} className="tier">
          <div className="section">{tier === 0 ? "Начало" : `Ярус ${tier}`}</div>
          {TECH_DEFS.filter((tech) => tech.tier === tier).map((tech) => {
            const known = isKnown(research, tech.id);
            const open = isResearchable(research, tech.id);
            const active = research.current === tech.id;
            const missing = tech.requires.filter((id) => !isKnown(research, id)).map((id) => TECH_BY_ID[id]!.name);

            return (
              <div key={tech.id} className={`tech ${known ? "tech--known" : ""} ${open ? "tech--open" : ""} ${active ? "tech--active" : ""}`}>
                <div className="tech__head">
                  <span className="tech__name">{tech.name}</span>
                  <span className="muted">{tech.cost > 0 ? `${tech.cost} ✧` : "известно"}</span>
                </div>
                <div className="tech__effect">{tech.effect}</div>
                {tech.unlocksBuildings.length + tech.unlocksSquads.length > 0 ? (
                  <div className="tech__unlocks">
                    {tech.unlocksBuildings.map((type) => (
                      <span key={type} className="chip">
                        {BUILDING_DEFS[type].glyph} {BUILDING_DEFS[type].name}
                      </span>
                    ))}
                    {tech.unlocksSquads.map((type) => (
                      <span key={type} className="chip chip--squad">
                        ⚔ {SQUAD_DEFS[type].name}
                      </span>
                    ))}
                  </div>
                ) : null}
                {!known && !open ? <div className="muted">Нужно: {missing.join(", ")}</div> : null}
                {open && !active ? (
                  <button className="btn btn--small btn--primary" disabled={game.phase !== "planning"} onClick={() => registry.setResearchAction(tech.id)}>
                    Исследовать
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      ))}
    </div>
  );
};

export { TechPanel };
