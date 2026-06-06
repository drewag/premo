import { describe, expect, it } from "vitest";
import { ApiSchema } from "./routes.js";

describe("ApiSchema", () => {
  it("defines a /health endpoint with the expected shape", () => {
    expect(ApiSchema.health.method).toBe("GET");
    expect(ApiSchema.health.path).toBe("/health");
    expect(() => ApiSchema.health.requestType.parse({})).not.toThrow();
    const ok = ApiSchema.health.responseType.parse({ ok: true, service: "test" });
    expect(ok).toEqual({ ok: true, service: "test" });
  });

  it("rejects malformed responses", () => {
    expect(() => ApiSchema.health.responseType.parse({ ok: false })).toThrow();
  });
});
