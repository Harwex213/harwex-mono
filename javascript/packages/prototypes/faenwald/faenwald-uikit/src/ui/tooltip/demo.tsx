import { Tooltip } from "./Tooltip"

export const meta = { title: "Tooltip" }

export default function TooltipDemo() {
  return (
    <Tooltip.Provider delay={400}>
      <Tooltip.Root>
        <Tooltip.Trigger>
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path d="M8 11V7.5M8 5h.01" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
            <circle cx="8" cy="8" r="6.25" stroke="currentColor" strokeWidth="1.5" />
          </svg>
          More info
        </Tooltip.Trigger>
        <Tooltip.Portal>
          <Tooltip.Positioner side="top">
            <Tooltip.Popup>
              <Tooltip.Arrow />
              This action can be undone from the activity log within 30 days.
            </Tooltip.Popup>
          </Tooltip.Positioner>
        </Tooltip.Portal>
      </Tooltip.Root>
    </Tooltip.Provider>
  )
}
