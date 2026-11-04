import {
  generateColor,
  packOpaque,
} from "../colors/colors";
import type { DetectResult } from "./detect-provinces";

// Turns the labels of a detection into a province layer: one generated colour
// per label, written into a pixel array the layer can load as it is.

type DetectedProvince = {
  index: number;
  color: number;
};

type ColorizedProvinces = {
  pixels: Uint32Array;
  provinces: DetectedProvince[];
};

function colorizeLabels(result: DetectResult, width: number, height: number): ColorizedProvinces {
  const taken = new Set<number>();
  const provinces: DetectedProvince[] = [];
  // Index 0 is "no province", so the colour table is one longer than the count.
  const colorOfLabel = new Uint32Array(result.count + 1);

  for (let label = 1; label <= result.count; label += 1) {
    const color = packOpaque(generateColor(label, taken));

    taken.add(color);
    colorOfLabel[label] = color;
    provinces.push({ index: label, color });
  }

  const pixels = new Uint32Array(width * height);

  for (let i = 0; i < pixels.length; i += 1) {
    const label = result.labels[i];

    if (label !== 0) {
      pixels[i] = colorOfLabel[label];
    }
  }

  return { pixels, provinces };
}

export {
  colorizeLabels,
  type ColorizedProvinces,
  type DetectedProvince,
};
