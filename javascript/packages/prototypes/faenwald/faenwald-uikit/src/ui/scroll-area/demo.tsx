import { ScrollArea } from "./ScrollArea"

export const meta = { title: "Scroll Area" }

const paragraphs = [
  "Vernacular architecture is building done outside any academic tradition, and without professional guidance. It is the most widespread form of building.",
  "It tends to evolve over time to reflect the environmental, cultural, technological, economic, and historical context in which it exists.",
  "The builder relies on local materials and knowledge, usually without the supervision of professional architects.",
  "Studies of vernacular architecture examine the ways in which such buildings vary from one place to another.",
  "The buildings of foreign cultures are often perceived as exotic, and their forms and details can inspire architects the world over.",
  "In many regions, vernacular buildings are being replaced by mass-produced housing that ignores local climate and custom.",
]

export default function ScrollAreaDemo() {
  return (
    <ScrollArea.Root>
      <ScrollArea.Viewport>
        <ScrollArea.Content>
          {paragraphs.map((text, i) => (
            <p key={i} style={{ margin: i === 0 ? 0 : "12px 0 0" }}>
              {text}
            </p>
          ))}
        </ScrollArea.Content>
      </ScrollArea.Viewport>
      <ScrollArea.Scrollbar orientation="vertical">
        <ScrollArea.Thumb />
      </ScrollArea.Scrollbar>
      <ScrollArea.Corner />
    </ScrollArea.Root>
  )
}
