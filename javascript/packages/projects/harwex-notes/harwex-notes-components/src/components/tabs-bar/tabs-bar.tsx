import "./tabs-bar.css";
import { useRef } from "react";
import { NodeIcon } from "../fs-viewer/fs-icons";
import type { FC, KeyboardEvent, MouseEvent } from "react";
import type { TTab, TTabSaveState, TTabsBarProps } from "./tabs-bar.types";

const MIDDLE_BUTTON = 1;

// The word each state carries, shown as the marker's tooltip and read by screen readers.
const SAVE_STATE_LABEL: Readonly<Record<TTabSaveState, string>> = {
  loading: "Loading",
  saved: "Saved",
  unsaved: "Unsaved changes",
  saving: "Saving",
  failed: "Save failed",
  conflict: "Conflict",
  deleted: "Deleted on disk",
};

type TSaveMarkerProps = {
  saveState: TTabSaveState;
};

// One glyph per state. The shapes differ from each other, so the state reads without
// its colour: a dot for a pending change, a ring for work in progress, a triangle for a
// failure, a split circle for a conflict and a struck circle for a deleted file.
const SaveMarker: FC<TSaveMarkerProps> = ({ saveState }) => {
  // A saved tab draws no glyph. The marker still takes its space, so the name and the
  // close button stay put when a save finishes.
  if (saveState === "saved") {
    return <span aria-hidden="true" className="tabs-bar__marker tabs-bar__marker--saved" />;
  }

  const label = SAVE_STATE_LABEL[saveState];

  return (
    <span
      aria-label={label}
      className={`tabs-bar__marker tabs-bar__marker--${saveState}`}
      role="img"
      title={label}
    >
      <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 12 12">
        {saveState === "unsaved" ? <circle cx="6" cy="6" fill="currentColor" r="3" /> : null}

        {saveState === "loading" || saveState === "saving" ? (
          <circle
            cx="6"
            cy="6"
            r="3.5"
            stroke="currentColor"
            strokeDasharray="14 8"
            strokeLinecap="round"
            strokeWidth="1.6"
          />
        ) : null}

        {saveState === "failed" ? (
          <>
            <path d="M6 1.6 11 10.6H1z" stroke="currentColor" strokeLinejoin="round" strokeWidth="1.4" />
            <path d="M6 4.6v3M6 9.2v.2" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
          </>
        ) : null}

        {saveState === "conflict" ? (
          <>
            <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M6 1.8v8.4" stroke="currentColor" strokeWidth="1.4" />
          </>
        ) : null}

        {saveState === "deleted" ? (
          <>
            <circle cx="6" cy="6" r="4.2" stroke="currentColor" strokeWidth="1.4" />
            <path d="M3 3l6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
          </>
        ) : null}
      </svg>
    </span>
  );
};

const readTabDescription = (tab: TTab): string => {
  return `${tab.name} — ${SAVE_STATE_LABEL[tab.saveState]}`;
};

const TabsBar: FC<TTabsBarProps> = ({ tabs, activeId, message = null, registry }) => {
  const listRef = useRef<HTMLDivElement>(null);

  // The browser starts autoscroll on a middle press, so the press is swallowed and the tab
  // closes on the release (TAB-5).
  const handleMouseDown = (event: MouseEvent<HTMLElement>) => {
    if (event.button === MIDDLE_BUTTON) {
      event.preventDefault();
    }
  };

  const handleAuxClick = (event: MouseEvent<HTMLElement>, tabId: string) => {
    if (event.button !== MIDDLE_BUTTON) {
      return;
    }

    event.preventDefault();
    registry.closeTabAction(tabId);
  };

  // Left and Right move along the bar, Home and End jump to its ends, Delete closes the
  // focused tab. The list is one tab stop: only the active tab is in the tab order.
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>, index: number) => {
    if (tabs.length === 0) {
      return;
    }

    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (index + 1) % tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (index - 1 + tabs.length) % tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = tabs.length - 1;
    } else if (event.key === "Delete") {
      const current = tabs[index];

      if (current !== undefined) {
        event.preventDefault();
        registry.closeTabAction(current.id);
      }

      return;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();

    const nextTab = tabs[nextIndex];
    if (nextTab === undefined) {
      return;
    }

    registry.activateTabAction(nextTab.id);

    const nextElement = listRef.current?.querySelector<HTMLElement>(
      `[data-tab-id="${CSS.escape(nextTab.id)}"]`
    );

    nextElement?.focus();
  };

  return (
    <div className="tabs-bar">
      <div className="tabs-bar__row">
        <div aria-label="Open files" className="tabs-bar__list" ref={listRef} role="tablist">
          {tabs.length === 0 ? <span className="tabs-bar__empty">{"No open files"}</span> : null}

          {tabs.map((tab, index) => {
            const isActive = tab.id === activeId;
            const className = [
              "tabs-bar__tab",
              `tabs-bar__tab--${tab.saveState}`,
              isActive ? "tabs-bar__tab--active" : "",
            ]
              .filter(Boolean)
              .join(" ");

            return (
              <div
                className={className}
                key={tab.id}
                onAuxClick={(event) => handleAuxClick(event, tab.id)}
                onMouseDown={handleMouseDown}
              >
                <button
                  aria-selected={isActive}
                  className="tabs-bar__label"
                  data-tab-id={tab.id}
                  onClick={() => registry.activateTabAction(tab.id)}
                  onKeyDown={(event) => handleKeyDown(event, index)}
                  role="tab"
                  tabIndex={isActive ? 0 : -1}
                  title={readTabDescription(tab)}
                  type="button"
                >
                  <span aria-hidden="true" className="tabs-bar__icon">
                    <NodeIcon kind={tab.kind} />
                  </span>

                  <span className="tabs-bar__name">{tab.name}</span>

                  <SaveMarker saveState={tab.saveState} />
                </button>

                <button
                  aria-label={`Close ${tab.name}`}
                  className="tabs-bar__close"
                  onClick={() => registry.closeTabAction(tab.id)}
                  tabIndex={-1}
                  title={`Close ${tab.name}`}
                  type="button"
                >
                  <svg aria-hidden="true" fill="none" focusable="false" viewBox="0 0 12 12">
                    <path d="M3 3l6 6M9 3l-6 6" stroke="currentColor" strokeLinecap="round" strokeWidth="1.4" />
                  </svg>
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {message !== null && message.length > 0 ? (
        <p className="tabs-bar__message" role="alert">
          {message}
        </p>
      ) : null}
    </div>
  );
};

export { TabsBar };
