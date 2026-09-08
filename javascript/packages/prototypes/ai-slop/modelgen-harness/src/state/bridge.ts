import type { HarnessBridge } from "../../shared/bridge.js";
import { SCHEME } from "../../shared/bridge.js";

declare global {
  interface Window {
    harness: HarnessBridge;
  }
}

const harness: HarnessBridge = window.harness;

/** The URL the viewer loads a tab's model from. `stamp` busts the cache after an export. */
function modelUrl(tabId: string, stamp: number): string {
  return `${SCHEME}://model?tab=${encodeURIComponent(tabId)}&v=${stamp}`;
}

/** The URL a stored picture renders from. */
function imageUrl(id: string): string {
  return `${SCHEME}://image?id=${encodeURIComponent(id)}`;
}

export { harness, imageUrl, modelUrl };
