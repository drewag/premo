import { describe, expect, it } from "vitest";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { detectAdapter } from "../../src/core/adapters/index.js";
import { mavenAdapter } from "../../src/core/adapters/maven.js";

async function tmp(): Promise<string> {
  return mkdtemp(path.join(tmpdir(), "premo-maven-"));
}
async function pom(dir: string, contents: string): Promise<void> {
  await writeFile(path.join(dir, "pom.xml"), contents);
}

const SIMPLE_POM = `<project>
  <modelVersion>4.0.0</modelVersion>
  <groupId>com.drewagllc</groupId>
  <artifactId>worldsets</artifactId>
  <version>0.0.1</version>
</project>`;

describe("maven adapter", () => {
  it("detects a pom.xml and exposes one package named from artifactId", async () => {
    const root = await tmp();
    await pom(root, SIMPLE_POM);

    expect(await mavenAdapter.detect(root)).toBe(true);
    const pkgs = await mavenAdapter.packages(root);
    expect(pkgs).toHaveLength(1);
    expect(pkgs[0]!.name).toBe("worldsets");
    expect(pkgs[0]!.dirs).toEqual(["."]);
    expect(pkgs[0]!.kind).toBe("command");
  });

  it("does not detect a repo without a pom.xml", async () => {
    const root = await tmp();
    expect(await mavenAdapter.detect(root)).toBe(false);
  });

  it("maps build and test to Maven lifecycle phases; dev/deploy stay unresolved", async () => {
    const root = await tmp();
    await pom(root, SIMPLE_POM);
    const [pkg] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("build", pkg!, root)).toBe("mvn -q clean package");
    expect(await mavenAdapter.command("test", pkg!, root)).toBe("mvn -q test");
    expect(await mavenAdapter.command("dev", pkg!, root)).toBeNull();
    expect(await mavenAdapter.command("deploy", pkg!, root)).toBeNull();
    expect(await mavenAdapter.command("lint", pkg!, root)).toBeNull();
  });

  it("takes the project's own artifactId, not the parent's", async () => {
    const root = await tmp();
    await pom(
      root,
      `<project>
        <parent>
          <groupId>io.papermc.paper</groupId>
          <artifactId>paper-parent</artifactId>
          <version>1.0</version>
        </parent>
        <artifactId>my-plugin</artifactId>
      </project>`,
    );
    const [pkg] = await mavenAdapter.packages(root);
    expect(pkg!.name).toBe("my-plugin");
  });

  it("wires lint to Spotless when the plugin is configured", async () => {
    const root = await tmp();
    await pom(
      root,
      `<project>
        <artifactId>fmt</artifactId>
        <build><plugins><plugin>
          <groupId>com.diffplug.spotless</groupId>
          <artifactId>spotless-maven-plugin</artifactId>
        </plugin></plugins></build>
      </project>`,
    );
    const [pkg] = await mavenAdapter.packages(root);
    expect(await mavenAdapter.command("lint", pkg!, root)).toBe("mvn -q spotless:apply");
  });

  it("is chosen by detectAdapter for a pom-only repo", async () => {
    const root = await tmp();
    await pom(root, SIMPLE_POM);
    expect((await detectAdapter(root))?.name).toBe("maven");
  });
});
