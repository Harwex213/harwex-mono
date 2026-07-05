import { Field } from "./Field"

export const meta = { title: "Field" }

export default function FieldDemo() {
  return (
    <Field.Root>
      <Field.Label>Email address</Field.Label>
      <Field.Control
        type="email"
        required
        placeholder="you@example.com"
      />
      <Field.Description>
        We'll only use this to send you account updates.
      </Field.Description>
      <Field.Error match="valueMissing">Please enter your email.</Field.Error>
      <Field.Error match="typeMismatch">
        Please enter a valid email address.
      </Field.Error>
    </Field.Root>
  )
}
