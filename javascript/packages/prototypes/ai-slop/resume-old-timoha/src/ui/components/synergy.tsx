import type { FC } from "react";
import bond from "../../assets/bond.jpg";
import { SYNERGY } from "../../domain/candidates";
import { HologramImage } from "./shader-canvas";

const POINTS = [
  { title: "Одна миндалина на двоих", text: "Страх, решения и HR-интуиция синхронизируются без созвонов и Slack." },
  { title: "Покрытие 24/7", text: "Пока Тимоха строит карьеру до CEO, Старый держит оборону в продуктовом." },
  { title: "Экономия бюджета", text: "Два сотрудника по цене одного. Бухгалтерия даже не заметит." },
];

const Synergy: FC = () => (
  <section className="section synergy" id="synergy">
    <div className="section__head" data-reveal>
      <p className="tag">// 01 — МИНДАЛИНОВАЯ СВЯЗЬ</p>
      <h2>Синергия x{SYNERGY}</h2>
    </div>
    <div className="synergy__grid">
      <div className="synergy__image" data-reveal>
        <HologramImage src={bond} label="Две головы, связанные нейронным лучом между миндалинами" tint="cyan" />
      </div>
      <div className="synergy__body" data-reveal>
        <div className="formula">
          <span className="formula__term accent-cyan">Тимоха</span>
          <span className="formula__op">+</span>
          <span className="formula__term accent-magenta">Старый</span>
          <span className="formula__op">=</span>
          <span className="formula__result">{SYNERGY} HR</span>
        </div>
        <div className="meter">
          <div className="meter__row">
            <span>Обычный кандидат</span>
            <div className="meter__bar">
              <i style={{ width: `${100 / SYNERGY}%` }} />
            </div>
          </div>
          <div className="meter__row">
            <span>Старый Тимоха</span>
            <div className="meter__bar meter__bar--duo">
              <i style={{ width: "100%" }} />
            </div>
          </div>
        </div>
        <ul className="points">
          {POINTS.map((point) => (
            <li key={point.title}>
              <b>{point.title}</b>
              <span>{point.text}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  </section>
);

export { Synergy };
