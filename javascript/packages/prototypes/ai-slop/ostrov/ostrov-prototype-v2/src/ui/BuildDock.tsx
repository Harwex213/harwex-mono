import { useSignals } from "@preact/signals-react/runtime";
import type { BuildingId } from "../buildings/catalog";
import { CATEGORIES, buildingSpec, constructionSeconds } from "../buildings/catalog";
import {
  availabilityOf,
  buildPanelOpen,
  builtIds,
  cancelPlacing,
  placing,
  togglePlacing,
} from "../state/buildings";
import { HammerIcon } from "./HammerIcon";

/** `600` → `10:00`. The panel shows the designer's number, not the sped-up one. */
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

type CostProps = {
  kind: "wood" | "stone" | "gold";
  amount: number;
};

function Cost({ kind, amount }: CostProps): React.JSX.Element {
  return (
    <span className="cost">
      <i className={`dot ${kind}`} />
      {amount}
    </span>
  );
}

function BuildingRow({ id }: { id: BuildingId }): React.JSX.Element {
  useSignals();
  const spec = buildingSpec(id);
  const availability = availabilityOf(id);
  const standing = builtIds.value.has(id);
  const carried = placing.value === id;

  return (
    <button
      type="button"
      className="build-row"
      aria-pressed={carried}
      disabled={!availability.unlocked}
      onClick={() => togglePlacing(id)}
    >
      <span className="build-row-top">
        <span className="build-row-name">{spec.label}</span>
        <span className="mono muted">{formatTime(spec.buildTimeSec)}</span>
      </span>
      <span className="build-row-note">{spec.note}</span>
      <span className="build-row-costs">
        <Cost kind="wood" amount={spec.costWood} />
        <Cost kind="stone" amount={spec.costStone} />
        <Cost kind="gold" amount={spec.costGold} />
        <span className="mono muted build-row-demo">≈{constructionSeconds(id).toFixed(1)} с</span>
      </span>
      {availability.unlocked ? null : <span className="build-row-flag locked">{availability.reason}</span>}
      {standing ? <span className="build-row-flag standing">Построено</span> : null}
    </button>
  );
}

function BuildPanel(): React.JSX.Element {
  return (
    <aside className="build-panel">
      <header className="build-head">
        <h1>Постройки</h1>
        <p className="hint">Стоимость показана, но не списывается — экономики в прототипе нет.</p>
      </header>
      {CATEGORIES.map((category) => (
        <section className="build-group" key={category.id}>
          <h2>{category.label}</h2>
          {category.buildings.length === 0 ? (
            <p className="build-empty">Нет доступных построек</p>
          ) : (
            category.buildings.map((id) => <BuildingRow id={id} key={id} />)
          )}
        </section>
      ))}
    </aside>
  );
}

/**
 * The hammer button and the panel it opens.
 *
 * Both sit in the overlay, which is `pointer-events: none` apart from its own
 * controls, so a click on either never reaches the canvas underneath: no pan,
 * no drag, no tile selection.
 */
function BuildDock(): React.JSX.Element {
  useSignals();
  const open = buildPanelOpen.value;

  const onToggle = (): void => {
    // The same button cancels a placement in progress, which is the third way
    // out of placement mode next to Escape and the right mouse button.
    if (placing.value !== null) {
      cancelPlacing();
      return;
    }
    buildPanelOpen.value = !open;
    if (open) {
      cancelPlacing();
    }
  };

  return (
    <div className="build-dock">
      {open ? <BuildPanel /> : null}
      <button
        type="button"
        className="build-button"
        aria-pressed={open}
        aria-label={open ? "Закрыть постройки" : "Открыть постройки"}
        title="Постройки"
        onClick={onToggle}
      >
        <HammerIcon />
      </button>
    </div>
  );
}

export { BuildDock };
