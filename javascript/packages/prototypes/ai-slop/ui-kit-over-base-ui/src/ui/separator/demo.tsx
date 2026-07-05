import { Separator } from "./Separator"

export const meta = { title: "Separator" }

const card = {
  display: "flex",
  flexDirection: "column" as const,
  gap: "var(--uk-space-3)",
  width: "100%",
  maxWidth: "360px",
  padding: "var(--uk-space-4)",
  border: "1px solid var(--uk-border)",
  borderRadius: "var(--uk-radius)",
  background: "var(--uk-panel)",
  color: "var(--uk-fg)",
}
const title = { fontWeight: 600 }
const muted = { color: "var(--uk-fg-muted)", fontSize: "14px" }
const nav = {
  display: "flex",
  alignItems: "center",
  gap: "var(--uk-space-3)",
  height: "20px",
  color: "var(--uk-fg-muted)",
  fontSize: "14px",
}

export default function SeparatorDemo() {
  return (
    <div style={card}>
      <div style={title}>Base UI</div>
      <div style={muted}>Unstyled React components for building design systems.</div>

      <Separator.Root />

      <div style={nav}>
        <span>Docs</span>
        <Separator.Root orientation="vertical" />
        <span>Components</span>
        <Separator.Root orientation="vertical" />
        <span>GitHub</span>
      </div>
    </div>
  )
}
