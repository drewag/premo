import express from "express";
import { ApiSchema } from "@dbapp/shared";
import { serveEndpoint } from "./serveEndpoint.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  serveEndpoint(app, ApiSchema.health, async () => ({
    ok: true as const,
    service: "dbapp-backend",
  }));

  return app;
}
