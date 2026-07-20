import * as React from "react"
import { ToggleGroup } from "./ToggleGroup"
import { Toggle } from "../toggle/Toggle"

export const meta = { title: "Toggle Group" }

export default function ToggleGroupDemo() {
  const [value, setValue] = React.useState<string[]>(["left"])
  return (
    <ToggleGroup.Root value={value} onValueChange={setValue}>
      <Toggle.Root value="left" aria-label="Align left">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h12M2 8h8M2 12h10" />
        </svg>
      </Toggle.Root>
      <Toggle.Root value="center" aria-label="Align center">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h12M4 8h8M3 12h10" />
        </svg>
      </Toggle.Root>
      <Toggle.Root value="right" aria-label="Align right">
        <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
          <path d="M2 4h12M6 8h8M4 12h10" />
        </svg>
      </Toggle.Root>
    </ToggleGroup.Root>
  )
}
