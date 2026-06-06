import type { Express, Request, Response } from "express";
import type { ApiEndpoint, InferRequest, InferResponse } from "@dbapp/shared";
import { z } from "zod";

export function serveEndpoint<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
  app: Express,
  endpoint: ApiEndpoint<TReq, TRes>,
  handler: (
    data: InferRequest<ApiEndpoint<TReq, TRes>>,
  ) => Promise<InferResponse<ApiEndpoint<TReq, TRes>>>,
): void {
  const method = endpoint.method.toLowerCase() as "get" | "post" | "put" | "patch" | "delete";
  app[method](endpoint.path, async (req: Request, res: Response) => {
    try {
      const input =
        endpoint.method === "GET"
          ? endpoint.requestType.parse(req.query)
          : endpoint.requestType.parse(req.body);
      const out = await handler(input);
      const parsed = endpoint.responseType.parse(out);
      res.json(parsed);
    } catch (e) {
      if (e instanceof z.ZodError) {
        res.status(400).json({ error: "validation", issues: e.issues });
        return;
      }
      res.status(500).json({ error: (e as Error).message });
    }
  });
}
