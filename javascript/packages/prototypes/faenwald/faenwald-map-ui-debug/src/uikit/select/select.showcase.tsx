import { useState } from "react";
import { Select } from "./select";
import { ShowcaseSection } from "../../uikit-dev/showcase-section";

const options = [
  { value: "nordheim", label: "Nordheim" },
  { value: "sudmark", label: "Sudmark" },
  { value: "westfall", label: "Westfall" },
  { value: "ostburg", label: "Ostburg" },
];

function SelectDemo() {
  const [value, setValue] = useState("nordheim");
  return <Select value={value} onValueChange={setValue} options={options} placeholder="Choose province" />;
}

export default {
  name: "Select",
  render: () => (
    <>
      <ShowcaseSection title="Default">
        <SelectDemo />
      </ShowcaseSection>
    </>
  ),
};
