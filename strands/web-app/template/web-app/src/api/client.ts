import { z } from "zod";
import type { ApiEndpoint, InferRequest, InferResponse } from "@{{projectName}}/shared";

const API_BASE = import.meta.env.VITE_API_BASE ?? "";

export async function callEndpoint<TReq extends z.ZodTypeAny, TRes extends z.ZodTypeAny>(
  endpoint: ApiEndpoint<TReq, TRes>,
  input: InferRequest<ApiEndpoint<TReq, TRes>>,
): Promise<InferResponse<ApiEndpoint<TReq, TRes>>> {
  const url = new URL(API_BASE + endpoint.path, window.location.origin);
  const init: RequestInit = {
    method: endpoint.method,
    headers: { "content-type": "application/json" },
  };
  if (endpoint.method === "GET") {
    for (const [k, v] of Object.entries(input as Record<string, unknown>)) {
      if (v != null) url.searchParams.set(k, String(v));
    }
  } else {
    init.body = JSON.stringify(input);
  }
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`API ${endpoint.path} failed: ${res.status}`);
  return endpoint.responseType.parse(await res.json());
}
