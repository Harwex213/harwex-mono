import type { FC } from "react";
import { PILLARS } from "../../domain/pillars";

const Marquee: FC = () => {
  const words = [...PILLARS, ...PILLARS, ...PILLARS, ...PILLARS];

  return (
    <div className="marquee" aria-hidden="true">
      <div className="marquee__track">
        {words.map((pillar, index) => (
          <span key={index} className="marquee__item">
            {pillar.verb}
            <i>✦</i>
          </span>
        ))}
      </div>
    </div>
  );
};

export { Marquee };
