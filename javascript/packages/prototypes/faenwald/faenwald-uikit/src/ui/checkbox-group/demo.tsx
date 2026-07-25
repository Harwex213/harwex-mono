import * as React from "react"
import { CheckboxGroup } from "./CheckboxGroup"
import { Checkbox } from "../checkbox/Checkbox"

export const meta = { title: "Checkbox Group" }

const labelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--uk-space-2)",
  fontSize: "14px",
}

export default function CheckboxGroupDemo() {
  const id = React.useId()
  const [value, setValue] = React.useState<string[]>(["fuji"])

  return (
    <CheckboxGroup.Root aria-labelledby={id} value={value} onValueChange={setValue}>
      <div id={id} style={{ fontWeight: 600, marginBottom: "var(--uk-space-1)" }}>
        Apples
      </div>

      <label style={labelStyle}>
        <Checkbox.Root name="apple" value="fuji">
          <Checkbox.Indicator />
        </Checkbox.Root>
        Fuji
      </label>

      <label style={labelStyle}>
        <Checkbox.Root name="apple" value="gala">
          <Checkbox.Indicator />
        </Checkbox.Root>
        Gala
      </label>

      <label style={labelStyle}>
        <Checkbox.Root name="apple" value="granny-smith">
          <Checkbox.Indicator />
        </Checkbox.Root>
        Granny Smith
      </label>
    </CheckboxGroup.Root>
  )
}
