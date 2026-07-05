import { Combobox } from "./Combobox"

export const meta = { title: "Combobox" }

const languages = [
  "TypeScript",
  "JavaScript",
  "Python",
  "Rust",
  "Go",
  "Java",
  "Kotlin",
  "Swift",
  "Ruby",
  "Elixir",
  "Haskell",
  "C++",
  "C#",
  "Scala",
]

export default function ComboboxDemo() {
  return (
    <Combobox.Root items={languages}>
      <Combobox.Label>Programming language</Combobox.Label>
      <Combobox.InputGroup>
        <Combobox.Input placeholder="Search a language" />
        <Combobox.Clear aria-label="Clear selection" />
        <Combobox.Trigger aria-label="Open list" />
      </Combobox.InputGroup>
      <Combobox.Portal>
        <Combobox.Positioner>
          <Combobox.Popup>
            <Combobox.Empty>No languages found.</Combobox.Empty>
            <Combobox.List>
              {(item: string) => (
                <Combobox.Item key={item} value={item}>
                  <Combobox.ItemIndicator />
                  <span>{item}</span>
                </Combobox.Item>
              )}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  )
}
