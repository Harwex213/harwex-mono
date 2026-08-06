import { useEffect, useRef } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { CountryPanel } from "./CountryPanel";
import { CountryPlaque } from "./CountryPlaque";
import { MapCanvas } from "./MapCanvas";
import { PANEL_DOM_ID, closePanel, openPanelId, togglePanel } from "../state/panel-store";
import { PanelHost } from "./PanelHost";
import { activeCountryId, assignMode, setAssignMode } from "../state/assign-store";
import { countryById } from "../state/world-store";
import { resetView } from "../state/view-store";
import type { PanelId } from "../state/panel-store";
import styles from "./shell.module.css";

// The layout frame. Full-bleed map with the chrome positioned absolutely over it.
//
// EVERY SHELL CONTROL IS A SIBLING OF THE MAP HOST, never a descendant. That is
// the rule T06 established for `CountryPanel`, and it is why none of this needs
// `data-hud-control`: a pointer event on shell chrome never reaches the map's
// handlers at all. `data-hud-control` stays reserved for a control placed INSIDE
// the host, of which T08 adds none.

const BAR_BUTTONS: readonly { id: PanelId; label: string }[] = [
  { id: "country", label: "Country" },
  { id: "provinces", label: "Provinces" },
  { id: "economics", label: "Economics" },
];

function Shell() {
  useSignals();

  const buttonRefs = useRef(new Map<PanelId, HTMLButtonElement>());

  const open = openPanelId.value;
  const mode = assignMode.value;
  const activeId = activeCountryId.value;
  const activeCountry = activeId === null ? null : countryById.value.get(activeId) ?? null;

  // THE ONE window Escape listener in the app. `CountryPanel`'s own listener was
  // removed with T08: two independent listeners on the same key means one press
  // does two things and neither is predictable.
  //
  // Escape is NOT suppressed inside a text field. A field commits on a debounce,
  // on blur and on unmount, so there is no draft to protect and no revert
  // semantics to explain.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape" || event.altKey || event.ctrlKey || event.metaKey) {
        return;
      }
      const current = openPanelId.peek();
      if (current !== null) {
        const wasInside =
          document.activeElement instanceof Element &&
          document.activeElement.closest("#" + PANEL_DOM_ID) !== null;
        closePanel();
        // Focus is never trapped while the panel is open; it is only RESTORED
        // when the element that held it is about to be unmounted.
        if (wasInside) {
          buttonRefs.current.get(current)?.focus();
        }
        return;
      }
      if (assignMode.peek()) {
        setAssignMode(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div className={styles.shell} data-mode={mode ? "assign" : "pan"}>
      <div className={styles.mapLayer}>
        <MapCanvas />
      </div>

      {/* The rail spans the window, so it is `pointer-events: none` and only the
          plaque box inside it is `auto`. Without that it would eat every map
          click along the top of the window. */}
      <div className={styles.plaqueRail}>
        <CountryPlaque />
        {mode ? (
          <div className={styles.assignBanner}>
            {activeCountry === null ? null : (
              <span
                className={styles.assignSwatch}
                style={{ background: activeCountry.colorHex }}
              />
            )}
            <span>
              {activeCountry === null
                ? "assign mode · no country picked — the left button still pans"
                : "assign mode · " +
                  activeCountry.name +
                  " · left drag paints · alt erases · esc exits"}
            </span>
          </div>
        ) : null}
      </div>

      <CountryPanel />

      <div className={styles.bar}>
        {BAR_BUTTONS.map((entry) => {
          return (
            <button
              key={entry.id}
              className={styles.barButton}
              // Only while that panel is open. `aria-controls` naming an id
              // that is not in the document is worse than no `aria-controls`:
              // a screen reader offers a jump to an element that is not there.
              aria-controls={open === entry.id ? PANEL_DOM_ID : undefined}
              aria-pressed={open === entry.id}
              data-on={open === entry.id ? "true" : "false"}
              ref={(node) => {
                if (node === null) {
                  buttonRefs.current.delete(entry.id);
                  return;
                }
                buttonRefs.current.set(entry.id, node);
              }}
              type="button"
              onClick={() => {
                togglePanel(entry.id);
              }}
            >
              {entry.label}
            </button>
          );
        })}

        {/* An ACTION, not a toggle: no `aria-pressed`, no `data-on`. Never
            disabled either — a control that greys out the moment the view is
            fitted is more confusing than a click that does nothing, and
            `resetView` already writes no signal when the view is already the
            fitted one. Same action as the `0` key, which `MapCanvas` owns. */}
        <span className={styles.barDivider} />
        <button
          className={styles.barAction}
          title="Reset view (0)"
          type="button"
          onClick={() => {
            resetView();
          }}
        >
          Reset view
        </button>
      </div>

      {open === null ? null : (
        <div className={styles.panelDock}>
          <PanelHost />
        </div>
      )}

      {/* An inset ring around the whole viewport, so assign mode is visible even
          when the pointer is nowhere near the banner. */}
      {mode ? <div className={styles.assignRail} /> : null}
    </div>
  );
}

export { Shell };
