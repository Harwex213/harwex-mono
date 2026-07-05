import { Switch } from "./Switch"

export const meta = { title: "Switch" }

export default function SwitchDemo() {
  return (
    <label
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: "var(--uk-space-2)",
        color: "var(--uk-fg)",
        fontSize: "14px",
      }}
    >
      <Switch.Root defaultChecked>
        <Switch.Thumb />
      </Switch.Root>
      Notifications
    </label>
  )
}
