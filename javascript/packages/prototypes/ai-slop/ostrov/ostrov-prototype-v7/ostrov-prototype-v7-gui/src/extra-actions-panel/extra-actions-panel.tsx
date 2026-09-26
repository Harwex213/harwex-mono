import "./extra-actions-panel.css";
import type { ReactElement } from "react";

// One extra action: the glyph on the button, and the two lines of its tooltip.
type ExtraAction = {
  id: string;
  icon: string;
  title: string;
  description: string;
};

type ExtraActionsPanelProps = {
  actions: readonly ExtraAction[];
  activeId?: string;
  onSelect(id: string): void;
};

// The strip of extra actions beside the board: a column of square icon
// buttons. A button shows its tooltip on hover and on keyboard focus, and the
// reveal is CSS, so the widget keeps no state.
const ExtraActionsPanel = ({
  actions,
  activeId,
  onSelect,
}: ExtraActionsPanelProps): ReactElement => {
  return (
    <div className="ostrov-extra-actions">
      {actions.map((action) => {
        const active = action.id === activeId;
        const modifier = active ? "active" : "idle";

        return (
          <button
            aria-pressed={active}
            className={`ostrov-extra-actions__button ostrov-extra-actions__button--${modifier}`}
            key={action.id}
            onClick={() => {
              onSelect(action.id);
            }}
            type="button"
          >
            <span className="ostrov-extra-actions__icon" aria-hidden="true">
              {action.icon}
            </span>
            <span className="ostrov-extra-actions__tooltip" role="tooltip">
              <span className="ostrov-extra-actions__tooltip-title">
                {action.title}
              </span>
              <span className="ostrov-extra-actions__tooltip-text">
                {action.description}
              </span>
            </span>
          </button>
        );
      })}
    </div>
  );
};

export { ExtraActionsPanel };
export type { ExtraAction, ExtraActionsPanelProps };
