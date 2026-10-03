import { useEffect, useRef, useState } from "react";
import { groundSeed, renderIslandGround } from "./render-island-ground";
import type { TGroundHex } from "./render-island-ground";

type TIslandGroundImage = {
  /** An object URL of the ground PNG, ready for an SVG `<image href>`. */
  readonly href: string;
  /** World rectangle of the image. */
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
};

/** The old image stays on screen until the new one has had time to decode. */
const REVOKE_DELAY_MS = 2000;

/**
 * The painted ground of an island as an image URL. The ground is painted
 * again only when the set of hexes or a biome changes, not on hover, pan or
 * any other hex change. Null until the first image is ready, and null when
 * the browser has no WebGL2.
 */
const useIslandGround = (hexes: readonly TGroundHex[], seedKey: string) => {
  const [image, setImage] = useState<TIslandGroundImage | null>(null);
  const latestRef = useRef<TIslandGroundImage | null>(null);
  const hexesRef = useRef(hexes);
  hexesRef.current = hexes;
  const layout = hexes.map((hex) => `${hex.q},${hex.r}:${hex.biome}`).join(";");

  useEffect(() => {
    let cancelled = false;

    renderIslandGround(hexesRef.current, { seed: groundSeed(seedKey) })
      .then((ground) => {
        if (!ground) {
          return;
        }

        if (cancelled) {
          ground.canvas.width = 0;

          return;
        }

        console.debug(`island ground ${ground.canvas.width}x${ground.canvas.height} in ${ground.renderMs.toFixed(1)} ms`);
        ground.canvas.toBlob((blob) => {
          ground.canvas.width = 0;
          if (!blob || cancelled) {
            return;
          }

          const href = URL.createObjectURL(blob);
          setImage((previous) => {
            if (previous) {
              setTimeout(() => URL.revokeObjectURL(previous.href), REVOKE_DELAY_MS);
            }

            return { href, x: ground.x, y: ground.y, width: ground.width, height: ground.height };
          });
        }, "image/png");
      })
      .catch((error: unknown) => {
        console.error(error);
      });

    return () => {
      cancelled = true;
    };
  }, [layout, seedKey]);

  // The last image is freed when the canvas goes away.
  useEffect(() => {
    return () => {
      if (latestRef.current) {
        URL.revokeObjectURL(latestRef.current.href);
      }
    };
  }, []);

  latestRef.current = image;

  return image;
};

export { useIslandGround };
export type { TIslandGroundImage };
