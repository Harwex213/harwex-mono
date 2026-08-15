import { useRef, useState } from "react";
import type { ChangeEvent, ReactNode } from "react";
import { useActivePage, useEditor } from "../store/editor-context";
import { downloadDoc, parseDoc, serializeDoc } from "../store/persistence";
import type { BreakpointId } from "../types";

const BREAKPOINTS: { id: BreakpointId; label: string; glyph: string }[] = [
  { id: "desktop", label: "Desktop", glyph: "🖥" },
  { id: "tablet", label: "Tablet", glyph: "▭" },
  { id: "mobile", label: "Mobile", glyph: "▯" },
];

function TopBar(): ReactNode {
  const { state, dispatch } = useEditor();
  const page = useActivePage();
  const fileInput = useRef<HTMLInputElement>(null);
  const [notice, setNotice] = useState("");

  function flash(message: string): void {
    setNotice(message);
    window.setTimeout(() => setNotice(""), 1800);
  }

  function onImport(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];

    event.target.value = "";

    if (!file) {
      return;
    }

    file
      .text()
      .then((raw) => {
        const doc = parseDoc(raw);

        if (!doc) {
          flash("Import failed — not a theme document");

          return;
        }

        dispatch({ type: "load-doc", doc });
        flash("Imported");
      })
      .catch(() => flash("Import failed — file unreadable"));
  }

  function onCopy(): void {
    navigator.clipboard
      .writeText(serializeDoc(state.doc))
      .then(() => flash("JSON copied"))
      .catch(() => flash("Clipboard blocked"));
  }

  function onReset(): void {
    if (window.confirm("Replace the current site with the starter sportsbook?")) {
      dispatch({ type: "reset-site" });
    }
  }

  return (
    <header className="tb-top">
      <div className="tb-top__group">
        <span className="tb-top__logo">TB</span>
        <input
          className="tb-top__name"
          value={state.doc.name}
          onChange={(event) => dispatch({ type: "rename-site", name: event.target.value })}
          aria-label="Site name"
        />
        <span className="tb-top__crumb">
          {page.name}
          <span className="tb-top__path">{page.path}</span>
        </span>
      </div>

      <div className="tb-top__group tb-top__group--center">
        <div className="tb-seg">
          {BREAKPOINTS.map((breakpoint) => (
            <button
              key={breakpoint.id}
              type="button"
              className={state.breakpoint === breakpoint.id ? "tb-seg__btn is-active" : "tb-seg__btn"}
              onClick={() => dispatch({ type: "set-breakpoint", breakpoint: breakpoint.id })}
              title={breakpoint.label}
            >
              <span aria-hidden="true">{breakpoint.glyph}</span>
              <span className="tb-seg__label">{breakpoint.label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="tb-top__group tb-top__group--end">
        {notice ? <span className="tb-top__notice">{notice}</span> : null}
        <button
          type="button"
          className="tb-btn"
          onClick={() => dispatch({ type: "undo" })}
          disabled={state.past.length === 0}
          title="Undo (⌘Z)"
        >
          ↺
        </button>
        <button
          type="button"
          className="tb-btn"
          onClick={() => dispatch({ type: "redo" })}
          disabled={state.future.length === 0}
          title="Redo (⇧⌘Z)"
        >
          ↻
        </button>
        <button type="button" className="tb-btn" onClick={() => fileInput.current?.click()} title="Import JSON">
          ⇪
        </button>
        <button type="button" className="tb-btn" onClick={onCopy} title="Copy JSON">
          ⧉
        </button>
        <button type="button" className="tb-btn" onClick={() => downloadDoc(state.doc)} title="Download JSON">
          ⇩
        </button>
        <button type="button" className="tb-btn" onClick={onReset} title="Reset to starter site">
          ⟲
        </button>
        <button
          type="button"
          className={state.preview ? "tb-btn tb-btn--primary is-active" : "tb-btn tb-btn--primary"}
          onClick={() => dispatch({ type: "set-preview", preview: !state.preview })}
        >
          {state.preview ? "Exit preview" : "Preview"}
        </button>
        <input ref={fileInput} type="file" accept="application/json" className="tb-top__file" onChange={onImport} />
      </div>
    </header>
  );
}

export { TopBar };
