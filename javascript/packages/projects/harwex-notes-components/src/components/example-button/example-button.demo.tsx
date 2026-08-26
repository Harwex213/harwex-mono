import { signal } from "@preact/signals-react";
import { useSignals } from "@preact/signals-react/runtime";
import { ExampleButton } from "./example-button";
import type { TDemo } from "../../../dev/demo";

const clicks = signal(0);

const Demo = () => {
  useSignals();

  return (
    <div style={{ display: "flex", gap: 12, alignItems: "center" }}>
      <ExampleButton onClick={() => clicks.value++}>{"Primary"}</ExampleButton>
      <ExampleButton onClick={() => clicks.value++} variant="ghost">
        {"Ghost"}
      </ExampleButton>
      <ExampleButton disabled>{"Disabled"}</ExampleButton>
      <span>{`Clicked ${clicks.value} times`}</span>
    </div>
  );
};

const demo: TDemo = {
  title: "Example button",
  component: Demo,
};

export default demo;
