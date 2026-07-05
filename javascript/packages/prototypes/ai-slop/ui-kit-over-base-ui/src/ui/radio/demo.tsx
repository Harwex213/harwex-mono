import * as React from "react"
import { Radio, RadioGroup } from "./Radio"

export const meta = { title: "Radio" }

const labelStyle: React.CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  gap: "var(--uk-space-2)",
  fontSize: "14px",
}

export default function RadioDemo() {
  const id = React.useId()

  return (
    <RadioGroup.Root aria-labelledby={id} defaultValue="fuji">
      <div id={id} style={{ fontWeight: 600, marginBottom: "var(--uk-space-1)" }}>
        Best apple
      </div>

      <label style={labelStyle}>
        <Radio.Root value="fuji">
          <Radio.Indicator />
        </Radio.Root>
        Fuji
      </label>

      <label style={labelStyle}>
        <Radio.Root value="gala">
          <Radio.Indicator />
        </Radio.Root>
        Gala
      </label>

      <label style={labelStyle}>
        <Radio.Root value="granny-smith">
          <Radio.Indicator />
        </Radio.Root>
        Granny Smith
      </label>
    </RadioGroup.Root>
  )
}
