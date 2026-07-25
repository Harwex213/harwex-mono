// Which of the renderer's optional passes are on. Throwing the switch is the
// app's business, not this package's: the flags come down from the boot, so
// nothing in here reads a URL or a setting and there is no "dev" branch inside the
// renderer — the dev app and the shipped game can simply disagree.
interface RenderFlags {
  // Contact shadows under the entities plus the shadows the cliffs cast. One flag
  // for both: they share the light direction, and half a lit map looks broken
  // rather than half-finished.
  shadows: boolean;
}

const DEFAULT_RENDER_FLAGS: RenderFlags = {
  shadows: true,
};

export type { RenderFlags };
export { DEFAULT_RENDER_FLAGS };
