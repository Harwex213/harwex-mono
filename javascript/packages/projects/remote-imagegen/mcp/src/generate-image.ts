import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { StreamableHTTPError } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult, ImageContent } from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { callRemote } from "./remote-client.js";
import type { RemoteImage } from "./remote-client.js";

const MAX_IMAGES = 5;

const MIME_BY_EXTENSION: Record<string, string> = {
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
};

const inputSchema = {
  prompt: z.string().trim().min(1).describe("Full description of the image to generate or of the edit to make."),
  images: z
    .array(z.string().min(1))
    .max(MAX_IMAGES)
    .optional()
    .describe("Paths to reference images (png, jpg, jpeg, webp), at most 5. Relative paths resolve against the working directory."),
  size: z
    .enum(["1024x1024", "1536x1024", "1024x1536", "auto"])
    .optional()
    .describe("Output size. Defaults to the server's choice."),
  output_path: z
    .string()
    .min(1)
    .describe("Where to save the generated image. Relative paths resolve against the working directory. Missing folders are created, an existing file is overwritten. The bytes are written as received (PNG)."),
};

function errorResult(message: string): CallToolResult {
  return { content: [{ type: "text", text: message }], isError: true };
}

async function readReference(filePath: string): Promise<RemoteImage> {
  const absolute = path.resolve(process.cwd(), filePath);
  const mimeType = MIME_BY_EXTENSION[path.extname(absolute).toLowerCase()];
  if (!mimeType) {
    throw new Error(`Unsupported reference image type: ${filePath}. Use png, jpg, jpeg or webp.`);
  }
  const info = await stat(absolute).catch(() => undefined);
  if (!info || !info.isFile()) {
    throw new Error(`Reference image not found: ${absolute}`);
  }
  const data = await readFile(absolute);
  return { data: data.toString("base64"), mimeType };
}

function remoteText(result: CallToolResult): string {
  const lines: string[] = [];
  for (const block of result.content) {
    if (block.type === "text") {
      lines.push(block.text);
    }
  }
  return lines.join("\n");
}

function registerGenerateImage(server: McpServer, configError: string | undefined): void {
  server.registerTool(
    "generate_image",
    {
      title: "Generate image",
      description:
        "Generate an image from a text prompt, optionally guided by reference images, and save it to output_path. "
        + "Generation takes 30 seconds to 5 minutes.",
      inputSchema,
    },
    async (args, extra): Promise<CallToolResult> => {
      // A missing token must not crash the server. The agent sees the error on the call instead.
      if (configError) {
        return errorResult(configError);
      }

      let images: RemoteImage[] | undefined;
      try {
        if (args.images && args.images.length > 0) {
          images = await Promise.all(args.images.map(readReference));
        }
      } catch (error) {
        return errorResult(error instanceof Error ? error.message : String(error));
      }

      // Forward remote progress only when the local caller asked for it with a token.
      const progressToken = extra._meta?.progressToken;
      const onprogress = progressToken === undefined
        ? undefined
        : (progress: { progress: number; total?: number; message?: string }) => {
          extra
            .sendNotification({
              method: "notifications/progress",
              params: { progressToken, ...progress },
            })
            .catch(() => {});
        };

      let result: CallToolResult;
      try {
        result = await callRemote(
          { prompt: args.prompt, images, size: args.size },
          { signal: extra.signal, onprogress },
        );
      } catch (error) {
        if (extra.signal.aborted) {
          return errorResult("Generation cancelled.");
        }
        const message = error instanceof Error ? error.message : String(error);
        if (error instanceof StreamableHTTPError && (error.code === 401 || error.code === 403)) {
          return errorResult(`Remote image server rejected the token. Check REMOTE_IMAGEGEN_TOKEN. (${message})`);
        }
        return errorResult(`Remote image server failed: ${message}`);
      }

      if (result.isError) {
        return errorResult(remoteText(result) || "Remote image server returned an error without a message.");
      }

      const image = result.content.find((block): block is ImageContent => block.type === "image");
      if (!image) {
        return errorResult(`Remote image server returned no image. ${remoteText(result)}`.trim());
      }

      const outputPath = path.resolve(process.cwd(), args.output_path);
      const bytes = Buffer.from(image.data, "base64");
      try {
        await mkdir(path.dirname(outputPath), { recursive: true });
        await writeFile(outputPath, bytes);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return errorResult(`Could not write ${outputPath}: ${message}`);
      }

      return {
        content: [
          { type: "text", text: `Saved ${outputPath} (${bytes.length} bytes, ${image.mimeType})` },
          image,
        ],
      };
    },
  );
}

export { registerGenerateImage };
