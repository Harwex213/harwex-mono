import type { HarnessBridge } from "../../shared/bridge.js";

declare global {
  interface Window {
    harness: HarnessBridge;
  }
}

const harness: HarnessBridge = window.harness;

/** A short, file-name-safe id. The main process refuses anything else. */
function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const noise = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `${prefix}-${stamp}-${noise}`;
}

/** The URL an image node renders. `stamp` busts the cache after a rerun. */
function imageUrl(dir: string, id: string, stamp: number): string {
  const file = `${dir}/images/${id}.png`;
  return `imagen://file?path=${encodeURIComponent(file)}&v=${stamp}`;
}

export { harness, imageUrl, newId };
