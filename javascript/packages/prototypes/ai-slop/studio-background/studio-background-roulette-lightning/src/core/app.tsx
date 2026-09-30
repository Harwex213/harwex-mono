import { signal } from "@preact/signals-react";
import { useEffect, useRef } from "react";
import { createRoot } from "react-dom/client";
import { StudioRenderer } from "./studio";
import type { SceneFactory } from "./studio";
import "./styles.css";

// Calibration overlay: press D to outline the glass, the floor mirror line and the horizon.
const debug = signal(false);

declare global {
  interface Window {
    __studio?: StudioRenderer;
  }
}

type AppProps = {
  createScene: SceneFactory;
};

function App({ createScene }: AppProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StudioRenderer | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }
    const renderer = new StudioRenderer(canvas, createScene, { isDebug: () => debug.value });
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
  }, [createScene]);

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

// Mounts a brand's studio into #root.
function startStudio(createScene: SceneFactory): void {
  const root = document.getElementById("root");
  if (!root) {
    throw new Error("#root is missing");
  }
  createRoot(root).render(<App createScene={createScene} />);
}

export { startStudio };
