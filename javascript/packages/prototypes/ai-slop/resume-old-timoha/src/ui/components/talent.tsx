import type { FC } from "react";
import type { TTalent } from "../../domain/talents";
import { HologramImage } from "./shader-canvas";

type TTalentProps = {
  talent: TTalent;
  index: number;
  // Every other section puts the image on the right.
  flipped: boolean;
};

const Talent: FC<TTalentProps> = ({ talent, index, flipped }) => (
  <section className={`section talent talent--${talent.accent}`} id={talent.id}>
    <div className="section__head" data-reveal>
      <p className="tag">
        // {String(index).padStart(2, "0")} — СПЕЦНАВЫК: {talent.who.toUpperCase()}
      </p>
      <h2>{talent.title}</h2>
    </div>
    <div className={`talent__grid ${flipped ? "talent__grid--flipped" : ""}`}>
      <div className="talent__image" data-reveal>
        <HologramImage src={talent.photo} label={`${talent.who}: ${talent.title}`} tint={talent.accent} />
      </div>
      <div className="talent__body" data-reveal>
        <p className="talent__lead">{talent.lead}</p>
        <ul className="points">
          {talent.perks.map((perk) => (
            <li key={perk.title}>
              <b>{perk.title}</b>
              <span>{perk.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

export { Talent };
