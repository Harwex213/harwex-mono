import { Popover } from "./Popover"

export const meta = { title: "Popover" }

export default function PopoverDemo() {
  return (
    <Popover.Root>
      <Popover.Trigger>Notifications</Popover.Trigger>
      <Popover.Portal>
        <Popover.Positioner side="bottom" align="center" sideOffset={10}>
          <Popover.Popup>
            <Popover.Arrow />
            <Popover.Title>Notifications</Popover.Title>
            <Popover.Description>
              You are all caught up. New notifications will appear here as they
              arrive.
            </Popover.Description>
            <Popover.Close>Got it</Popover.Close>
          </Popover.Popup>
        </Popover.Positioner>
      </Popover.Portal>
    </Popover.Root>
  )
}
