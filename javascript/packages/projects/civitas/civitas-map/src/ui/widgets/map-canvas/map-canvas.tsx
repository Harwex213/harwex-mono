import { useSignals } from "@preact/signals-react/runtime";
import { useEffect, useRef } from "react";
import {
  createMapCanvasService,
  type TMapCanvasServiceRegistry,
} from "../../../services/index";
import { useStore } from "../../../store/index";
import styles from "./map-canvas.module.css";

type TMapCanvasProps = {
  registry: TMapCanvasServiceRegistry;
};

// The host and the two canvases. `MapCanvasService` draws them and handles their
// input; this component only creates the service and disposes of it.
function MapCanvas({ registry }: TMapCanvasProps) {
  useSignals();

  const store = useStore();
  const hostRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<HTMLCanvasElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);

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
      {!store.map.info.value && <p className={styles.empty}>Load a map image to start</p>}
    </div>
  );
}

export { MapCanvas };
