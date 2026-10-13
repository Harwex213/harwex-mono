import type { CSSProperties, FC } from "react";
import { PILLARS } from "../../domain/pillars";
import { LiquidImage } from "./shader-canvas";

const Pillars: FC = () => {
  return (
    <section className="pillars" id="pillars">
      <div className="section-head">
        <p className="eyebrow" data-reveal>Подход</p>
        <h2 className="section-title" data-reveal>
          Четыре столпа.
          <br />
          <em>Пятого нет.</em>
        </h2>
      </div>

      {PILLARS.map((pillar, index) => (
        <article
          key={pillar.id}
          className={`pillar ${index % 2 === 1 ? "pillar--flip" : ""}`}
          style={{ "--accent": pillar.color } as CSSProperties}
        >
          <div className="pillar__visual" data-reveal>
            <LiquidImage src={pillar.image} label={pillar.verb} zoom={1.3} className="pillar__image" />
          </div>
          <div className="pillar__copy">
            <span className="pillar__index" data-reveal>{pillar.index}</span>
            <h3 className="pillar__verb" data-reveal>{pillar.verb}</h3>
            <p className="pillar__lead" data-reveal>{pillar.lead}</p>
            <p className="pillar__text" data-reveal>{pillar.text}</p>
            <dl className="pillar__facts" data-reveal>
              {pillar.facts.map(([term, value]) => (
                <div key={term}>
                  <dt>{term}</dt>
                  <dd>{value}</dd>
                </div>
              ))}
            </dl>
          </div>
        </article>
      ))}
    </section>
  );
};

export { Pillars };
