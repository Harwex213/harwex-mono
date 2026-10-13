import { useEffect, useState } from "react";
import type { FC } from "react";
import { PILLARS } from "../../domain/pillars";
import { SCHEDULE, formatHour, slotAt } from "../../domain/schedule";
import type { TSlot } from "../../domain/schedule";

const RADIUS = 150;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

const pillarOf = (slot: TSlot) => PILLARS.find((pillar) => pillar.id === slot.pillar)!;

const currentHour = () => {
  const now = new Date();
  return now.getHours() + now.getMinutes() / 60;
};

const DayClock: FC = () => {
  const [hour, setHour] = useState(currentHour);
  const [focused, setFocused] = useState<TSlot | null>(null);

  useEffect(() => {
    const timer = window.setInterval(() => setHour(currentHour()), 30000);
    return () => window.clearInterval(timer);
  }, []);

  const now = slotAt(hour);
  const shown = focused ?? now;
  const needleAngle = (hour / 24) * 360;

  return (
    <section className="day" id="day">
      <div className="day__copy">
        <p className="eyebrow" data-reveal>Распорядок</p>
        <h2 className="section-title" data-reveal>
          Идеальные сутки
          <br />
          <em>по Каловцеву.</em>
        </h2>
        <p className="day__text" data-reveal>
          Всё, что не отмечено на циферблате, называется «ничего». Ничего — это не пустота. Это время, в которое
          система восстанавливается сама.
        </p>
        <ul className="day__legend" data-reveal>
          {SCHEDULE.map((slot, index) => {
            const pillar = pillarOf(slot);
            return (
              <li
                key={index}
                onPointerEnter={() => setFocused(slot)}
                onPointerLeave={() => setFocused(null)}
                onClick={() => setFocused(slot)}
                className={shown === slot ? "is-active" : ""}
              >
                <i style={{ background: pillar.color }} />
                <span>{pillar.verb}</span>
                <time>
                  {formatHour(slot.from)} — {formatHour(slot.to)}
                </time>
              </li>
            );
          })}
        </ul>
      </div>

      <div className="day__clock" data-reveal>
        <svg viewBox="-200 -200 400 400">
          <circle r={RADIUS} className="day__track" />
          {Array.from({ length: 24 }, (_, tick) => {
            const angle = (tick / 24) * Math.PI * 2 - Math.PI / 2;
            const major = tick % 6 === 0;
            const inner = RADIUS + 18;
            const outer = RADIUS + (major ? 30 : 24);
            return (
              <g key={tick}>
                <line
                  x1={Math.cos(angle) * inner}
                  y1={Math.sin(angle) * inner}
                  x2={Math.cos(angle) * outer}
                  y2={Math.sin(angle) * outer}
                  className={major ? "day__tick day__tick--major" : "day__tick"}
                />
                {major && (
                  <text x={Math.cos(angle) * (RADIUS + 44)} y={Math.sin(angle) * (RADIUS + 44)} className="day__hour">
                    {String(tick).padStart(2, "0")}
                  </text>
                )}
              </g>
            );
          })}
          <g transform="rotate(-90)">
            {SCHEDULE.map((slot, index) => {
              const pillar = pillarOf(slot);
              const length = ((slot.to - slot.from) / 24) * CIRCUMFERENCE;
              const offset = (slot.from / 24) * CIRCUMFERENCE;
              return (
                <circle
                  key={index}
                  r={RADIUS}
                  className={`day__slot ${shown === slot ? "is-active" : ""}`}
                  stroke={pillar.color}
                  strokeDasharray={`${length} ${CIRCUMFERENCE}`}
                  strokeDashoffset={-offset}
                  onPointerEnter={() => setFocused(slot)}
                  onPointerLeave={() => setFocused(null)}
                  onClick={() => setFocused(slot)}
                />
              );
            })}
          </g>
          <g transform={`rotate(${needleAngle})`} className="day__needle">
            <line x1="0" y1={-RADIUS + 48} x2="0" y2={-RADIUS + 22} />
            <circle cy={-RADIUS} r="6" />
          </g>
        </svg>
        <div className="day__center">
          <span className="day__center-label">{focused ? formatHour(focused.from) : `Сейчас ${formatHour(hour)}`}</span>
          <strong className="day__center-verb">{shown ? pillarOf(shown).verb : "Ничего"}</strong>
          <span className="day__center-note">{shown ? "по методу" : "и это правильно"}</span>
        </div>
      </div>
    </section>
  );
};

export { DayClock };
