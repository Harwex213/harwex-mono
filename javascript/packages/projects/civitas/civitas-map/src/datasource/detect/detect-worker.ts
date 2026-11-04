import {
  colorizeLabels,
  detectProvinces,
  type DetectOptions,
  type DetectStats,
  type DetectedProvince,
} from "../../domain/index";

// Detection touches every pixel a dozen times over. On a 10-megapixel map that is
// about a second of straight-line work, which would freeze the editor, so it runs
// here and posts back a finished province layer.

type DetectRequest = {
  rgba: ArrayBuffer;
  width: number;
  height: number;
  options: Partial<DetectOptions>;
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
    const { pixels, provinces } = colorizeLabels(result, width, height);
    const response: DetectResponse = {
      ok: true,
      pixels: pixels.buffer as ArrayBuffer,
      provinces,
      stats: result.stats,
    };

    // The pixel buffer is handed over rather than copied; it is 40 MB on a map
    // this size.
    scope.postMessage(response, [response.pixels]);
  } catch (cause) {
    const response: DetectResponse = {
      ok: false,
      message: cause instanceof Error ? cause.message : String(cause),
    };

    scope.postMessage(response);
  }
};

export {
  type DetectRequest,
  type DetectResponse,
};
