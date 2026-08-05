import { useId } from "react";
import { useSignals } from "@preact/signals-react/runtime";
import { PANEL_DOM_ID, closePanel } from "../state/panel-store";
import { statePersistent } from "../state/world-store";
import type { PanelId } from "../state/panel-store";
import type { ReactNode } from "react";
import styles from "./panel.module.css";

// The reusable panel chrome every Phase-3 panel lives inside: a heading, a close
// control, and a scrollable body.
//
// `role="region"` and NOT `role="dialog"`. This is a docked panel, not a modal.
// A dialog role implies a focus trap, and the brief forbids one — Tab walks out
// of an open panel normally.
//
// `Panel` registers NO key listener. `Shell` owns the single window Escape
// handler; two listeners on one key means a press does two things.

type PanelProps = {
  panelId: PanelId;
  title: string;
  subtitle?: string;
  children: ReactNode;
};

function Panel(props: PanelProps) {
  useSignals();

  const headingId = useId();
  const persistent = statePersistent.value;

  return (
    <section
      className={styles.panel}
      aria-labelledby={headingId}
      data-panel={props.panelId}
      id={PANEL_DOM_ID}
      role="region"
    >
      <header className={styles.header}>
        <div className={styles.headingBlock}>
          <h2 className={styles.title} id={headingId}>
            {props.title}
          </h2>
          {props.subtitle === undefined ? null : (
            <p className={styles.subtitle}>{props.subtitle}</p>
          )}
        </div>
        {/* A future-version document puts the store in read-only mode and
            `markDirty` then drops every write. A field that looks saved and is
            not is the worst outcome, so the panel says so. */}
        {persistent ? null : <span className={styles.readonly}>read-only</span>}
        <button
          className={styles.close}
          aria-label={"close " + props.title}
          type="button"
          onClick={closePanel}
        >
          ×
        </button>
      </header>
      <div className={styles.body}>{props.children}</div>
    </section>
  );
}

export { Panel, type PanelProps };
