import * as React from "react"
import { NumberField } from "./NumberField"

export const meta = { title: "Number Field" }

export default function NumberFieldDemo() {
  const id = React.useId()
  return (
    <NumberField.Root id={id} defaultValue={8} min={0} max={99}>
      <NumberField.ScrubArea>
        <label htmlFor={id}>Quantity</label>
        <NumberField.ScrubAreaCursor>
          <svg width="26" height="14" viewBox="0 0 26 14" fill="currentColor">
            <path d="M19.5 5.5H6.5V2L1 7l5.5 5V8.5h13V12L25 7l-5.5-5v3.5Z" />
          </svg>
        </NumberField.ScrubAreaCursor>
      </NumberField.ScrubArea>

      <NumberField.Group>
        <NumberField.Decrement />
        <NumberField.Input />
        <NumberField.Increment />
      </NumberField.Group>
    </NumberField.Root>
  )
}
