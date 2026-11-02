import type { ServerResponse } from "node:http";

// Live viewers of each pick, fed over server-sent events.
const createEventHub = () => {
  const listeners = new Map<string, Set<ServerResponse>>();

  const subscribe = (id: string, response: ServerResponse) => {
    let set = listeners.get(id);
    if (!set) {
      set = new Set();
      listeners.set(id, set);
    }
    set.add(response);

    // A proxy drops an idle stream: a comment line every 20 s keeps it open.
    const keepAlive = setInterval(() => {
      response.write(": ping\n\n");
    }, 20_000);

    response.on("close", () => {
      clearInterval(keepAlive);
      set.delete(response);
      if (set.size === 0) {
        listeners.delete(id);
      }
    });
  };

  const publish = (id: string, payload: unknown) => {
    const data = `data: ${JSON.stringify(payload)}\n\n`;
    for (const response of listeners.get(id) ?? []) {
      response.write(data);
    }
  };

  return { subscribe, publish };
};

export { createEventHub };
