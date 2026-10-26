import type { FC } from "react";
import { CANDIDATES } from "../../domain/candidates";
import type { TCandidate } from "../../domain/candidates";
import { HologramImage } from "./shader-canvas";

type TDossierProps = {
  candidate: TCandidate;
};

const Dossier: FC<TDossierProps> = ({ candidate }) => (
  <article className={`dossier dossier--${candidate.accent}`}>
    <div className="dossier__photo">
      <HologramImage src={candidate.photo} label={`${candidate.name} в стиле киберпанк`} tint={candidate.accent} />
      <span className="dossier__code">{candidate.codename}</span>
    </div>
    <div className="dossier__body">
      <h3 className="dossier__name">{candidate.name}</h3>
      <p className="dossier__tagline">{candidate.tagline}</p>
      <dl className="facts">
        {candidate.facts.map((fact) => (
          <div key={fact.label} className="facts__row">
            <dt>{fact.label}</dt>
            <dd>
              {fact.value}
              {fact.note ? <small>({fact.note})</small> : null}
            </dd>
          </div>
        ))}
      </dl>
      <div className="stats">
        {candidate.stats.map((stat) => (
          <div key={stat.label} className="stats__row">
            <span>{stat.label}</span>
            <div className="stats__bar">
              <i style={{ width: `${stat.value}%` }} />
            </div>
            <b>{stat.value}</b>
          </div>
        ))}
      </div>
    </div>
  </article>
);

const Dossiers: FC = () => (
  <section className="section" id="dossiers">
    <div className="section__head" data-reveal>
      <p className="tag">// 02 — ДОСЬЕ КАНДИДАТОВ</p>
      <h2>Кто они</h2>
    </div>
    <div className="dossiers">
      {CANDIDATES.map((candidate) => (
        <div key={candidate.id} data-reveal>
          <Dossier candidate={candidate} />
        </div>
      ))}
    </div>
  </section>
);

export { Dossiers };
