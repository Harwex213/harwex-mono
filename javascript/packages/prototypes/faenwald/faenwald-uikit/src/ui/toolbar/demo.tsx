import { Toolbar } from "./Toolbar"

export const meta = { title: "Toolbar" }

export default function ToolbarDemo() {
  return (
    <Toolbar.Root aria-label="Formatting">
      <Toolbar.Group>
        <Toolbar.Button aria-label="Bold">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.75" strokeLinecap="round" strokeLinejoin="round">
            <path d="M4.5 3h4a2.5 2.5 0 0 1 0 5h-4V3ZM4.5 8h4.5a2.5 2.5 0 0 1 0 5H4.5V8Z" />
          </svg>
        </Toolbar.Button>
        <Toolbar.Button aria-label="Italic">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M6.5 3h5M4.5 13h5M9.5 3 6.5 13" />
          </svg>
        </Toolbar.Button>
        <Toolbar.Button aria-label="Underline">
          <svg viewBox="0 0 16 16" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
            <path d="M4 2.5v5a4 4 0 0 0 8 0v-5M3.5 13.5h9" />
          </svg>
        </Toolbar.Button>
      </Toolbar.Group>

      <Toolbar.Separator />

      <Toolbar.Input aria-label="Font size" defaultValue="16" style={{ width: 56 }} />

      <Toolbar.Separator />

      <Toolbar.Link href="https://base-ui.com" target="_blank" rel="noreferrer">
        Docs
      </Toolbar.Link>
    </Toolbar.Root>
  )
}
