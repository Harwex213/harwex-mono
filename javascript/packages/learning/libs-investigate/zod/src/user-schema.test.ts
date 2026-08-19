import assert from "node:assert/strict";
import { test } from "node:test";
import { parseUser, userSchema } from "./user-schema.ts";

test("fills the default role", () => {
  const user = parseUser({ id: 1, name: "Aleh", email: "aleh@example.com" });

  assert.equal(user.role, "user");
});

test("rejects an invalid email", () => {
  const result = userSchema.safeParse({ id: 1, name: "Aleh", email: "nope" });

  assert.equal(result.success, false);
});
