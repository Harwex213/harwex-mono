import { createRoot } from "react-dom/client";
import { getEngine } from "./engine/engine";
import "./global.css";
import { App } from "./ui/App";

// Dev hook for headless captures: window.__studio.step(seconds) advances the animation.
(window as unknown as { __studio: unknown }).__studio = getEngine();

const container = document.getElementById("root");
if (!container) {
  throw new Error("Missing #root element");
}
createRoot(container).render(<App />);
