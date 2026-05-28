import express from "express";
import { ApiSchema } from "@{{projectName}}/shared";
import { serveEndpoint } from "./serveEndpoint.js";

export function createApp(): express.Express {
  const app = express();
  app.use(express.json());

  serveEndpoint(app, ApiSchema.health, async () => ({
    ok: true as const,
    service: "{{projectName}}-backend",
  }));

  return app;
}
