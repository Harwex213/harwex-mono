import type { FC } from "react";
import { FORBIDDEN } from "../../domain/pillars";

const Forbidden: FC = () => {
  return (
    <section className="forbidden" id="forbidden">
      <div className="section-head">
        <p className="eyebrow" data-reveal>Ничего кроме</p>
        <h2 className="section-title" data-reveal>
          Чего метод
          <br />
          <em>не предусматривает.</em>
        </h2>
      </div>
      <ul className="forbidden__list">
        {FORBIDDEN.map((item, index) => (
          <li key={item} data-reveal style={{ transitionDelay: `${index * 40}ms` }}>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
};

export { Forbidden };
