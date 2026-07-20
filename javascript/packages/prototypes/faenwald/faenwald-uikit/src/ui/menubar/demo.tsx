import * as React from "react"
import { Menubar } from "./Menubar"
import { Menu } from "../menu/Menu"
import styles from "./menubar.module.css"

export const meta = { title: "Menubar" }

export default function MenubarDemo() {
  const [wrap, setWrap] = React.useState(true)
  const [zoom, setZoom] = React.useState("100")

  return (
    <Menubar.Root>
      <Menu.Root>
        <Menu.Trigger className={styles.trigger}>File</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start">
            <Menu.Popup>
              <Menu.Item>New file</Menu.Item>
              <Menu.Item>New window</Menu.Item>
              <Menu.Separator />
              <Menu.Item>Open…</Menu.Item>
              <Menu.SubmenuRoot>
                <Menu.SubmenuTrigger>Open recent</Menu.SubmenuTrigger>
                <Menu.Portal>
                  <Menu.Positioner side="right" align="start" sideOffset={4}>
                    <Menu.Popup>
                      <Menu.Item>project-alpha</Menu.Item>
                      <Menu.Item>notes.md</Menu.Item>
                      <Menu.Item>budget.xlsx</Menu.Item>
                    </Menu.Popup>
                  </Menu.Positioner>
                </Menu.Portal>
              </Menu.SubmenuRoot>
              <Menu.Separator />
              <Menu.Item>Save</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Menu.Root>
        <Menu.Trigger className={styles.trigger}>Edit</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start">
            <Menu.Popup>
              <Menu.Item>Undo</Menu.Item>
              <Menu.Item>Redo</Menu.Item>
              <Menu.Separator />
              <Menu.Item>Cut</Menu.Item>
              <Menu.Item>Copy</Menu.Item>
              <Menu.Item>Paste</Menu.Item>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>

      <Menu.Root>
        <Menu.Trigger className={styles.trigger}>View</Menu.Trigger>
        <Menu.Portal>
          <Menu.Positioner align="start">
            <Menu.Popup>
              <Menu.CheckboxItem checked={wrap} onCheckedChange={setWrap}>
                Word wrap
              </Menu.CheckboxItem>
              <Menu.Separator />
              <Menu.Group>
                <Menu.GroupLabel>Zoom</Menu.GroupLabel>
                <Menu.RadioGroup value={zoom} onValueChange={setZoom}>
                  <Menu.RadioItem value="80">80%</Menu.RadioItem>
                  <Menu.RadioItem value="100">100%</Menu.RadioItem>
                  <Menu.RadioItem value="125">125%</Menu.RadioItem>
                </Menu.RadioGroup>
              </Menu.Group>
            </Menu.Popup>
          </Menu.Positioner>
        </Menu.Portal>
      </Menu.Root>
    </Menubar.Root>
  )
}
