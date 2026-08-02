import { type BuildOrder, BuildingKind, buildOrder, type ResourceKind } from "@hw/colony-sim-v1-core";
import { useEngine } from "./engine-context";
import { RESOURCE_ICONS } from "./resource-icons";

// The buildings a player can put down, as the orders that place them. A store gets
// one entry per resource rather than one entry plus a setting: it holds a single
// kind, that kind is decided before it is placed, and an unassigned store would be a
// building with nothing to say about itself.
const STORE_KINDS: readonly ResourceKind[] = ["wood", "stone", "food"];
const FARM_ICON = "🌾";
const STORE_ICON = "🏚";

interface BuildOption {
  order: BuildOrder;
  icon: string;
  label: string;
}

const OPTIONS: readonly BuildOption[] = [
  ...STORE_KINDS.map((kind) => {
    return {
      order: { kind: BuildingKind.Warehouse, stores: kind } as BuildOrder,
      icon: `${STORE_ICON}${RESOURCE_ICONS[kind]}`,
      label: `warehouse for ${kind}`,
    };
  }),
  { order: { kind: BuildingKind.Farm }, icon: FARM_ICON, label: "farm" },
];

// Arming the build cursor, in the bottom bar beside the panel tabs. The buttons only
// dispatch: what an armed order does to the cursor, the ghost and the next click is
// decided in core, so the menu cannot end up meaning something else than the canvas.
function BuildMenu() {
  const engine = useEngine();
  const armed = buildOrder.value;

  return (
    <div className="bar-group">
      <span className="bar-label">build</span>
      {OPTIONS.map((option) => {
        const active = sameOrder(armed, option.order);
        return (
          <button
            type="button"
            key={option.label}
            className={active ? "hud-button active" : "hud-button"}
            aria-pressed={active}
            aria-label={option.label}
            title={`${option.label} — click a tile to place, esc to cancel`}
            // Clicking the armed option again disarms it: the same button is how the
            // player says "never mind" without reaching for Escape.
            onClick={() => engine.dispatch({ type: "setBuild", order: active ? null : option.order })}
          >
            <span aria-hidden="true">{option.icon}</span>
          </button>
        );
      })}
    </div>
  );
}

// Two orders are the same when they would place the same building — the store's
// resource is part of the building, not a setting on top of it.
function sameOrder(a: BuildOrder | null, b: BuildOrder): boolean {
  if (!a || a.kind !== b.kind) {
    return false;
  }
  if (a.kind === BuildingKind.Warehouse && b.kind === BuildingKind.Warehouse) {
    return a.stores === b.stores;
  }
  return true;
}

export { BuildMenu };
