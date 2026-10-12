import { createRoot } from "react-dom/client";
import type * as THREE from "three";
import { auditBlocking } from "./engine/blockingAudit";
import type { AuditReport } from "./engine/blockingAudit";
import { createEngine } from "./engine/engine";
import { exportGlb } from "./engine/glbExport";
import type { GlbExport } from "./engine/glbExport";
import type { StudioEngine } from "./engine/engine";
import { checkPivots } from "./engine/pivots";
import type { PivotProblem } from "./engine/pivots";
import { openScene } from "./engine/sceneSync";
import "./global.css";
import { App } from "./ui/App";

declare global {
  interface Window {
    // Capture hook: jumps every animation to `time` seconds and renders one frame.
    // Dev hook: `audit()` lists penetrations, z-fights and floating meshes of the set,
    // `pivots()` lists selectable objects whose pivot is off the object.
    // `exportGlb()` exports the visible scene as a GLB (`yarn export-glb`).
    // `engine` gives scripts the scene document (`engine.document`), the link to the files on disk (`engine.sync`)
    // and `engine.add(kind, parent)`.
    __studio?: { seek: (time: number) => void; audit: () => AuditReport; pivots: () => PivotProblem[]; exportGlb: () => Promise<GlbExport>; root: THREE.Object3D; engine: StudioEngine };
  }
}

// The scene file is not a module: the page fetches the open version (`?v=3`, or the latest), then starts.
async function start(): Promise<void> {
  const engine = createEngine(await openScene());
  window.__studio = {
    seek: (time: number) => {
      engine.seek(time);
    },
    audit: () => auditBlocking(engine.root),
    pivots: () => checkPivots(engine.root),
    exportGlb: () => exportGlb(engine.root),
    root: engine.root,
    engine,
  };
  const container = document.getElementById("root");
  if (!container) {
    throw new Error("#root is missing");
  }
  createRoot(container).render(<App />);
}

start().catch((error: unknown) => {
  console.error("[scene] the scene cannot load", error);
  const container = document.getElementById("root");
  if (container) {
    container.textContent = `The scene cannot load: ${String(error)}`;
  }
});
