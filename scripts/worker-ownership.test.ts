import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const scripts = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).scripts as Record<string, string>;

describe("shared Worker publishing ownership", () => {
  it("keeps R2 bucket setup but no longer exposes Worker deployment scripts", () => {
    expect(scripts["r2:setup"]).toBeDefined();
    expect(scripts["assets:deploy"]).toBeUndefined();
    expect(scripts["assets:publish"]).toBeUndefined();
    expect(scripts["assets:check"]).toContain("--dry-run");
    expect(existsSync(new URL("./publish-assets-worker.mjs", import.meta.url))).toBe(false);
  });

  it("never deploys a Worker from bucket and CORS provisioning", () => {
    const setup = readFileSync(new URL("./setup-r2.mjs", import.meta.url), "utf8");
    expect(setup).not.toMatch(/wrangler|workers\/routes|workers\/domains/);
    expect(setup).toContain("if (!apply)");
    expect(setup).toContain("if (!exists) await api(base, { method: 'POST'");
    expect(setup).toContain("PutBucketCorsCommand");
  });
});
