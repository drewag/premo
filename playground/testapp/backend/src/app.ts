import express from "express";
import { ApiSchema } from "@testapp/shared";
import { serveEndpoint } from "./serveEndpoint.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  serveEndpoint(app, ApiSchema.health, async () => ({
    ok: true as const,
    service: "testapp-backend",
  }));

  return app;
}
