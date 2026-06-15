import { describe, expect, it } from "vitest";
import { pathFromOpenUrl, pickShareTarget } from "../../src/cli/commands/share.js";
import { getProvider, providerNames } from "../../src/core/share/index.js";
import { tailscaleProvider } from "../../src/core/share/tailscale.js";
import type { Target } from "../../src/core/targets.js";

// A minimal Target for selection tests — only name/ports/default matter here.
function t(name: string, opts: { port?: number; default?: boolean } = {}): Target {
  return {
    name,
    packages: [name],
    dev: [],
    deploy: null,
    deployCwd: "/",
    isDefault: opts.default ?? false,
    ...(opts.port !== undefined ? { ports: { base: opts.port } } : {}),
  };
}

describe("pathFromOpenUrl", () => {
  it("extracts the path (+query/hash) so it can graft onto a public origin", () => {
    expect(pathFromOpenUrl("http://localhost:${PORT}/app?x=1#top")).toBe("/app?x=1#top");
  });

  it("returns the bare root path for a plain localhost URL", () => {
    expect(pathFromOpenUrl("http://localhost:${PORT}")).toBe("/");
  });

  it("is empty when there's no openUrl or it's unparseable", () => {
    expect(pathFromOpenUrl(undefined)).toBe("");
    expect(pathFromOpenUrl("not a url")).toBe("");
  });
});

describe("share provider registry", () => {
  it("ships tailscale and looks it up by name", () => {
    expect(providerNames()).toContain("tailscale");
    expect(getProvider("tailscale")).toBe(tailscaleProvider);
  });

  it("returns null for an unknown provider", () => {
    expect(getProvider("ngrok")).toBeNull();
  });
});

describe("pickShareTarget", () => {
  it("shares the sole serving target with no args (single-app repo)", () => {
    expect(pickShareTarget([t("web", { port: 3000 })])).toEqual({
      kind: "ok",
      target: t("web", { port: 3000 }),
    });
  });

  it("prefers an explicit default that serves", () => {
    const pick = pickShareTarget([
      t("api", { port: 3010 }),
      t("web", { port: 3000, default: true }),
    ]);
    expect(pick).toMatchObject({ kind: "ok", target: { name: "web" } });
  });

  it("skips a portless default (compose stack) and picks the lone serving target", () => {
    const pick = pickShareTarget([t("stack", { default: true }), t("web", { port: 3000 })]);
    expect(pick).toMatchObject({ kind: "ok", target: { name: "web" } });
  });

  it("asks which when several targets serve and none is the default", () => {
    const pick = pickShareTarget([
      t("stack", { default: true }),
      t("web", { port: 3000 }),
      t("api", { port: 3010 }),
    ]);
    expect(pick).toEqual({ kind: "ambiguous", choices: ["web", "api"] });
  });

  it("reports none when nothing serves an HTTP port", () => {
    expect(pickShareTarget([t("stack", { default: true })])).toEqual({ kind: "none" });
  });

  it("takes a named target as-is, and flags an unknown one", () => {
    expect(pickShareTarget([t("web", { port: 3000 })], "web")).toMatchObject({ kind: "ok" });
    expect(pickShareTarget([t("web", { port: 3000 })], "nope")).toEqual({
      kind: "unknown",
      known: ["web"],
    });
  });
});

describe("tailscale provider", () => {
  it("funnels the given port in the foreground (no --bg — premo owns lifecycle)", () => {
    expect(tailscaleProvider.command(8080)).toBe("tailscale funnel 8080");
  });
});
