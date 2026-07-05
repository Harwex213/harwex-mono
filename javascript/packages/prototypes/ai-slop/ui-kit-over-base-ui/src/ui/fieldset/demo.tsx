import { Fieldset } from "./Fieldset"
import { Field } from "../field/Field"

export const meta = { title: "Fieldset" }

export default function FieldsetDemo() {
  return (
    <Fieldset.Root>
      <Fieldset.Legend>Billing details</Fieldset.Legend>

      <Field.Root>
        <Field.Label>Full name</Field.Label>
        <Field.Control placeholder="Ada Lovelace" />
      </Field.Root>

      <Field.Root>
        <Field.Label>Email address</Field.Label>
        <Field.Control type="email" placeholder="you@example.com" />
      </Field.Root>

      <Field.Root>
        <Field.Label>Company</Field.Label>
        <Field.Control placeholder="Acme Inc." />
      </Field.Root>
    </Fieldset.Root>
  )
}
