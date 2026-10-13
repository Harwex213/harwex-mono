import { useEffect, useRef } from "react";
import type { FC } from "react";
import { mountBackground } from "../shaders/background";
import { mountDitherImage } from "../shaders/dither-image";
import { mountLavaLamp } from "../shaders/lava-lamp";
import { mountLiquidImage } from "../shaders/liquid-image";
import { useMobile } from "../use-mobile";

const BackgroundCanvas: FC = () => {
  const mobile = useMobile();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    return mobile ? mountLavaLamp(ref.current) : mountBackground(ref.current);
  }, [mobile]);

  // A canvas keeps its first context type, so switching shaders needs a fresh element.
  return <canvas key={mobile ? "mobile" : "desktop"} ref={ref} className="background-canvas" aria-hidden="true" />;
};

type TLiquidImageProps = {
  src: string;
  label: string;
  // Above 1 crops into the photo, so the subject fills more of the canvas.
  zoom?: number;
  className?: string;
};

const LiquidImage: FC<TLiquidImageProps> = ({ src, label, zoom = 1, className }) => {
  const mobile = useMobile();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    return mobile ? mountDitherImage(ref.current, src, zoom) : mountLiquidImage(ref.current, src, zoom);
  }, [src, zoom, mobile]);

  return (
    <canvas
      key={mobile ? "mobile" : "desktop"}
      ref={ref}
      className={`liquid-image ${className ?? ""}`}
      role="img"
      aria-label={label}
    />
  );
};

export { BackgroundCanvas, LiquidImage };
