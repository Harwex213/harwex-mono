import { randomBytes } from "node:crypto";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import type { ImageGenerator, ReferenceImage } from "./codex-image.js";
import { log } from "./config.js";
import { BusyError } from "./limits.js";
import type { GenerationQueue } from "./limits.js";

const MAX_IMAGES = 5;
const HEARTBEAT_MS = 10_000;
const GENERATION_TIMEOUT_MS = 5 * 60_000;
const PROMPT_LOG_CHARS = 60;

type ToolDeps = {
  generator: ImageGenerator;
  queue: GenerationQueue;
};

const inputSchema = {
  prompt: z.string().trim().min(1).describe("Full description of the image to generate or of the edit to make."),
  images: z
    .array(
      z.object({
        data: z.string().min(1).describe("Base64 image bytes."),
        mimeType: z.enum(["image/png", "image/jpeg", "image/webp"]),
      }),
    )
    .max(MAX_IMAGES)
    .optional()
    .describe("Reference images, at most 5."),
  size: z.enum(["1024x1024", "1536x1024", "1024x1536", "auto"]).optional().describe("Output size hint."),
};

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function promptPrefix(prompt: string): string {
  const flat = prompt.replace(/\s+/g, " ");
  return flat.length > PROMPT_LOG_CHARS ? `${flat.slice(0, PROMPT_LOG_CHARS)}...` : flat;
}

function registerGenerateImage(server: McpServer, deps: ToolDeps): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description: "Generate one image with Codex image_gen from a prompt and optional reference images. Takes 30 s to 5 min.",
      inputSchema,
    },
    async (args, extra): Promise<CallToolResult> => {
      const id = randomBytes(4).toString("hex");
      const started = Date.now();
      const summary = `refs=${args.images?.length ?? 0} size=${args.size ?? "-"} prompt="${promptPrefix(args.prompt)}"`;
      const finish = (outcome: string): void => {
        const seconds = ((Date.now() - started) / 1000).toFixed(1);
        log(`gen ${id} ${outcome} ${seconds}s ${summary}`);
      };

      const references: ReferenceImage[] = [];
      for (const image of args.images ?? []) {
        const data = Buffer.from(image.data, "base64");
        if (data.length === 0) {
          finish("error: empty reference image");
          return errorResult("A reference image has no data after base64 decoding.");
        }
        references.push({ data, mimeType: image.mimeType });
      }

      // Progress needs a token from the client. Without one, nothing is sent.
      const progressToken = extra._meta?.progressToken;
      let progress = 0;
      const sendProgress = (message: string): void => {
        if (progressToken === undefined) {
          return;
        }
        progress += 1;
        extra
          .sendNotification({
            method: "notifications/progress",
            params: { progressToken, progress, message },
          })
          .catch(() => {});
      };

      // The heartbeat keeps Cloudflare's 100 s idle cutoff and the client's idle timeout from firing.
      // It runs in the queue too: a waiting job hears nothing else until its place changes.
      let queuePosition = 0;
      let runStarted: number | undefined;
      const heartbeat = setInterval(() => {
        if (runStarted === undefined) {
          sendProgress(`queued, position ${queuePosition}`);
          return;
        }
        sendProgress(`generating, ${Math.round((Date.now() - runStarted) / 1000)}s`);
      }, HEARTBEAT_MS);

      let release: () => void;
      try {
        release = await deps.queue.acquire(extra.signal, (position) => {
          queuePosition = position;
          sendProgress(`queued, position ${position}`);
        });
      } catch (error) {
        clearInterval(heartbeat);
        if (error instanceof BusyError) {
          finish("busy");
          return errorResult(error.message);
        }
        finish("cancelled in queue");
        return errorResult("Generation cancelled.");
      }

      // The hard limit counts from the moment the job leaves the queue.
      const timeout = AbortSignal.timeout(GENERATION_TIMEOUT_MS);
      const signal = AbortSignal.any([extra.signal, timeout]);
      runStarted = Date.now();
      sendProgress("generating, 0s");

      try {
        const image = await deps.generator.generate(
          { prompt: args.prompt, references, size: args.size },
          signal,
        );
        finish(`ok ${image.data.length}B thread=${image.threadId}`);
        return {
          content: [
            { type: "image", data: image.data.toString("base64"), mimeType: image.mimeType },
            { type: "text", text: `Generated in ${((Date.now() - started) / 1000).toFixed(1)} s.` },
          ],
        };
      } catch (error) {
        if (timeout.aborted) {
          finish("error: timeout");
          return errorResult(`Generation timed out after ${GENERATION_TIMEOUT_MS / 60_000} min.`);
        }
        if (extra.signal.aborted) {
          finish("cancelled");
          return errorResult("Generation cancelled.");
        }
        finish(`error: ${errorMessage(error)}`);
        return errorResult(`Generation failed: ${errorMessage(error)}`);
      } finally {
        clearInterval(heartbeat);
        release();
      }
    },
  );
}

export { registerGenerateImage };
