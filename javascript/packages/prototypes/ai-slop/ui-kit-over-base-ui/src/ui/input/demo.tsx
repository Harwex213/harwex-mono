import * as React from "react"
import { Input } from "./Input"

export const meta = { title: "Input" }

const stack = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--uk-space-4)",
  width: "100%",
  maxWidth: "320px",
}
const field = { display: "flex", flexDirection: "column" as const, gap: "var(--uk-space-2)" }
const label = { fontSize: "13px", fontWeight: 600, color: "var(--uk-fg)" }

export default function InputDemo() {
  const [value, setValue] = React.useState("")

  return (
    <div style={stack}>
      <label style={field}>
        <span style={label}>Full name</span>
        <Input.Root
          placeholder="e.g. Colm Tuite"
          value={value}
          onValueChange={(next) => setValue(next)}
        />
      </label>

      <label style={field}>
        <span style={label}>Email</span>
        <Input.Root type="email" defaultValue="hello@example.com" />
      </label>

      <label style={field}>
        <span style={label}>Disabled</span>
        <Input.Root placeholder="Unavailable" disabled />
      </label>
    </div>
  )
}
