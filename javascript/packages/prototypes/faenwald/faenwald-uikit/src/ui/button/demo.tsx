import { Button } from "./Button"

export const meta = { title: "Button" }

const row = {
  display: "flex",
  gap: "var(--uk-space-3)",
  alignItems: "center",
  flexWrap: "wrap" as const,
}
const stack = { display: "flex", flexDirection: "column" as const, gap: "var(--uk-space-4)" }

export default function ButtonDemo() {
  return (
    <div style={stack}>
      <div style={row}>
        <Button.Root variant="primary">Primary</Button.Root>
        <Button.Root variant="secondary">Secondary</Button.Root>
        <Button.Root variant="ghost">Ghost</Button.Root>
        <Button.Root variant="danger">Delete</Button.Root>
      </div>

      <div style={row}>
        <Button.Root size="sm">Small</Button.Root>
        <Button.Root size="md">Medium</Button.Root>
        <Button.Root size="lg">Large</Button.Root>
      </div>

      <div style={row}>
        <Button.Root variant="primary">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none">
            <path
              d="M8 3.5v9M3.5 8h9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
          New item
        </Button.Root>
        <Button.Root variant="secondary" disabled>
          Disabled
        </Button.Root>
      </div>
    </div>
  )
}
