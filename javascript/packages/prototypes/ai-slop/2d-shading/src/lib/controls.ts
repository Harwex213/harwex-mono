type SliderSpec = {
  label: string;
  min: number;
  max: number;
  step: number;
  value: number;
  format: (value: number) => string;
  onInput: (value: number) => void;
};

function slider(spec: SliderSpec): HTMLElement {
  const row = document.createElement("label");
  row.className = "control";

  const head = document.createElement("span");
  head.className = "control-head";
  const name = document.createElement("span");
  name.textContent = spec.label;
  const readout = document.createElement("b");
  readout.textContent = spec.format(spec.value);
  head.append(name, readout);

  const input = document.createElement("input");
  input.type = "range";
  input.min = String(spec.min);
  input.max = String(spec.max);
  input.step = String(spec.step);
  input.value = String(spec.value);
  input.addEventListener("input", () => {
    const value = Number(input.value);
    readout.textContent = spec.format(value);
    spec.onInput(value);
  });

  row.append(head, input);
  return row;
}

function toggle(label: string, value: boolean, onChange: (value: boolean) => void): HTMLElement {
  const row = document.createElement("label");
  row.className = "control control-toggle";

  const input = document.createElement("input");
  input.type = "checkbox";
  input.checked = value;
  input.addEventListener("change", () => {
    onChange(input.checked);
  });

  const name = document.createElement("span");
  name.textContent = label;

  row.append(input, name);
  return row;
}

let radioSeq = 0;

// Radio group. The name has to be unique per mounted demo, otherwise two groups on
// one page share a selection — hence the counter rather than a caller-supplied id.
function radio(
  options: Array<{ value: string; label: string }>,
  value: string,
  onChange: (value: string) => void,
): HTMLElement {
  radioSeq += 1;
  const name = `radio-${radioSeq}`;

  const box = document.createElement("div");
  box.className = "radio-group";

  for (const option of options) {
    const row = document.createElement("label");
    row.className = "control control-toggle";

    const input = document.createElement("input");
    input.type = "radio";
    input.name = name;
    input.value = option.value;
    input.checked = option.value === value;
    input.addEventListener("change", () => {
      if (input.checked) {
        onChange(option.value);
      }
    });

    const text = document.createElement("span");
    text.textContent = option.label;

    row.append(input, text);
    box.append(row);
  }

  return box;
}

function group(title: string, children: HTMLElement[]): HTMLElement {
  const box = document.createElement("section");
  box.className = "control-group";
  const head = document.createElement("h3");
  head.textContent = title;
  box.append(head, ...children);
  return box;
}

// A live text line the render loop writes into. Returned as a setter rather than
// an element to keep per-frame DOM churn down to one textContent assignment.
function stats(): { el: HTMLElement; set: (text: string) => void } {
  const el = document.createElement("pre");
  el.className = "stats";
  return {
    el,
    set: (text: string) => {
      el.textContent = text;
    },
  };
}

export { group, radio, slider, stats, toggle };
