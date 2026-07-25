import { Accordion } from "./Accordion"

export const meta = { title: "Accordion" }

export default function AccordionDemo() {
  return (
    <Accordion.Root defaultValue={["item-1"]}>
      <Accordion.Item value="item-1">
        <Accordion.Header>
          <Accordion.Trigger>What is Base UI?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <div>
            Base UI is a library of high-quality unstyled React components for
            design systems and web apps.
          </div>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="item-2">
        <Accordion.Header>
          <Accordion.Trigger>Is it accessible?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <div>
            Yes. Every component follows WAI-ARIA authoring practices and is
            fully keyboard navigable.
          </div>
        </Accordion.Panel>
      </Accordion.Item>

      <Accordion.Item value="item-3">
        <Accordion.Header>
          <Accordion.Trigger>Can I style it my way?</Accordion.Trigger>
        </Accordion.Header>
        <Accordion.Panel>
          <div>
            Absolutely — this kit layers a theme on top using plain CSS
            variables, so you own the look.
          </div>
        </Accordion.Panel>
      </Accordion.Item>
    </Accordion.Root>
  )
}
