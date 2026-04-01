import type { IncomingMessage, ServerResponse } from "node:http";
import { RpcError } from "./error.js";

type RpcHandler<TParams = unknown, TResult = unknown> = (params: TParams) => Promise<TResult>;

const procedures = new Map<string, RpcHandler>();

const register = <TParams, TResult>(method: string, handler: RpcHandler<TParams, TResult>) => {
  procedures.set(method, handler as RpcHandler);
};

const readBody = (req: IncomingMessage): Promise<string> =>
  new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => resolve(Buffer.concat(chunks).toString()));
    req.on("error", reject);
  });

const sendJSON = (res: ServerResponse, statusCode: number, body: unknown) => {
  const json = JSON.stringify(body);
  res.writeHead(statusCode, {
    "Content-Type": "application/json",
    "Content-Length": Buffer.byteLength(json),
  });
  res.end(json);
};

const handleRpc = async (req: IncomingMessage, res: ServerResponse) => {
  if (req.method !== "POST") {
    throw new RpcError("METHOD_NOT_ALLOWED", "Only POST is accepted", 405);
  }

  const raw = await readBody(req);

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new RpcError("PARSE_ERROR", "Invalid JSON");
  }

  const { method, params } = parsed as { method?: string; params?: unknown };

  if (typeof method !== "string" || method.length === 0) {
    throw new RpcError("INVALID_REQUEST", "Missing or invalid \"method\" field");
  }

  const handler = procedures.get(method);
  if (!handler) {
    throw new RpcError("METHOD_NOT_FOUND", `Unknown method: ${method}`, 404);
  }

  const result = await handler(params);
  sendJSON(res, 200, { result });
};

const getRegisteredMethods = (): string[] => [...procedures.keys()];

export { register, handleRpc, sendJSON, getRegisteredMethods };
export type { RpcHandler };
