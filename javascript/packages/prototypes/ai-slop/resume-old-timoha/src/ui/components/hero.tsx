import type { FC } from "react";
import duo from "../../assets/duo.jpg";
import { SYNERGY } from "../../domain/candidates";
import { HologramImage } from "./shader-canvas";

const Hero: FC = () => (
  <header className="hero">
    <div className="hero__copy">
      <p className="tag">// РЕЗЮМЕ.EXE — ВАКАНСИЯ: HUMAN RESOURCE MANAGER</p>
      <h1 className="hero__title glitch" data-text="СТАРЫЙ ТИМОХА">
        СТАРЫЙ ТИМОХА
      </h1>
      <p className="hero__lead">
        Два кандидата. Одна вакансия. <b>Одна зарплата.</b> Связаны миндалиновой связью и работают с синергией{" "}
        <span className="accent-magenta">x{SYNERGY}</span> по сравнению с обычным кандидатом.
      </p>
      <div className="hero__chips">
        <span className="chip chip--cyan">2 в 1</span>
        <span className="chip chip--magenta">x{SYNERGY} синергия</span>
        <span className="chip chip--violet">1 зарплата</span>
      </div>
      <a className="button" href="#offer">
        Нанять дуэт
      </a>
    </div>
    <HologramImage src={duo} label="Старый и Тимоха в неоновом городе" tint="violet" className="hero__image" />
  </header>
);

export { Hero };
