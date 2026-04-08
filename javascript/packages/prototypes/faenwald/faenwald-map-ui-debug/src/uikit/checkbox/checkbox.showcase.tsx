import { useState } from "react";
import { Checkbox } from "./checkbox";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

function CheckboxDemo({ label, defaultChecked = false }: { label: string; defaultChecked?: boolean }) {
  const [checked, setChecked] = useState(defaultChecked);
  return <Checkbox label={label} checked={checked} onChange={(e) => setChecked(e.target.checked)}/>;
}

export default {
  name: "Checkbox",
  render: () => (
    <>
      <ShowcaseSection title="Unchecked">
        <CheckboxDemo label="Show borders"/>
      </ShowcaseSection>

      <ShowcaseSection title="Checked">
        <CheckboxDemo label="Show province centers" defaultChecked/>
      </ShowcaseSection>
    </>
  ),
};
