import { Input } from "./input";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

export default {
  name: "Input",
  render: () => (
    <>
      <ShowcaseSection title="Default">
        <Input placeholder="Enter text..."/>
      </ShowcaseSection>

      <ShowcaseSection title="With label">
        <Input label="Province name" id="showcase-input" placeholder="e.g. Nordheim"/>
      </ShowcaseSection>

      <ShowcaseSection title="Disabled">
        <Input label="Disabled" id="showcase-input-disabled" placeholder="Cannot edit" disabled/>
      </ShowcaseSection>
    </>
  ),
};
