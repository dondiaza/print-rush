import { createServer } from "node:http";
import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { RaceRoom } from "./rooms/RaceRoom.js";

const startedAt = Date.now();
const version = process.env.npm_package_version ?? "0.1.0";
const port = Number(process.env.PORT ?? 2567);

const httpServer = createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json", "cache-control": "no-store" });
    response.end(JSON.stringify({ status: "ok", version, uptime: Math.floor((Date.now() - startedAt) / 1_000) }));
    return;
  }
  response.writeHead(404, { "content-type": "application/json" });
  response.end(JSON.stringify({ error: "not_found" }));
});

const gameServer = new Server({ transport: new WebSocketTransport({ server: httpServer }) });
gameServer.define("race", RaceRoom);

await gameServer.listen(port);
console.info(JSON.stringify({ event: "server_started", port, version, timestamp: new Date().toISOString() }));

const shutdown = async (): Promise<void> => {
  await gameServer.gracefullyShutdown(false);
  httpServer.close();
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
