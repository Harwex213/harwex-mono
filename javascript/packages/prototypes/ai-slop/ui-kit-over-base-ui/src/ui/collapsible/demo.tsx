import { Collapsible } from "./Collapsible"

export const meta = { title: "Collapsible" }

export default function CollapsibleDemo() {
  return (
    <Collapsible.Root defaultOpen>
      <Collapsible.Trigger>Recovery keys</Collapsible.Trigger>
      <Collapsible.Panel>
        <div>
          Keep these one-time recovery keys somewhere safe. Each key can be used
          once to sign in if you lose access to your device.
        </div>
      </Collapsible.Panel>
    </Collapsible.Root>
  )
}
