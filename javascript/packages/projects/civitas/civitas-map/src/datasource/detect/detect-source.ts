import type { DetectOptions, DetectStats, DetectedProvince } from "../../domain/index";
import type { DetectRequest, DetectResponse } from "./detect-worker";

// Runs border detection in a web worker. One worker per run: detection is rare,
// and a fresh worker holds no memory between runs.

type DetectOutcome = {
  pixels: Uint32Array;
  provinces: DetectedProvince[];
  stats: DetectStats;
};

type DetectSource = {
  // Takes ownership of `rgba`: its buffer is transferred to the worker.
  detect(rgba: Uint8ClampedArray, width: number, height: number, options: Partial<DetectOptions>): Promise<DetectOutcome>;
};

function createDetectSource(): DetectSource {
  return {
    async detect(rgba, width, height, options): Promise<DetectOutcome> {
      const worker = new Worker(new URL("./detect-worker.ts", import.meta.url), {
        type: "module",
      });

      try {
        const response = await new Promise<DetectResponse>((resolve, reject) => {
          worker.onmessage = (event: MessageEvent<DetectResponse>) => {
            resolve(event.data);
          };
          worker.onerror = (event) => {
            reject(new Error(event.message || "the detection worker failed"));
          };

          const request: DetectRequest = {
            rgba: rgba.buffer as ArrayBuffer,
            width,
            height,
            options,
          };

          worker.postMessage(request, [request.rgba]);
        });

        if (!response.ok) {
          throw new Error(response.message);
        }

        return {
          pixels: new Uint32Array(response.pixels),
          provinces: response.provinces,
          stats: response.stats,
        };
      } finally {
        worker.terminate();
      }
    },
  };
}

export {
  createDetectSource,
  type DetectOutcome,
  type DetectSource,
};
