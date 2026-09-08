import { nativeImage } from "electron";

/**
 * Every picture the chat stores is a PNG with a known size. Whatever the user
 * drops in — a JPEG, a WebP, a screenshot — goes through Electron's image
 * decoder once on the way in.
 */

interface Png {
  bytes: Uint8Array;
  width: number;
  height: number;
}

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
