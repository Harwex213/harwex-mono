import { useEffect, useRef } from "react";
import type { FC } from "react";
import cityPortrait from "../../assets/city-portrait.jpg";
import city from "../../assets/city.jpg";
import { mountBackground } from "../shaders/background";
import { mountHologramImage } from "../shaders/hologram-image";
import type { TTint } from "../shaders/hologram-image";
import { useMobile } from "../use-mobile";

const BackgroundCanvas: FC = () => {
  const mobile = useMobile();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    // The river starts at a different height in each photo.
    return mobile
      ? mountBackground(ref.current, { src: cityPortrait, water: 0.675, lite: true })
      : mountBackground(ref.current, { src: city, water: 0.7, lite: false });
  }, [mobile]);

  // A canvas keeps its first context, so switching the quality needs a fresh element.
  return <canvas key={mobile ? "mobile" : "desktop"} ref={ref} className="background-canvas" aria-hidden="true" />;
};

type THologramImageProps = {
  src: string;
  label: string;
  tint: TTint;
  className?: string;
};

const HologramImage: FC<THologramImageProps> = ({ src, label, tint, className }) => {
  const mobile = useMobile();
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    if (!ref.current) {
      return;
    }
    return mountHologramImage(ref.current, src, { tint, lite: mobile });
  }, [src, tint, mobile]);

  return (
    <canvas
      key={mobile ? "mobile" : "desktop"}
      ref={ref}
      className={`hologram ${className ?? ""}`}
      role="img"
      aria-label={label}
    />
  );
};

export { BackgroundCanvas, HologramImage };
