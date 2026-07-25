import * as React from "react"
import { Toggle } from "./Toggle"

export const meta = { title: "Toggle" }

export default function ToggleDemo() {
  const [pressed, setPressed] = React.useState(true)
  return (
    <Toggle.Root
      aria-label="Toggle star"
      pressed={pressed}
      onPressedChange={setPressed}
    >
      <svg viewBox="0 0 16 16" width="18" height="18" fill={pressed ? "currentColor" : "none"}>
        <path
          d="M8 1.5 10 5.6l4.5.65-3.25 3.17.77 4.48L8 11.78 3.98 13.9l.77-4.48L1.5 6.25 6 5.6 8 1.5Z"
          stroke="currentColor"
          strokeWidth="1.25"
          strokeLinejoin="round"
        />
      </svg>
    </Toggle.Root>
  )
}
