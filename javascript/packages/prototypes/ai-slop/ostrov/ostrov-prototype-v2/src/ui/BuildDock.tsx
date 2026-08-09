import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { BuildingId, CategoryId } from "../buildings/catalog";
import { CATEGORIES, buildingSpec, buildingsOfCategory } from "../buildings/catalog";
import {
  availabilityOf,
  buildPanelOpen,
  builtIds,
  cancelPlacing,
  placing,
  togglePlacing,
} from "../state/buildings";
import { BuildingGlyph, CategoryGlyph, ResourceIcon } from "./glyphs";
import { HammerIcon } from "./HammerIcon";

/**
 * The build menu: a row of section tiles over a grid of building tiles.
 *
 * Nothing the player cannot use is drawn. A building whose prerequisite is not
 * met is absent, and a section left with no buildings is absent with it, so the
 * panel grows as the island does instead of showing a wall of greyed rows.
 *
 * Every tile is icon only. Name, price, build time and role live in the tooltip,
 * which opens on the first pointer event over a tile — no delay, because this is
 * a panel the player browses rather than one they consult.
 */

/** How far the tooltip sits from the tile it describes, in pixels. */
const TIP_GAP = 10;

/** How close the tooltip may come to the edge of the viewport, in pixels. */
const TIP_MARGIN = 8;

/** Section the player is looking at. A module signal, so it survives a close. */
const openCategory = signal<CategoryId>("core");

/** `600` → `10:00`. The panel shows the designer's number, not the sped-up one. */
function formatTime(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = Math.round(seconds % 60);
  return `${minutes}:${String(rest).padStart(2, "0")}`;
}

/** A section and the buildings of it the player may lay right now. */
type OpenSection = {
  id: CategoryId;
  label: string;
  buildings: BuildingId[];
};

function openSections(): OpenSection[] {
  const sections: OpenSection[] = [];
  for (const category of CATEGORIES) {
    const buildings = buildingsOfCategory(category.id).filter((id) => availabilityOf(id).unlocked);
    if (buildings.length > 0) {
      sections.push({ id: category.id, label: category.label, buildings });
    }
  }
  return sections;
}

/**
 * The tile a tooltip belongs to, and where that tile sits on screen. A section
 * tile carries no `id`: it has a name and nothing else to say.
 */
type HoverTarget = {
  id: BuildingId | null;
  label: string;
  rect: DOMRect;
};

type TooltipProps = {
  target: HoverTarget;
};

/**
 * The tooltip, mounted on `document.body` rather than inside the panel. The
 * panel scrolls and carries a `backdrop-filter`, and a filter makes an element
 * the containing block of even its `position: fixed` children — a tooltip left
 * inside it would be clipped by the panel edge. On the body it is free to reach
 * across the screen.
 *
 * It prefers the left of the tile, flips to the right when the left edge of the
 * screen is closer, and is clamped on both axes, so a tile in a corner still
 * gets a whole tooltip.
 */
function Tooltip({ target }: TooltipProps): React.JSX.Element {
  const ref = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ left: number; top: number } | null>(null);
  const spec = target.id === null ? null : buildingSpec(target.id);

  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) {
      return;
    }
    const box = node.getBoundingClientRect();
    let left = target.rect.left - box.width - TIP_GAP;
    if (left < TIP_MARGIN) {
      left = target.rect.right + TIP_GAP;
    }
    left = Math.max(TIP_MARGIN, Math.min(left, window.innerWidth - box.width - TIP_MARGIN));
    const wanted = target.rect.top + target.rect.height / 2 - box.height / 2;
    const top = Math.max(TIP_MARGIN, Math.min(wanted, window.innerHeight - box.height - TIP_MARGIN));
    setPlace({ left, top });
  }, [target]);

  return createPortal(
    <div
      ref={ref}
      className="build-tip"
      role="tooltip"
      style={{
        left: `${place?.left ?? 0}px`,
        top: `${place?.top ?? 0}px`,
        // The first pass is a measurement, not a picture: it is laid out at the
        // origin, so it must not be seen there.
        visibility: place ? "visible" : "hidden",
      }}
    >
      <span className="tip-name">{target.label}</span>
      {spec ? (
        <span className="tip-costs">
          {spec.costWood > 0 ? (
            <span className="tip-cost">
              <ResourceIcon kind="wood" />
              {spec.costWood}
            </span>
          ) : null}
          {spec.costStone > 0 ? (
            <span className="tip-cost">
              <ResourceIcon kind="stone" />
              {spec.costStone}
            </span>
          ) : null}
          {spec.costGold > 0 ? (
            <span className="tip-cost">
              <ResourceIcon kind="gold" />
              {spec.costGold}
            </span>
          ) : null}
          <span className="tip-cost">
            <ResourceIcon kind="time" />
            {formatTime(spec.buildTimeSec)}
          </span>
        </span>
      ) : null}
      {spec ? <span className="tip-desc">{spec.description}</span> : null}
    </div>,
    document.body,
  );
}

type TileProps = {
  id: BuildingId;
  onHover: (target: HoverTarget | null) => void;
};

function BuildingTile({ id, onHover }: TileProps): React.JSX.Element {
  useSignals();
  const spec = buildingSpec(id);
  const carried = placing.value === id;
  const standing = builtIds.value.has(id);

  const show = (event: React.PointerEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>): void => {
    onHover({ id, label: spec.label, rect: event.currentTarget.getBoundingClientRect() });
  };

  return (
    <button
      type="button"
      className="build-tile"
      aria-pressed={carried}
      aria-label={spec.label}
      data-standing={standing}
      onClick={() => togglePlacing(id)}
      onPointerEnter={show}
      onFocus={show}
      onPointerLeave={() => onHover(null)}
      onBlur={() => onHover(null)}
    >
      <BuildingGlyph id={id} />
    </button>
  );
}

function BuildPanel(): React.JSX.Element | null {
  useSignals();
  const [hovered, setHovered] = useState<HoverTarget | null>(null);
  const sections = openSections();
  // The open section can vanish under the player only in theory — buildings are
  // unlocked, never re-locked — but a panel that renders empty would be a silent
  // failure, so the first open section stands in whenever the stored one is gone.
  const active = sections.find((section) => section.id === openCategory.value) ?? sections[0] ?? null;
  const activeId = active ? active.id : null;

  useEffect(() => {
    if (activeId !== null && openCategory.peek() !== activeId) {
      openCategory.value = activeId;
    }
  }, [activeId]);

  if (!active) {
    return null;
  }

  return (
    <aside className="build-panel">
      <div className="build-cats" role="tablist" aria-label="Разделы построек">
        {sections.map((section) => (
          <button
            type="button"
            role="tab"
            key={section.id}
            className="build-cat"
            aria-selected={section.id === active.id}
            aria-label={section.label}
            onClick={() => {
              openCategory.value = section.id;
              setHovered(null);
            }}
            onPointerEnter={(event) => {
              setHovered({ id: null, label: section.label, rect: event.currentTarget.getBoundingClientRect() });
            }}
            onPointerLeave={() => setHovered(null)}
          >
            <CategoryGlyph id={section.id} />
          </button>
        ))}
      </div>
      <div className="build-grid">
        {active.buildings.map((id) => (
          <BuildingTile id={id} key={id} onHover={setHovered} />
        ))}
      </div>
      {/* One instance across hovers: it is re-measured before every paint, so it
          never has to be hidden and re-shown on the way from tile to tile. */}
      {hovered ? <Tooltip target={hovered} /> : null}
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
