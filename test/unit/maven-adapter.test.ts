import { describe, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { mavenAdapter, pomArtifactId } from "../../src/core/adapters/maven.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-maven-"));
}
async function pom(dir: string, body: string): Promise<void> {
  await mkdir(dir, { recursive: true });
  await writeFile(path.join(dir, "pom.xml"), `<project>${body}</project>`);
}

describe("maven adapter", () => {
  it("detects a pom.xml and exposes one package named by artifactId", async () => {
    const root = await tmp();
    await pom(root, "<groupId>com.acme</groupId><artifactId>billing</artifactId>");

    expect(await mavenAdapter.detect(root)).toBe(true);
    expect((await detectAdapter(root))?.name).toBe("maven");
    const [t] = await mavenAdapter.packages(root);
    expect(t!.name).toBe("billing");
    expect(t!.dirs).toEqual(["."]);
    expect(t!.cwd).toBe(root);
  });

  it("does not detect a repo without a pom.xml", async () => {
    const root = await tmp();
    expect(await mavenAdapter.detect(root)).toBe(false);
  });

  it("names by the project's OWN artifactId, not the <parent>'s", async () => {
    const root = await tmp();
    await pom(
      root,
      "<parent><artifactId>paper-parent</artifactId></parent>" +
        "<!-- <artifactId>commented-out</artifactId> -->" +
        "<artifactId>my-plugin</artifactId>",
    );
    const [t] = await mavenAdapter.packages(root);
    expect(t!.name).toBe("my-plugin");
    expect(pomArtifactId("<parent><artifactId>p</artifactId></parent>")).toBeNull();
  });

  it("falls back to the directory name when the pom has no artifactId", async () => {
    const root = await tmp();
    await pom(path.join(root, "svc"), "<groupId>g</groupId>");
    const [t] = await mavenAdapter.packages(path.join(root, "svc"));
    expect(t!.name).toBe("svc");
  });

  it("maps build/test to mvn phases; build skips tests (premo test owns them)", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>app</artifactId>");
    const [t] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("build", t!, root)).toBe("mvn -B package -DskipTests");
    expect(await mavenAdapter.command("test", t!, root)).toBe("mvn -B test");
    expect(await mavenAdapter.command("deploy", t!, root)).toBeNull();
  });

  it("prefers the repo's ./mvnw wrapper when present", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>app</artifactId>");
    await writeFile(path.join(root, "mvnw"), "#!/bin/sh\n");
    const [t] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("build", t!, root)).toBe("./mvnw -B package -DskipTests");
  });

  it("is honest about dev: a unit without a dev-mode plugin is a `command` with no dev", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>lib</artifactId>");
    const [t] = await mavenAdapter.packages(root);
    expect(t!.kind).toBe("command"); // nothing serves — no port, no dev server
    expect(await mavenAdapter.command("dev", t!, root)).toBeNull();
  });

  it("wires dev to spring-boot:run (forwarding premo's port) when the plugin is declared", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>app</artifactId><plugin>spring-boot-maven-plugin</plugin>");
    const [t] = await mavenAdapter.packages(root);
    expect(t!.kind).toBe("service"); // a runnable app earns a port
    expect(await mavenAdapter.command("dev", t!, root)).toBe(
      "env ${PORT:+SERVER_PORT=$PORT} mvn spring-boot:run",
    );
  });

  it("wires dev to quarkus:dev for a Quarkus pom", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>app</artifactId><plugin>quarkus-maven-plugin</plugin>");
    const [t] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("dev", t!, root)).toBe(
      "env ${PORT:+QUARKUS_HTTP_PORT=$PORT} mvn quarkus:dev",
    );
  });

  it("wires lint only for spotless (a real fixer)", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>app</artifactId><plugin>spotless-maven-plugin</plugin>");
    const [t] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("lint", t!, root)).toBe("mvn -B spotless:apply");

    const plain = await tmp();
    await pom(plain, "<artifactId>app</artifactId>");
    const [p] = await mavenAdapter.packages(plain);
    expect(await mavenAdapter.command("lint", p!, plain)).toBeNull();
  });

  it("a multi-module root pom stays ONE maven project (the reactor), not a monorepo", async () => {
    const root = await tmp();
    await pom(root, "<artifactId>parent</artifactId><modules><module>a</module></modules>");
    await pom(path.join(root, "a"), "<artifactId>a</artifactId>");
    await pom(path.join(root, "b"), "<artifactId>b</artifactId>");

    expect((await detectAdapter(root))?.name).toBe("maven");
    expect(await mavenAdapter.packages(root)).toHaveLength(1);
  });
});
