import { config } from "@hw/ostrov-prototype-v2-config";
import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useState } from "react";
import type { BuildingId, CategoryId } from "../buildings/catalog";
import { CATEGORIES, buildingSpec, buildingsOfCategory } from "../buildings/catalog";
import { attractsAttention, noticeBuilding } from "../state/attract";
import { availabilityOf, buildPanelOpen, cancelPlacing, placing, togglePlacing } from "../state/buildings";
import { canAfford, stock } from "../state/resources";
import { selected } from "../state/signals";
import { BuildingGlyph, CategoryGlyph, ResourceIcon } from "./glyphs";
import { HammerIcon } from "./HammerIcon";
import { Tooltip } from "./Tooltip";

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

/** How long the panel takes to arrive and to leave, in milliseconds. */
const PANEL_ANIM_MS = config.ui.panelAnimMs;

/** Period of one beat of the golden pulse on a newly unlocked tile, in seconds. */
const ATTRACT_PERIOD_SEC = config.ui.unlockGlowSeconds;

/**
 * Both durations, handed to the stylesheet as custom properties. The animations
 * are CSS, so they are frame-rate independent and stop the moment the rule that
 * carries them stops matching; only their lengths come from here.
 */
const DOCK_STYLE = {
  "--panel-anim": `${PANEL_ANIM_MS}ms`,
  "--attract-period": `${ATTRACT_PERIOD_SEC}s`,
} as React.CSSProperties;

/**
 * Whether the keyboard belongs to a field right now. A hotkey that types over
 * someone's text is worse than no hotkey.
 */
function editing(): boolean {
  const active = document.activeElement;
  if (!(active instanceof HTMLElement)) {
    return false;
  }
  if (active.isContentEditable) {
    return true;
  }
  const tag = active.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

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

type BuildTipProps = {
  target: HoverTarget;
};

/** What one build tile has to say: its name, its price, its role. */
function BuildTip({ target }: BuildTipProps): React.JSX.Element {
  useSignals();
  const spec = target.id === null ? null : buildingSpec(target.id);
  const held = stock.value;

  return (
    <Tooltip anchor={target.rect}>
      <span className="tip-name">{target.label}</span>
      {spec ? (
        <span className="tip-costs">
          {spec.costWood > 0 ? (
            <span className="tip-cost" data-short={held.wood < spec.costWood}>
              <ResourceIcon kind="wood" />
              {spec.costWood}
            </span>
          ) : null}
          {spec.costStone > 0 ? (
            <span className="tip-cost" data-short={held.stone < spec.costStone}>
              <ResourceIcon kind="stone" />
              {spec.costStone}
            </span>
          ) : null}
          {spec.costGold > 0 ? (
            <span className="tip-cost" data-short={held.gold < spec.costGold}>
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
    </Tooltip>
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
  // Dimmed, not dropped. A building the player cannot pay for yet is something
  // to save up for; only an unmet prerequisite takes a tile out of the panel.
  const affordable = canAfford(id);
  // Golden while this tile is news. It has to survive a close and a reopen, so
  // the flag lives in the module, not in this component.
  const attract = attractsAttention(id);

  const show = (event: React.PointerEvent<HTMLButtonElement> | React.FocusEvent<HTMLButtonElement>): void => {
    // Reaching the tile is the whole point of the pulse, so reaching it ends it —
    // for this building alone, and for the rest of the session.
    noticeBuilding(id);
    onHover({ id, label: spec.label, rect: event.currentTarget.getBoundingClientRect() });
  };

  return (
    <button
      type="button"
      className="build-tile"
      aria-pressed={carried}
      aria-label={spec.label}
      data-attract={attract}
      data-affordable={affordable}
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

type PanelProps = {
  /** False while the panel is on its way out. It is still mounted until then. */
  open: boolean;
};

function BuildPanel({ open }: PanelProps): React.JSX.Element | null {
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

  // The tooltip is portalled to the body, so it would outlive the panel it
  // describes for the length of the exit animation. It leaves with it instead.
  useEffect(() => {
    if (!open) {
      setHovered(null);
    }
  }, [open]);

  if (!active) {
    return null;
  }

  return (
    <aside className="build-panel" data-open={open}>
      <div className="build-cats" role="tablist" aria-label="Building sections">
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
      {hovered ? <BuildTip target={hovered} /> : null}
    </aside>
  );
}

/**
 * The hammer button and the panel it opens.
 *
 * Both sit in the overlay, which is `pointer-events: none` apart from its own
 * controls, so a click on either never reaches the canvas underneath: no pan,
 * no drag, no tile selection.
 *
 * The panel outlives its own close by the length of the exit animation, which is
 * what `mounted` holds. The unmount is a timer rather than an `animationend`,
 * because the tiles inside the panel run animations of their own whose events
 * bubble through here, and because a timer cannot leave the panel stuck half
 * gone: every new toggle cancels the pending one.
 */
function BuildDock(): React.JSX.Element {
  useSignals();
  const open = buildPanelOpen.value;
  const [mounted, setMounted] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), PANEL_ANIM_MS);
    return () => {
      window.clearTimeout(timer);
    };
  }, [open]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      // `code`, not `key`: on a non-Latin layout the same physical key sends
      // another character.
      if (event.code !== "KeyB" || event.repeat || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      if (editing()) {
        return;
      }
      event.preventDefault();
      // B is a toggle, and closing the panel takes any armed ghost with it: a
      // cursor still carrying a building with no panel to put it back is a trap.
      cancelPlacing();
      const opening = !buildPanelOpen.peek();
      buildPanelOpen.value = opening;
      if (opening) {
        // Opening one panel closes the other. The barracks panel hangs off the
        // selected hex, so dropping the selection is what puts it away — and it
        // takes the yellow ring off the map with it, which is the same answer.
        selected.value = null;
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

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
      return;
    }
    selected.value = null;
  };

  return (
    <div className="build-dock" style={DOCK_STYLE}>
      {mounted ? <BuildPanel open={open} /> : null}
      <button
        type="button"
        className="build-button"
        aria-pressed={open}
        aria-label={open ? "Close buildings" : "Open buildings"}
        title="Buildings"
        onClick={onToggle}
      >
        <HammerIcon />
      </button>
    </div>
  );
}

export { BuildDock };
