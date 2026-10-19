import { useEffect, useRef } from "react";
import { MapCanvasHud } from "./map-canvas-hud";
import { createMapCanvasService } from "../../../services/index";
import { useStore } from "../../../store/index";
import type { TMapCanvasServiceRegistry } from "../../../services/index";
import styles from "./map-canvas.module.css";

type TMapCanvasRegistry = TMapCanvasServiceRegistry;

// React renders the host and two canvases. `MapCanvasService` owns everything else.
function MapCanvas({ registry }: { registry: TMapCanvasRegistry }) {
  const store = useStore();
  const hostRef = useRef<HTMLDivElement | null>(null);
  const sceneRef = useRef<HTMLCanvasElement | null>(null);
  const overlayRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    const scene = sceneRef.current;
    const overlay = overlayRef.current;
    if (!host || !scene || !overlay) {
      return;
    }
    const service = createMapCanvasService(store, registry);
    service.attach(host, { scene, overlay });
    return () => {
      service.dispose();
    };
  }, [store, registry]);

  return (
    <div className={styles.host} ref={hostRef}>
      <canvas className={styles.canvas} ref={sceneRef} />
      <canvas className={styles.canvas} ref={overlayRef} />
      <MapCanvasHud />
    </div>
  );
}

export { MapCanvas, type TMapCanvasRegistry };
