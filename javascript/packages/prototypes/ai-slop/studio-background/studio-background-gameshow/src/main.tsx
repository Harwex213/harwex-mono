import { createRoot } from "react-dom/client";
import { auditBlocking } from "./engine/blockingAudit";
import type { AuditReport } from "./engine/blockingAudit";
import { getEngine } from "./engine/engine";
import "./global.css";
import { App } from "./ui/App";

declare global {
  interface Window {
    // Capture hook: jumps every animation to `time` seconds and renders one frame.
    // Dev hook: `audit()` lists penetrations, z-fights and floating meshes of the set.
    __studio?: { seek: (time: number) => void; audit: () => AuditReport };
  }
}

const engine = getEngine();
window.__studio = {
  seek: (time: number) => {
    engine.seek(time);
  },
  audit: () => auditBlocking(engine.root),
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing");
}
createRoot(container).render(<App />);
