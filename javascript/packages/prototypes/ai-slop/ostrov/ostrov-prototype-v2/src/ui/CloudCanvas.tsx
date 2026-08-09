import { useEffect, useRef } from "react";
import { CloudLayer } from "../render/clouds";
import { fogUniforms } from "../state/fog";
import { camera } from "../state/signals";

/**
 * The sky layer: a WebGL canvas parked behind the map canvas.
 *
 * It reads the camera and the fog without subscribing to either. The clouds
 * redraw every frame regardless, so a subscription would only add work.
 */
function CloudCanvas(): React.JSX.Element {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) {
      return;
    }
    const layer = new CloudLayer(
      canvas,
      () => camera.peek(),
      (now) => fogUniforms(now),
    );
    return layer.start();
  }, []);

  return <canvas ref={ref} className="cloud-canvas" aria-hidden="true" />;
}

export { CloudCanvas };
