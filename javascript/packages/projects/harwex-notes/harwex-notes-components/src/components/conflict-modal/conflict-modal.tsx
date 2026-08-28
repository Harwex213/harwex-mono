import "./conflict-modal.css";
import { useEffect, useId, useRef } from "react";
import type { FC, KeyboardEvent } from "react";
import type { TConflict, TConflictModalProps } from "./conflict-modal.types";

// The discard choice names what is lost. A drawing cannot be compared with the version
// on disk, so its wording names the drawing itself instead of "my changes" (CONF-6).
const readDiscardLabel = (conflict: TConflict): string => {
  if (conflict.kind === "excalidraw") {
    return "Discard the drawing as it stands now";
  }

  return "Discard my changes";
};

const readDiscardHint = (conflict: TConflict): string => {
  if (conflict.kind === "excalidraw") {
    return "Throws away the drawing as it stands now and loads the file from disk.";
  }

  return "Throws your changes away and loads the file from disk.";
};

const readWaitingLine = (waitingCount: number): string | null => {
  if (waitingCount <= 0) {
    return null;
  }

  if (waitingCount === 1) {
    return "1 other file is waiting.";
  }

  return `${waitingCount} other files are waiting.`;
};

// The dialog for one conflict (CONF-2). It has no close control, Escape does nothing and
// a click outside does nothing (CONF-3): one of the two buttons is the only way out.
// It does not cover the page, because the rest of the app stays usable while a conflict
// waits (CONF-9). The panel sits over the viewer and the user can still click past it.
const ConflictModal: FC<TConflictModalProps> = ({ conflict, waitingCount = 0, registry }) => {
  const titleId = useId();
  const descriptionId = useId();
  const overwriteRef = useRef<HTMLButtonElement>(null);
  const conflictId = conflict?.id ?? null;

  // A new conflict takes focus once, so a keyboard user lands on the first choice. The
  // user may then leave the panel and work elsewhere (CONF-9); focus is not pulled back.
  useEffect(() => {
    if (conflictId === null) {
      return;
    }

    overwriteRef.current?.focus();
  }, [conflictId]);

  // Escape must not reach a host handler that closes panels (CONF-3).
  const handleKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
    }
  };

  if (conflict === null) {
    return null;
  }

  const waitingLine = readWaitingLine(waitingCount);

  return (
    <div className="conflict-modal" onKeyDown={handleKeyDown}>
      <div
        aria-describedby={descriptionId}
        aria-labelledby={titleId}
        className="conflict-modal__panel"
        role="dialog"
      >
        <div className="conflict-modal__header">
          <span aria-hidden="true" className="conflict-modal__icon">
            <svg fill="none" focusable="false" viewBox="0 0 16 16">
              <circle cx="8" cy="8" r="6.5" stroke="currentColor" strokeWidth="1.5" />
              <path d="M8 1.5v13" stroke="currentColor" strokeWidth="1.5" />
            </svg>
          </span>

          <h2 className="conflict-modal__title" id={titleId}>
            <span className="conflict-modal__name">{conflict.name}</span>
            {" changed on disk"}
          </h2>
        </div>

        <p className="conflict-modal__description" id={descriptionId}>
          {"The file changed on disk while this tab holds unsaved changes. "}
          {"Saving of this file is paused until you choose which version to keep."}
        </p>

        <div className="conflict-modal__choices">
          <button
            className="conflict-modal__choice conflict-modal__choice--overwrite"
            onClick={() => registry.overwriteConflictAction(conflict.id)}
            ref={overwriteRef}
            type="button"
          >
            <span className="conflict-modal__choice-label">{"Overwrite the file"}</span>
            <span className="conflict-modal__choice-hint">
              {"Writes this tab's version over the file on disk."}
            </span>
          </button>

          <button
            className="conflict-modal__choice conflict-modal__choice--discard"
            onClick={() => registry.discardConflictAction(conflict.id)}
            type="button"
          >
            <span className="conflict-modal__choice-label">{readDiscardLabel(conflict)}</span>
            <span className="conflict-modal__choice-hint">{readDiscardHint(conflict)}</span>
          </button>
        </div>

        {waitingLine !== null ? (
          <p className="conflict-modal__waiting" role="status">
            {waitingLine}
          </p>
        ) : null}
      </div>
    </div>
  );
};

export { ConflictModal };
