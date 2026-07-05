import { Checkbox } from "./Checkbox"

export const meta = { title: "Checkbox" }

export default function CheckboxDemo() {
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
      <Checkbox.Root defaultChecked>
        <Checkbox.Indicator />
      </Checkbox.Root>
      Enable notifications
    </label>
  )
}
