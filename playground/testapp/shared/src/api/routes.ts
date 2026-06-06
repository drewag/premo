import { z } from "zod";
import { ApiEndpoint } from "./ApiEndpoint.js";

export const ApiSchema = {
  health: ApiEndpoint.create({
    method: "GET",
    path: "/health",
    requestType: z.object({}),
    responseType: z.object({ ok: z.literal(true), service: z.string() }),
  }),
};
