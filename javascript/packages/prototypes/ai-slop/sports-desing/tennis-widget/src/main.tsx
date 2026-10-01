import { useSignals } from "@preact/signals-react/runtime";
import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { match, resetMatch, scorePoint } from "./match";
import { TennisWidget } from "./TennisWidget";
import "./page.css";

function DemoControls() {
  useSignals();
  const { teams } = match.value;
  return (
    <div className="demo-controls">
      <button
        type="button"
        onClick={() => {
          scorePoint(0);
        }}
      >
        + Point · {teams[0].name}
      </button>
      <button
        type="button"
        onClick={() => {
          scorePoint(1);
        }}
      >
        + Point · {teams[1].name}
      </button>
      <button
        type="button"
        onClick={() => {
          resetMatch();
        }}
      >
        Reset
      </button>
    </div>
  );
}

function App() {
  return (
    <main className="page">
      <TennisWidget />
      <DemoControls />
    </main>
  );
}

const root = document.getElementById("root");
if (!root) {
  throw new Error("#root is missing");
}
createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
