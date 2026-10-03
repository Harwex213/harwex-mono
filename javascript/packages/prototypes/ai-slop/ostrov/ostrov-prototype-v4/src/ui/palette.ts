/**
 * The same colours as the `:root` tokens in `app.css`. Canvases cannot read CSS
 * variables cheaply, so every canvas layer (island, globe, battle, tax flights)
 * takes its colours from here and the two files stay in step by hand.
 */

const PALETTE = {
  /** The dark blue field of the end-turn reference, `01-spec-image-2.png`. */
  bg: "#081426",
  bgDeep: "#050d19",
  panel: "#10233d",
  panelSoft: "#18314f",
  line: "#2a4a73",
  gold: "#ffd75e",
  goldDim: "#b9902f",
  text: "#e9f1f9",
  textDim: "#93aec6",
  /** Toxicity is green in `01-spec-image-6.png`, the insane counter is pink. */
  toxic: "#7fd08a",
  insane: "#ff8ec4",
  danger: "#ff6b5e",
} as const;

/** Pennant colours from the player list reference, `01-spec-image-3.png`. The human is green. */
const PLAYER_COLOURS = {
  green: "#5ec26a",
  teal: "#35c6b6",
  blue: "#4d8dff",
  orange: "#ff9b3d",
} as const;

type TPaletteKey = keyof typeof PALETTE;
type TPlayerColourKey = keyof typeof PLAYER_COLOURS;

export type { TPaletteKey, TPlayerColourKey };
export { PALETTE, PLAYER_COLOURS };
