// What a press on the map means. The input handler of the map canvas asks this
// on every `pointerdown` and runs the answer; the rule itself stays testable.

type Tool = "brush" | "bucket" | "eraser" | "picker";

type PressInput = {
  // Space is held: any tool pans, the way it does in every paint program.
  spaceHeld: boolean;
  // `PointerEvent.button`: 0 left, 1 middle, 2 right.
  button: number;
  tool: Tool;
};

type Press =
  | { kind: "pan" }
  | { kind: "ignore" }
  | { kind: "pick" }
  | { kind: "fill"; erasing: boolean }
  | { kind: "stroke"; erasing: boolean };

function classifyPress(input: PressInput): Press {
  if (input.spaceHeld || input.button === 1) {
    return { kind: "pan" };
  }

  if (input.button !== 0 && input.button !== 2) {
    return { kind: "ignore" };
  }

  if (input.tool === "picker") {
    return { kind: "pick" };
  }

  // The right button erases whatever the active tool is, the same convention a
  // pixel editor uses for its secondary colour.
  const erasing = input.button === 2 || input.tool === "eraser";

  if (input.tool === "bucket") {
    return { kind: "fill", erasing };
  }

  return { kind: "stroke", erasing };
}

export {
  classifyPress,
  type Press,
  type PressInput,
  type Tool,
};
