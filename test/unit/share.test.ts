import { describe, expect, it } from "vitest";
import { pathFromOpenUrl } from "../../src/cli/commands/share.js";
import { getProvider, providerNames } from "../../src/core/share/index.js";
import { tailscaleProvider } from "../../src/core/share/tailscale.js";

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

describe("tailscale provider", () => {
  it("funnels the given port in the foreground (no --bg — premo owns lifecycle)", () => {
    expect(tailscaleProvider.command(8080)).toBe("tailscale funnel 8080");
  });
});
