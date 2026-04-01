import { createServer } from "node:http";
import * as fs from "node:fs";
import * as path from "node:path";
import { RpcError } from "./core/error.js";
import { handleRpc, sendJSON, getRegisteredMethods } from "./core/rpc.js";

const handlersDir = path.join(import.meta.dirname, "handlers");
const handlerFiles = fs.readdirSync(handlersDir).filter(f => f.endsWith(".ts"));
await Promise.all(handlerFiles.map(f => import(path.join(handlersDir, f))));

const server = createServer(async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");

  if (req.method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.url !== "/rpc") {
    sendJSON(res, 404, { error: { code: "NOT_FOUND", message: `No route: ${req.url}` } });
    return;
  }

  try {
    await handleRpc(req, res);
  } catch (err) {
    if (err instanceof RpcError) {
      sendJSON(res, err.statusCode, { error: err.toJSON() });
    } else {
      console.error("Unhandled error:", err);
      sendJSON(res, 500, {
        error: { code: "INTERNAL_ERROR", message: "Internal server error" },
      });
    }
  }
});

const HOST = process.env["HOST"] ?? "0.0.0.0";
const PORT = Number(process.env["PORT"] ?? 3000);

server.listen(PORT, HOST, () => {
  console.log(`Server listening on http://${HOST}:${PORT}`);
  console.log(`Registered methods:\n${getRegisteredMethods().map((m: string) => `  - ${m}`).join("\n")}`);
});
