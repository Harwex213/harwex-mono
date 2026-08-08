import { useEffect, useRef } from "react";
import { CloudLayer } from "../render/clouds";
import { camera } from "../state/signals";

/**
 * The sky layer: a WebGL canvas parked behind the map canvas.
 *
 * It reads the camera without subscribing to it. The clouds redraw every frame
 * regardless, so a subscription would only add work.
 */
function CloudCanvas(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const layer = new CloudLayer(canvas, () => camera.peek());
    return layer.start();
  }, []);

  return <canvas ref={ref} className="cloud-canvas" aria-hidden="true" />;
}

export { CloudCanvas };
