import { Drawer } from "./Drawer"

export const meta = { title: "Drawer" }

export default function DrawerDemo() {
  return (
    <Drawer.Root swipeDirection="right">
      <Drawer.Trigger>Open drawer</Drawer.Trigger>
      <Drawer.Portal>
        <Drawer.Backdrop />
        <Drawer.Viewport>
          <Drawer.Popup>
            <Drawer.Content>
              <Drawer.Title>Settings</Drawer.Title>
              <Drawer.Description>
                Adjust your preferences here. Swipe right or press Escape to
                dismiss the panel.
              </Drawer.Description>
              <Drawer.Close>Close</Drawer.Close>
            </Drawer.Content>
          </Drawer.Popup>
        </Drawer.Viewport>
      </Drawer.Portal>
    </Drawer.Root>
  )
}
