import { alphaOf } from "../colors/colors";

// Clears every pixel that is not fully opaque, in place, and returns how many
// part-transparent pixels it dropped. Clear means exactly zero.
//
// Dropping rather than snapping to opaque is deliberate. A canvas stores pixels
// premultiplied, so reading a part-transparent one back cannot return its
// original colour — rgba(192,64,64,200) comes out as 193,64,64 — and a province
// is identified by an exact colour. Keeping such a pixel would invent a province
// that matches no manifest entry. Exports from this editor are always fully
// opaque or fully clear, so this only fires on images from elsewhere, and the
// count is reported.
//
// Clear pixels have to be zero and not merely alpha-zero: flood fill compares
// whole values, and invisible pixels carrying different colours would stop a
// fill for no visible reason.
function dropPartialAlpha(pixels: Uint32Array): number {
  let dropped = 0;

  for (let index = 0; index < pixels.length; index += 1) {
    const alpha = alphaOf(pixels[index]);

    if (alpha === 255) {
      continue;
    }

    if (alpha > 0) {
      dropped += 1;
    }

    pixels[index] = 0;
  }

  return dropped;
}

export { dropPartialAlpha };
