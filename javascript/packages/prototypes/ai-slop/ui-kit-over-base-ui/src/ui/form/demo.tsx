import * as React from "react"
import { Form } from "./Form"
import { Field } from "../field/Field"
import styles from "./form.module.css"

export const meta = { title: "Form" }

export default function FormDemo() {
  const [errors, setErrors] = React.useState<Record<string, string>>({})

  return (
    <Form.Root
      errors={errors}
      onFormSubmit={(values) => {
        setErrors(
          values.email === "taken@example.com"
            ? { email: "This email is already registered." }
            : {},
        )
      }}
    >
      <Field.Root name="name">
        <Field.Label>Full name</Field.Label>
        <Field.Control required placeholder="Ada Lovelace" />
        <Field.Error match="valueMissing">Please enter your name.</Field.Error>
      </Field.Root>

      <Field.Root name="email">
        <Field.Label>Email address</Field.Label>
        <Field.Control type="email" required placeholder="you@example.com" />
        <Field.Description>Try "taken@example.com" to see a server error.</Field.Description>
        <Field.Error match="valueMissing">Please enter your email.</Field.Error>
        <Field.Error match="typeMismatch">Enter a valid email address.</Field.Error>
      </Field.Root>

      <button type="submit" className={styles.submit}>
        Create account
      </button>
    </Form.Root>
  )
}
