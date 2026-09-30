import { signal } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import { StudioRenderer } from "./scene/studio-renderer";

// Calibration overlay: press D to outline the glass, the floor mirror line and the horizon.
const debug = signal(false);

declare global {
  interface Window {
    __studio?: StudioRenderer;
  }
}

function App() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StudioRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = new StudioRenderer(canvas, { isDebug: () => debug.value });
    rendererRef.current = renderer;
    window.__studio = renderer;
    renderer.init().catch((error: unknown) => {
      console.error(error);
    });
    const onKey = (event: KeyboardEvent) => {
      if (event.code === "KeyD") {
        debug.value = !debug.value;
      } else if (event.code === "Space") {
        renderer.strike();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("keydown", onKey);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      className="studio-canvas"
      onPointerDown={() => {
        rendererRef.current?.strike();
      }}
    />
  );
}

export { App };
