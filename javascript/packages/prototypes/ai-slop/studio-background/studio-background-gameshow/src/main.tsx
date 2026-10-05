import { createRoot } from "react-dom/client";
import type * as THREE from "three";
import { auditBlocking } from "./engine/blockingAudit";
import type { AuditReport } from "./engine/blockingAudit";
import { getEngine } from "./engine/engine";
import { checkPivots } from "./engine/pivots";
import type { PivotProblem } from "./engine/pivots";
import "./global.css";
import { App } from "./ui/App";

declare global {
  interface Window {
    // Capture hook: jumps every animation to `time` seconds and renders one frame.
    // Dev hook: `audit()` lists penetrations, z-fights and floating meshes of the set,
    // `pivots()` lists selectable objects whose pivot is off the object.
    __studio?: { seek: (time: number) => void; audit: () => AuditReport; pivots: () => PivotProblem[]; root: THREE.Object3D };
  }
}

const engine = getEngine();
window.__studio = {
  seek: (time: number) => {
    engine.seek(time);
  },
  audit: () => auditBlocking(engine.root),
  pivots: () => checkPivots(engine.root),
  root: engine.root,
};

const container = document.getElementById("root");
if (!container) {
  throw new Error("#root is missing");
}
createRoot(container).render(<App />);
