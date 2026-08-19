import * as z from "zod";

const userSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1),
  email: z.email(),
  role: z.enum(["admin", "user"]).default("user"),
  tags: z.array(z.string()).optional(),
});

type User = z.infer<typeof userSchema>;

function parseUser(input: unknown): User {
  return userSchema.parse(input);
}

export { userSchema, parseUser };
export type { User };
