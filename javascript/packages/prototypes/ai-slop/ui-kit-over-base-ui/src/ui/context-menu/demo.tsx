import * as React from "react"
import { ContextMenu } from "./ContextMenu"

export const meta = { title: "Context Menu" }

export default function ContextMenuDemo() {
  const [starred, setStarred] = React.useState(false)
  const [quality, setQuality] = React.useState("high")

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger>Right-click anywhere in this area</ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner>
          <ContextMenu.Popup>
            <ContextMenu.Item>Add to library</ContextMenu.Item>
            <ContextMenu.CheckboxItem checked={starred} onCheckedChange={setStarred}>
              Starred
            </ContextMenu.CheckboxItem>

            <ContextMenu.Separator />

            <ContextMenu.Group>
              <ContextMenu.GroupLabel>Quality</ContextMenu.GroupLabel>
              <ContextMenu.RadioGroup value={quality} onValueChange={setQuality}>
                <ContextMenu.RadioItem value="low">Low</ContextMenu.RadioItem>
                <ContextMenu.RadioItem value="high">High</ContextMenu.RadioItem>
              </ContextMenu.RadioGroup>
            </ContextMenu.Group>

            <ContextMenu.Separator />

            <ContextMenu.SubmenuRoot>
              <ContextMenu.SubmenuTrigger>Add to playlist</ContextMenu.SubmenuTrigger>
              <ContextMenu.Portal>
                <ContextMenu.Positioner side="right" align="start" sideOffset={4}>
                  <ContextMenu.Popup>
                    <ContextMenu.Item>Favorites</ContextMenu.Item>
                    <ContextMenu.Item>Recently played</ContextMenu.Item>
                    <ContextMenu.Separator />
                    <ContextMenu.Item>Create new…</ContextMenu.Item>
                  </ContextMenu.Popup>
                </ContextMenu.Positioner>
              </ContextMenu.Portal>
            </ContextMenu.SubmenuRoot>

            <ContextMenu.Separator />

            <ContextMenu.Item>Delete</ContextMenu.Item>
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}
