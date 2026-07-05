import * as React from "react"
import { Menu } from "./Menu"

export const meta = { title: "Menu" }

export default function MenuDemo() {
  const [bookmarked, setBookmarked] = React.useState(true)
  const [view, setView] = React.useState("comfortable")

  return (
    <Menu.Root>
      <Menu.Trigger>
        Open menu
        <svg viewBox="0 0 12 12" width="12" height="12" fill="none">
          <path d="M3 4.5 6 7.5 9 4.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner>
          <Menu.Popup>
            <Menu.Arrow />
            <Menu.Item onClick={() => {}}>New file</Menu.Item>
            <Menu.Item>Open…</Menu.Item>
            <Menu.CheckboxItem checked={bookmarked} onCheckedChange={setBookmarked}>
              Bookmarked
            </Menu.CheckboxItem>

            <Menu.Separator />

            <Menu.Group>
              <Menu.GroupLabel>View</Menu.GroupLabel>
              <Menu.RadioGroup value={view} onValueChange={setView}>
                <Menu.RadioItem value="comfortable">Comfortable</Menu.RadioItem>
                <Menu.RadioItem value="compact">Compact</Menu.RadioItem>
              </Menu.RadioGroup>
            </Menu.Group>

            <Menu.Separator />

            <Menu.SubmenuRoot>
              <Menu.SubmenuTrigger>Share</Menu.SubmenuTrigger>
              <Menu.Portal>
                <Menu.Positioner side="right" align="start" sideOffset={4}>
                  <Menu.Popup>
                    <Menu.Item>Copy link</Menu.Item>
                    <Menu.Item>Email</Menu.Item>
                    <Menu.Separator />
                    <Menu.Item>Invite people…</Menu.Item>
                  </Menu.Popup>
                </Menu.Positioner>
              </Menu.Portal>
            </Menu.SubmenuRoot>

            <Menu.Separator />

            <Menu.Item disabled>Delete</Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}
