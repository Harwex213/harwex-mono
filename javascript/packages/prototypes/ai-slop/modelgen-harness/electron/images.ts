import { nativeImage } from "electron";
import type { Png } from "@hw/headless-blender-mcp";

/**
 * Every picture the chat stores is a PNG with a known size — the same shape
 * `@hw/headless-blender-mcp` hands back for a render, so a render and an
 * attachment are stored the same way. Whatever the user drops in — a JPEG, a
 * WebP, a screenshot — goes through Electron's image decoder once on the way
 * in.
 */

function toPng(input: Uint8Array | Buffer): Png {
  const image = nativeImage.createFromBuffer(Buffer.from(input));
  if (image.isEmpty()) {
    throw new Error("The attachment is not an image this app can decode.");
  }
  const size = image.getSize();
  return { bytes: new Uint8Array(image.toPNG()), width: size.width, height: size.height };
}

function newId(prefix: string): string {
  const stamp = Date.now().toString(36);
  const noise = Math.floor(Math.random() * 0xffffff)
    .toString(36)
    .padStart(4, "0");
  return `${prefix}-${stamp}-${noise}`;
}

export type { Png };
export { newId, toPng };
