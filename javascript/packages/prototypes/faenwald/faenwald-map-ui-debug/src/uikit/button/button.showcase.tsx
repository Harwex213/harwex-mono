import { Button } from "./button";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "Button",
  render: () => (
    <>
      <ShowcaseSection title="Variants">
        <Button variant="primary">Primary</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="ghost">Ghost</Button>
      </ShowcaseSection>

      <ShowcaseSection title="Sizes">
        <Button size="sm">Small</Button>
        <Button size="md">Medium</Button>
      </ShowcaseSection>

      <ShowcaseSection title="Disabled">
        <Button variant="primary" disabled>Primary</Button>
        <Button variant="secondary" disabled>Secondary</Button>
        <Button variant="ghost" disabled>Ghost</Button>
      </ShowcaseSection>
    </>
  ),
};
