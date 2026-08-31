import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import type { Request, Response } from "express";
import { RaceRoom } from "./rooms/RaceRoom.js";

const startedAt = Date.now();
const version = process.env.npm_package_version ?? "0.1.0";
const port = Number(process.env.PORT ?? 2567);

const transport = new WebSocketTransport();
transport.getExpressApp().get("/health", (_request: Request, response: Response) => {
  response.setHeader("cache-control", "no-store");
  response.json({ status: "ok", version, uptime: Math.floor((Date.now() - startedAt) / 1_000) });
});
const gameServer = new Server({ transport });
gameServer.define("race", RaceRoom);

await gameServer.listen(port);
console.info(JSON.stringify({ event: "server_started", port, version, timestamp: new Date().toISOString() }));

const shutdown = async (): Promise<void> => {
  await gameServer.gracefullyShutdown(false);
};

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
