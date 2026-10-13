import { useSignals } from "@preact/signals-react/runtime";
import type { CSSProperties, FC } from "react";
import { PILLARS } from "../../domain/pillars";
import type { TAppRegistry } from "../../domain/registry";
import { useStore } from "../../store/store";

type TRitualProps = {
  registry: TAppRegistry;
};

const Ritual: FC<TRitualProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const done = store.ritual.done.value;
  const count = PILLARS.filter((pillar) => done[pillar.id]).length;
  const complete = count === PILLARS.length;

  return (
    <section className={`ritual ${complete ? "ritual--complete" : ""}`} id="ritual">
      <div className="ritual__head">
        <p className="eyebrow" data-reveal>Практика</p>
        <h2 className="section-title" data-reveal>
          Сегодняшний
          <br />
          <em>откат.</em>
        </h2>
        <p className="ritual__progress" data-reveal>
          <span>{count}</span> / {PILLARS.length}
        </p>
      </div>

      <div className="ritual__grid">
        {PILLARS.map((pillar) => (
          // The wrapper takes the reveal class, so React re-rendering the button does not drop it.
          <div key={pillar.id} data-reveal>
            <button
              type="button"
              className={`ritual__tile ${done[pillar.id] ? "is-done" : ""}`}
              style={{ "--accent": pillar.color } as CSSProperties}
              onClick={() => registry.togglePillarAction(pillar.id)}
              aria-pressed={Boolean(done[pillar.id])}
            >
              <span className="ritual__index">{pillar.index}</span>
              <span className="ritual__verb">{pillar.verb}</span>
              <span className="ritual__check" aria-hidden="true">
                <svg viewBox="0 0 24 24">
                  <path d="M5 12.5l4.5 4.5L19 7.5" />
                </svg>
              </span>
              <span className="ritual__status">{done[pillar.id] ? "Сделано" : "Отметить"}</span>
            </button>
          </div>
        ))}
      </div>

      <div className="ritual__footer">
        <p className="ritual__verdict">
          {complete ? "День прожит идеально. Больше ничего не надо." : "Отмечайте по мере выполнения. Порядок свободный."}
        </p>
        {count > 0 && (
          <button type="button" className="button button--ghost" onClick={registry.resetDayAction}>
            Начать сутки заново
          </button>
        )}
      </div>
    </section>
  );
};

export { Ritual };
