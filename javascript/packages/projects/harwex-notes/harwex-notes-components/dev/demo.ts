import type { ComponentType } from "react";

// A `*.demo.tsx` file next to a component default-exports one of these. The playground
// discovers demos by file name, so adding a component never touches a shared list.
type TDemo = {
  title: string;
  component: ComponentType;
};

export type { TDemo };
