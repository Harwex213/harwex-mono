#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { registerGenerateImage } from "./generate-image.js";
import { checkConfig, closeRemote, log } from "./remote-client.js";

async function main(): Promise<void> {
  // A missing token is reported on stderr now and on every tool call later.
  // The server still starts, so the client shows the tool and the clear error.
  const configError = checkConfig();
  if (configError) {
    log(configError);
  }

  const server = new McpServer({ name: "remote-imagegen", version: "0.1.0" });
  registerGenerateImage(server, configError);

  const shutdown = async (): Promise<void> => {
    await closeRemote();
    await server.close();
    process.exit(0);
  };
  process.on("SIGINT", () => {
    void shutdown();
  });
  process.on("SIGTERM", () => {
    void shutdown();
  });

  await server.connect(new StdioServerTransport());
}

main().catch((error: unknown) => {
  log(`fatal: ${error instanceof Error ? error.stack ?? error.message : String(error)}`);
  process.exit(1);
});
