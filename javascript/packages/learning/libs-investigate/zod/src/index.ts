import { parseUser, userSchema } from "./user-schema.ts";

const user = parseUser({
  id: 1,
  name: "Aleh",
  email: "aleh@example.com",
});

console.log("parsed:", user);

const failure = userSchema.safeParse({
  id: -1,
  name: "",
  email: "not-an-email",
});

if (!failure.success) {
  console.log("issues:", failure.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`));
}
