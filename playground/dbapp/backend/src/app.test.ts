import { describe, expect, it } from "vitest";
import request from "supertest";
import { createApp } from "./app.js";

describe("backend /health", () => {
  it("returns ok:true", async () => {
    const res = await request(createApp()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(typeof res.body.service).toBe("string");
  });
});
