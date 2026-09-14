import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { SERVER_NAME, SERVER_VERSION } from "../meta.js";
import type { BlenderSession } from "../session.js";
import type { ToolDefinition } from "../tools.js";

/**
 * The stdio MCP server. Claude Code and Codex both spawn a command and speak
 * JSON-RPC over its stdin and stdout, so stdout belongs to the protocol
 * alone: everything this package says goes to stderr, and the Blender
 * process's own output is collected rather than inherited.
 */

function toCallResult(text: string, image: Uint8Array | undefined, isError: boolean | undefined): CallToolResult {
  const content: CallToolResult["content"] = [{ type: "text", text }];
  if (image) {
    content.push({ type: "image", data: Buffer.from(image).toString("base64"), mimeType: "image/png" });
  }
  return isError ? { content, isError: true } : { content };
}

/** An MCP server with the given tools registered on it, not yet connected. */
function createMcpServer(tools: ToolDefinition[]): McpServer {
  const mcp = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
  for (const definition of tools) {
    mcp.registerTool(
      definition.name,
      { description: definition.description, inputSchema: definition.schema },
      async (args: Record<string, unknown>) => {
        const result = await definition.execute(args ?? {});
        return toCallResult(result.text, result.image, result.isError);
      },
    );
  }
  return mcp;
}

/**
 * Serves the session's tools over stdio and resolves once the client
 * disconnects. A session given a `.blend` opens it here; one given none
 * starts without a Blender at all, and waits for `open_blend_file`. Blender
 * is stopped on the way out, whichever way the process is asked to leave.
 */
async function serveStdio(session: BlenderSession): Promise<void> {
  await session.start();
  const opened = session.blendPath();
  process.stderr.write(
    opened
      ? `[${SERVER_NAME}] Blender ready for ${opened}\n`
      : `[${SERVER_NAME}] Ready. No .blend open yet; call open_blend_file.\n`,
  );
  const mcp = createMcpServer(session.tools());
  const transport = new StdioServerTransport();
  const closed = new Promise<void>((resolve) => {
    transport.onclose = () => {
      resolve();
    };
  });

  let leaving = false;
  const leave = (): void => {
    if (leaving) {
      return;
    }
    leaving = true;
    void (async () => {
      await mcp.close().catch(() => {});
      await session.stop();
      process.exit(0);
    })();
  };
  process.on("SIGINT", leave);
  process.on("SIGTERM", leave);

  await mcp.connect(transport);
  await closed;
  await session.stop();
}

export { createMcpServer, serveStdio, SERVER_NAME, SERVER_VERSION };
