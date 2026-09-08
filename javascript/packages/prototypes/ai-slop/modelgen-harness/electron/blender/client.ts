import net from "node:net";

/**
 * The wire the Blender MCP add-on speaks: one TCP connection per request, a
 * UTF-8 JSON object followed by a single NUL byte in each direction. This is
 * `connection.py` from the blender_mcp repo, in Node.
 */

interface BlenderResponse {
  status: "ok" | "error";
  result?: Record<string, unknown>;
  message?: string;
  stdout?: string;
  stderr?: string;
}

/** Same as the Python client: a render can take a while. */
const REQUEST_TIMEOUT_MS = 300_000;

function sendCode(
  port: number,
  code: string,
  strictJson: boolean,
  host = "127.0.0.1",
): Promise<BlenderResponse> {
  return new Promise((resolve, reject) => {
    const socket = net.connect({ port, host });
    const chunks: Buffer[] = [];
    let settled = false;
    const finish = (error: Error | null, response?: BlenderResponse) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      if (error) {
        reject(error);
        return;
      }
      resolve(response as BlenderResponse);
    };
    socket.setTimeout(REQUEST_TIMEOUT_MS);
    socket.on("connect", () => {
      const request = JSON.stringify({ type: "execute", code, strict_json: strictJson });
      socket.write(`${request}\0`);
    });
    socket.on("data", (chunk: Buffer) => {
      chunks.push(chunk);
      if (chunk.includes(0)) {
        parse();
      }
    });
    socket.on("end", parse);
    socket.on("timeout", () => {
      finish(new Error(`Blender did not answer within ${REQUEST_TIMEOUT_MS / 1000}s on port ${port}.`));
    });
    socket.on("error", (error: Error) => {
      finish(new Error(`Cannot reach Blender on port ${port}: ${error.message}`));
    });

    function parse(): void {
      if (settled) {
        return;
      }
      const buffer = Buffer.concat(chunks);
      const end = buffer.indexOf(0);
      if (end < 0) {
        if (buffer.length === 0) {
          finish(new Error("Empty response from Blender."));
        }
        return;
      }
      try {
        finish(null, JSON.parse(buffer.subarray(0, end).toString("utf8")) as BlenderResponse);
      } catch (error) {
        finish(new Error(`Invalid response from Blender: ${(error as Error).message}`));
      }
    }
  });
}

/** Waits until something accepts a connection on the port, or the deadline passes. */
async function waitForPort(port: number, deadlineMs: number, isAlive: () => boolean): Promise<boolean> {
  const deadline = Date.now() + deadlineMs;
  while (Date.now() < deadline) {
    if (!isAlive()) {
      return false;
    }
    const up = await new Promise<boolean>((resolve) => {
      const socket = net.connect({ port, host: "127.0.0.1" });
      socket.on("connect", () => {
        socket.destroy();
        resolve(true);
      });
      socket.on("error", () => {
        resolve(false);
      });
    });
    if (up) {
      return true;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return false;
}

/** Asks the OS for a free port and lets it go again. */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => {
        if (port > 0) {
          resolve(port);
        } else {
          reject(new Error("Could not find a free port."));
        }
      });
    });
    server.on("error", reject);
  });
}

export type { BlenderResponse };
export { freePort, sendCode, waitForPort };
