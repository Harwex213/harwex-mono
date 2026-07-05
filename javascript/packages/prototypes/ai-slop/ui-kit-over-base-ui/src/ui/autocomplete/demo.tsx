import { Autocomplete } from "./Autocomplete"

export const meta = { title: "Autocomplete" }

const tags = [
  "bug",
  "enhancement",
  "documentation",
  "duplicate",
  "good first issue",
  "help wanted",
  "invalid",
  "question",
  "wontfix",
]

export default function AutocompleteDemo() {
  return (
    <Autocomplete.Root items={tags}>
      <label className="uk-autocomplete-label" style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: "0.8125rem", fontWeight: 600 }}>
        Add a tag
        <Autocomplete.InputGroup>
          <Autocomplete.Input placeholder="e.g. bug" />
          <Autocomplete.Clear aria-label="Clear" />
        </Autocomplete.InputGroup>
      </label>
      <Autocomplete.Portal>
        <Autocomplete.Positioner>
          <Autocomplete.Popup>
            <Autocomplete.Empty>No tags found.</Autocomplete.Empty>
            <Autocomplete.List>
              {(tag: string) => (
                <Autocomplete.Item key={tag} value={tag}>
                  {tag}
                </Autocomplete.Item>
              )}
            </Autocomplete.List>
          </Autocomplete.Popup>
        </Autocomplete.Positioner>
      </Autocomplete.Portal>
    </Autocomplete.Root>
  )
}
