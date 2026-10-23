import type { FC } from "react";

const ITEMS = [
  "МИНДАЛИНОВАЯ СВЯЗЬ: СТАБИЛЬНА",
  "СИНЕРГИЯ x5",
  "HTML + PASCAL + БЛОКНОТ",
  "МРК — НЕ ЯДЕРНАЯ РАКЕТА",
  "ДВА HR ПО ЦЕНЕ ОДНОГО",
  "КОРОЛЬ ГОЛУБИНОЙ ЖИЖИ",
  "ЗАВОДИТ ДАЖЕ МЁРТВОГО ДЕДА",
  "ВДОХНОВЛЕНО ИЛОНОМ МАСКОМ И ФРЕДДИ КРЮГЕРОМ",
];

const Ticker: FC = () => (
  <div className="ticker" aria-hidden="true">
    <div className="ticker__track">
      {[...ITEMS, ...ITEMS].map((item, index) => (
        <span key={index} className="ticker__item">
          {item}
        </span>
      ))}
    </div>
  </div>
);

export { Ticker };
