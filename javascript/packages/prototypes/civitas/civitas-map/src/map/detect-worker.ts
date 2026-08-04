import { generateColor, packOpaque } from "./colors";
import { detectProvinces, type DetectOptions, type DetectStats } from "./detect-provinces";

// Detection touches every pixel a dozen times over. On a 10-megapixel map that is
// about a second of straight-line work, which would freeze the editor, so it runs
// here and posts back a finished province layer.

type DetectRequest = {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  options: Partial<DetectOptions>;
};

type DetectedProvince = {
  index: number;
  color: number;
  lake: boolean;
};

type DetectResponse =
  | {
      ok: true;
      pixels: ArrayBuffer;
      provinces: DetectedProvince[];
      stats: DetectStats;
    }
  | {
      ok: false;
      message: string;
    };

// `lib` includes DOM rather than WebWorker, so `self` is typed as a window here.
// Narrowing it locally is less invasive than a second tsconfig for one file.
const scope = self as unknown as {
  onmessage: ((event: MessageEvent<DetectRequest>) => void) | null;
  postMessage: (message: DetectResponse, transfer?: Transferable[]) => void;
};

scope.onmessage = (event: MessageEvent<DetectRequest>) => {
  const { rgba, width, height, options } = event.data;

  try {
    const result = detectProvinces(new Uint8Array(rgba), width, height, options);
    const taken = new Set<number>();
    const provinces: DetectedProvince[] = [];
    // Index 0 is "no province", so the colour table is one longer than the count.
    const colorOfLabel = new Uint32Array(result.count + 1);

    for (let label = 1; label <= result.count; label += 1) {
      const color = packOpaque(generateColor(label, taken));

      taken.add(color);
      colorOfLabel[label] = color;
      provinces.push({ index: label, color, lake: result.isLake[label] === 1 });
    }

    const pixels = new Uint32Array(width * height);

    for (let i = 0; i < pixels.length; i += 1) {
      const label = result.labels[i];

      if (label !== 0) {
        pixels[i] = colorOfLabel[label];
      }
    }

    const response: DetectResponse = {
      ok: true,
      pixels: pixels.buffer,
      provinces,
      stats: result.stats,
    };

    // The pixel buffer is handed over rather than copied; it is 40 MB on a map
    // this size.
    scope.postMessage(response, [pixels.buffer]);
  } catch (cause) {
    const response: DetectResponse = {
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    };

    scope.postMessage(response);
  }
};

export type { DetectRequest, DetectResponse, DetectedProvince };
