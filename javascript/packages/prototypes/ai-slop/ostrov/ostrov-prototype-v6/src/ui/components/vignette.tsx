import type { FC } from "react";

type TVignetteProps = {
  /** `starting` fades the vignette in and keeps it, `entering` fades it out. */
  mode: "starting" | "entering";
};

/**
 * The dark ring over the screen edges. The start of the game shows it after
 * "Начать", and every phase shows it while the player waits for the rivals.
 * It never takes the pointer, so the map still pans, zooms and shows tooltips.
 */
const Vignette: FC<TVignetteProps> = ({ mode }) => {
  return <div className={`island-page__vignette island-page__vignette--${mode}`} />;
};

export { Vignette };
