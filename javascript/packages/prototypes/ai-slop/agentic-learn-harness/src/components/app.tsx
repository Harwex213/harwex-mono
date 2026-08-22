import { useState } from "react";
import { useHarness } from "../state/harness.tsx";
import { Canvas } from "./canvas.tsx";
import { Inspector } from "./inspector.tsx";
import { TopBar } from "./top-bar.tsx";

function EmptyState() {
  const { createRoot } = useHarness();
  return (
    <div className="empty">
      <h1>Learn by branching</h1>
      <p>
        Ask a question, read the answer, then branch off any part of it. The harness carries the
        path you walked into every follow-up, so each branch keeps its own thread.
      </p>
      <button className="button button--primary" type="button" onClick={createRoot}>
        Ask the first question
      </button>
    </div>
  );
}

function Notices() {
  const { state, dispatch } = useHarness();
  if (state.notices.length === 0) {
    return null;
  }
  return (
    <ul className="notices">
      {state.notices.map((notice) => {
        return (
          <li key={notice.id}>
            <span>{notice.text}</span>
            <button
              type="button"
              onClick={() => {
                dispatch({ type: "notice/dismissed", id: notice.id });
              }}
            >
              ✕
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function App() {
  const { state } = useHarness();
  const [inspectorOpen, setInspectorOpen] = useState(true);

  return (
    <div className={inspectorOpen ? "app app--with-inspector" : "app"}>
      <TopBar
        inspectorOpen={inspectorOpen}
        onToggleInspector={() => {
          setInspectorOpen((open) => {
            return !open;
          });
        }}
      />
      <main className="app__main">
        {state.nodes.length === 0 && state.loaded ? <EmptyState /> : <Canvas />}
        {inspectorOpen ? <Inspector /> : null}
      </main>
      <Notices />
    </div>
  );
}

export { App };
