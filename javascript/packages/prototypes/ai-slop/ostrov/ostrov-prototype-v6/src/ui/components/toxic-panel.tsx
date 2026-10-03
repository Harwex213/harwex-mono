import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef, useState } from "react";
import { ICONS } from "../../core/icons";
import { getMeterZone, METER_MAX, METER_ZONES, meterLevel } from "../../core/toxic-slot";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TMeterLevel } from "../../core/toxic-slot";
import type { TSetHudAnchorsAction } from "../../domain/registry";

type TToxicPanelRegistrySlice = {
  setHudAnchorsAction: TSetHudAnchorsAction;
};

type TToxicPanelProps = {
  registry: TToxicPanelRegistrySlice;
};

/** How long the status stays lit after the fill has crossed into a new zone. */
const LEVEL_FLASH_MS = 1600;

const percentOf = (value: number) => `${(Math.min(METER_MAX, Math.max(0, value)) / METER_MAX) * 100}%`;

/**
 * Lights the status when the fill crosses into a new zone. A new player in
 * view, or the first render, lights nothing.
 */
const useLevelFlash = (playerId: string, level: TMeterLevel) => {
  const previous = useRef({ playerId, level });
  const [isFlashing, setFlashing] = useState(false);

  useEffect(() => {
    const before = previous.current;
    previous.current = { playerId, level };
    if (before.playerId !== playerId || before.level === level) {
      return undefined;
    }

    setFlashing(true);
    const timeoutId = setTimeout(() => setFlashing(false), LEVEL_FLASH_MS);

    return () => {
      clearTimeout(timeoutId);
    };
  }, [playerId, level]);

  return isFlashing;
};

/**
 * The island's toxicity on the right of the island page: a flask of 1000
 * points with ticks at the zone borders, the counter and the status of the
 * current zone. The tax phase's toxicity motes fly into the flask. The slot
 * that the meter drives opens as a modal when the tax phase ends.
 */
const ToxicPanel: FC<TToxicPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const player = store.derived.viewedPlayer.value;
  const isOwn = !store.derived.isReadonly.value;
  const flaskRef = useRef<HTMLDivElement | null>(null);
  const meter = player?.toxicMeter ?? 0;
  const level = meterLevel(meter);
  const isFlashing = useLevelFlash(player?.id ?? "", level);

  useEffect(() => {
    const node = flaskRef.current;
    if (!node || !isOwn) {
      return undefined;
    }

    const measure = () => {
      const box = node.getBoundingClientRect();
      registry.setHudAnchorsAction({ meter: { x: box.left + box.width / 2, y: box.top + box.height * 0.6 } });
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    window.addEventListener("resize", measure);

    return () => {
      observer.disconnect();
      window.removeEventListener("resize", measure);
    };
  }, [registry, isOwn]);

  if (!player) {
    return null;
  }

  const zone = getMeterZone(level);
  const panelClass = [
    "panel",
    "toxic-panel",
    `toxic-panel--level-${level}`,
    meter >= METER_MAX ? "toxic-panel--full" : "",
    isFlashing ? "toxic-panel--flash" : "",
  ].join(" ");

  return (
    <section className={panelClass} aria-label="Токсичность острова">
      <header className="toxic-panel__head">
        <Icon src={ICONS.toxicity} className="toxic-panel__icon" />

        <span className="toxic-panel__title">
          {"Токсичность"}
        </span>
      </header>

      <div className="toxic-meter__flask">
        <span className="toxic-meter__neck" />

        <div
          className="toxic-meter__body"
          ref={flaskRef}
          role="meter"
          aria-valuemin={0}
          aria-valuemax={METER_MAX}
          aria-valuenow={meter}
          aria-valuetext={`${meter} из ${METER_MAX}: ${zone.status}`}
        >
          <div className="toxic-meter__fill" style={{ height: percentOf(meter) }} />

          {METER_ZONES.slice(1).map((item) => (
            <span
              key={item.level}
              className={`toxic-meter__tick ${meter >= item.from ? "toxic-meter__tick--passed" : ""}`}
              style={{ bottom: percentOf(item.from) }}
              title={`${item.label}: от ${item.from}`}
            />
          ))}
        </div>
      </div>

      <div className="toxic-meter__counter">
        <strong>
          {meter}
        </strong>
        {`/${METER_MAX}`}
      </div>

      <div className="toxic-meter__status" role="status">
        {zone.status}
      </div>
    </section>
  );
};

export { ToxicPanel };
