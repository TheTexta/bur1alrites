import { readFileSync } from "node:fs";
import { expect, test } from "vitest";

const migration = readFileSync(
  new URL("./20261014213549_restrict_gallery_rpc_execution.sql", import.meta.url),
  "utf8",
).replace(/\s+/g, " ");

test.each([
  "public.create_gallery_item(text, text, integer, integer, text, text, text, text)",
  "public.move_gallery_item(text, text)",
])("restricts %s to the application service role", (signature) => {
  expect(migration).toContain(`revoke all on function ${signature} from public, anon, authenticated;`);
  expect(migration).toContain(`grant execute on function ${signature} to service_role;`);
});

test("migration verifies effective execution rights before committing", () => {
  expect(migration).toContain("has_function_privilege('anon'");
  expect(migration).toContain("has_function_privilege('authenticated'");
  expect(migration).toContain("has_function_privilege('service_role'");
  expect(migration).toContain("raise exception 'Gallery RPC execution privileges remain unsafe'");
});
