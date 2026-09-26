import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import { RESOURCES } from "../../core/resources";
import { useStore } from "../../store/store";
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

/** Rounds the way the reference HUD does: one decimal, no trailing zero. */
const formatAmount = (amount: number) => {
  return Number.isInteger(amount) ? String(amount) : amount.toFixed(1);
};

/**
 * The resources panel only displays data, as the spec says. It also reports
 * where each icon sits, because the tax phase flies the motes to them.
 */
const ResourcesPanel: FC<TResourcesPanelProps> = ({ registry }) => {
  useSignals();
  const store = useStore();
  const pool = store.derived.humanPlayer.value?.resources;
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
    <div className="panel resources-panel">
      {RESOURCES.map((resource) => (
        <div key={resource.id} className={`resource has-hint resource--${resource.kind}`}>
          <span
            className="resource__emoji"
            ref={(node) => {
              if (node) {
                iconRefs.current.set(resource.id, node);
              } else {
                iconRefs.current.delete(resource.id);
              }
            }}
          >
            {resource.emoji}
          </span>

          <span className="resource__body">
            <span className="resource__amount">
              {formatAmount(pool[resource.id])}
            </span>

            <span className="resource__label">
              {resource.label}
            </span>
          </span>

          <span className="hint">
            <span className="hint__title">
              {resource.label}
            </span>

            <span className="hint__row">
              {resource.feeds}
            </span>
          </span>
        </div>
      ))}
    </div>
  );
};

export { ResourcesPanel };
