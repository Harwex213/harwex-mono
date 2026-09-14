/**
 * A render and its size. The harness read this with Electron's image decoder;
 * outside Electron the PNG header answers the same question, and every picture
 * these tools hand back is a PNG that Blender itself wrote.
 */

interface Png {
  bytes: Uint8Array;
  width: number;
  height: number;
}

const SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

/**
 * Reads the size out of the IHDR chunk: eight bytes of signature, four of
 * chunk length, four of chunk type, then width and height as big-endian
 * 32-bit numbers.
 */
function readPng(bytes: Uint8Array): Png {
  if (bytes.length < 24 || SIGNATURE.some((byte, index) => bytes[index] !== byte)) {
    throw new Error("The file the render reported is not a PNG.");
  }
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return { bytes, width: view.getUint32(16), height: view.getUint32(20) };
}

export type { Png };
export { readPng };
