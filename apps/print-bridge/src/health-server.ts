import { createServer, type Server } from "node:http";

import type { BridgeState } from "./state.js";

export function startHealthServer(port: number, state: BridgeState): Server {
  const server = createServer((request, response) => {
    const snapshot = state.snapshot();

    if (request.url === "/healthz") {
      response.writeHead(200, { "Content-Type": "application/json" });
      response.end(JSON.stringify(snapshot));
      return;
    }

    if (request.url === "/readyz") {
      const ready = snapshot.status === "ok";
      response.writeHead(ready ? 200 : 503, {
        "Content-Type": "application/json",
      });
      response.end(JSON.stringify(snapshot));
      return;
    }

    response.writeHead(404, { "Content-Type": "application/json" });
    response.end(JSON.stringify({ error: "not_found" }));
  });

  server.listen(port, "0.0.0.0");
  return server;
}

export async function stopHealthServer(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    });
  });
}
