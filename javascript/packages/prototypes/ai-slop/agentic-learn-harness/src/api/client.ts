import type { AskEvent, AskRequest, Graph, UploadedImage } from "../../shared/types.ts";

const IMAGE_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"];

function imageUrl(id: string): string {
  return `/api/images/${id}`;
}

async function uploadImage(file: File): Promise<UploadedImage> {
  if (!IMAGE_TYPES.includes(file.type)) {
    throw new Error(`${file.name || "That file"} is not a PNG, JPEG, GIF, or WebP image.`);
  }
  const response = await fetch("/api/images", {
    method: "POST",
    headers: {
      "content-type": file.type,
      "x-image-name": encodeURIComponent(file.name || "pasted-image"),
    },
    body: await file.arrayBuffer(),
  });
  if (!response.ok) {
    throw new Error(await describeFailure(response));
  }
  return (await response.json()) as UploadedImage;
}

async function describeFailure(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? `Request failed with ${response.status}.`;
  } catch {
    return `Request failed with ${response.status}.`;
  }
}

async function loadGraph(): Promise<Graph | null> {
  try {
    const response = await fetch("/api/graph");
    if (!response.ok) {
      return null;
    }
    return (await response.json()) as Graph;
  } catch {
    return null;
  }
}

async function saveGraph(graph: Graph): Promise<void> {
  await fetch("/api/graph", {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(graph),
  });
}

/**
 * Streams one question through the harness. `onEvent` fires for every harness
 * event; the promise settles when the turn ends or the caller aborts.
 */
async function ask(
  request: AskRequest,
  onEvent: (event: AskEvent) => void,
  signal: AbortSignal,
): Promise<void> {
  const response = await fetch("/api/ask", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(request),
    signal,
  });
  if (!response.ok || !response.body) {
    onEvent({ type: "error", message: await describeFailure(response) });
    return;
  }
  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader();
  let buffer = "";
  while (true) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }
    buffer += value;
    // SSE frames are separated by a blank line.
    let boundary = buffer.indexOf("\n\n");
    while (boundary !== -1) {
      const frame = buffer.slice(0, boundary);
      buffer = buffer.slice(boundary + 2);
      dispatchFrame(frame, onEvent);
      boundary = buffer.indexOf("\n\n");
    }
  }
}

function dispatchFrame(frame: string, onEvent: (event: AskEvent) => void): void {
  const payload = frame
    .split("\n")
    .filter((line) => {
      return line.startsWith("data:");
    })
    .map((line) => {
      return line.slice(5).trimStart();
    })
    .join("\n");
  if (payload.length === 0) {
    return;
  }
  try {
    onEvent(JSON.parse(payload) as AskEvent);
  } catch {
    /* a malformed frame is not worth tearing the stream down for */
  }
}

export { ask, imageUrl, loadGraph, saveGraph, uploadImage };
