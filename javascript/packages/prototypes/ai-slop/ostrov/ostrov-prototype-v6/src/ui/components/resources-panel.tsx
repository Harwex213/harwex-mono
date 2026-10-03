import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { getResource } from "../../core/resources";
import { useStore } from "../../store/store";
import { Icon } from "./icon";
import type { FC } from "react";
import type { TResourceId } from "../../core/types";
import type { TPointerAnchor } from "../../store/ui-state";
import type { TSetHudAnchorsAction } from "../../domain/registry";

type TResourcesPanelRegistrySlice = {
  setHudAnchorsAction: TSetHudAnchorsAction;
};

type TResourcesPanelProps = {
  registry: TResourcesPanelRegistrySlice;
};

/**
 * Two panels, two rows each. Every row lists resource ids from left to right.
 * Toxicity has its own meter, so it is not listed here.
 */
const PANEL_LAYOUT: readonly (readonly (readonly TResourceId[])[])[] = [
  [
    ["food", "wood", "stone"],
    ["population", "mad", "hammers"],
  ],
  [
    ["power", "scouting"],
    ["science", "mana"],
  ],
];

/** Rounds the way the reference HUD does: one decimal, no trailing zero. */
const formatAmount = (amount: number) => {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
};

/**
 * The resources panels only display data, as the spec says. They also report
 * where each icon sits, because the tax phase flies the motes to them.
 */
const ResourcesPanel: FC<TResourcesPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const pool = store.derived.humanPlayer.value?.resources;
  const powerPlanned = store.derived.powerPlanned.value;
  const iconRefs = useRef(new Map<TResourceId, HTMLElement>());

  useEffect(() => {
    const measure = () => {
      const anchors: Partial<Record<TResourceId, TPointerAnchor>> = {};

      iconRefs.current.forEach((node, id) => {
        const box = node.getBoundingClientRect();
        anchors[id] = { x: box.left + box.width / 2, y: box.top + box.height / 2 };
      });

      registry.setHudAnchorsAction(anchors);
    };

    measure();
    window.addEventListener("resize", measure);

    return () => {
      window.removeEventListener("resize", measure);
    };
  }, [registry]);

  if (!pool) {
    return null;
  }

  return (
    <div className="resources-panels">
      {PANEL_LAYOUT.map((rows, panelIndex) => (
        <div key={panelIndex} className="panel resources-panel">
          {rows.flatMap((ids, rowIndex) => ids.map((id, columnIndex) => {
            const resource = getResource(id);

            return (
              <div
                key={resource.id}
                className={`resource has-hint resource--${resource.kind}`}
                style={{ gridRow: rowIndex + 1, gridColumn: columnIndex + 1 }}
              >
                <span
                  className="resource__icon"
                  ref={(node) => {
                    if (node) {
                      iconRefs.current.set(resource.id, node);
                    } else {
                      iconRefs.current.delete(resource.id);
                    }
                  }}
                >
                  <Icon src={resource.icon} size="m" />
                </span>

                <span className="resource__amount">
                  {formatAmount(pool[resource.id])}
                </span>

                {/* Power picked in the tax phase leaves the pool when the phase ends. */}
                {resource.id === "power" && powerPlanned > 0 ? (
                  <span className="resource__pending">
                    {`−${powerPlanned}`}
                  </span>
                ) : null}

                <span className="hint">
                  <span className="hint__title">
                    {resource.label}
                  </span>

                  <span className="hint__row">
                    {resource.feeds}
                  </span>

                  {resource.id === "power" && powerPlanned > 0 ? (
                    <span className="hint__row">
                      {`Выбрано граней на ${powerPlanned}: спишется в конце фазы налогов`}
                    </span>
                  ) : null}
                </span>
              </div>
            );
          }))}
        </div>
      ))}
    </div>
  );
};

export { ResourcesPanel };
