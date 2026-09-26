import { signatureOf } from "./model";
import { tokenize } from "./syntax";
import type { Field, ModelNode } from "./model";

const listOf = (items: string[][]): HTMLElement => {
  const list = document.createElement("ul");

  for (const [left, right] of items) {
    const row = document.createElement("li");

    row.append(left ?? "");

    if (right) {
      const type = document.createElement("span");

      type.className = "type";
      type.textContent = `: ${right}`;
      row.append(type);
    }

    list.append(row);
  }

  return list;
};

const fieldRows = (fields: Field[]): string[][] => {
  return fields.map((field) => {
    const tags = field.tags.filter((tag) => {
      return tag !== "get";
    });

    const name = tags.length > 0 ? `${field.name} (${tags.join(", ")})` : field.name;

    return [name, field.type];
  });
};

const section = (title: string, body: HTMLElement): HTMLElement[] => {
  const heading = document.createElement("h3");

  heading.textContent = title;

  return [heading, body];
};

const signatures = (node: ModelNode): HTMLElement => {
  const list = document.createElement("ul");

  for (const method of node.methods) {
    const row = document.createElement("li");

    for (const token of tokenize(signatureOf(method))) {
      const span = document.createElement("span");

      span.className = `tok-${token.role}`;
      span.textContent = token.text;
      row.append(span);
    }

    list.append(row);
  }

  return list;
};

// The panel repeats what the box shows, without a truncated line: the full type
// of every field and the full signature of every method.
const renderInspector = (panel: HTMLElement, node: ModelNode | undefined, onClose: () => void): void => {
  panel.replaceChildren();
  panel.classList.toggle("open", Boolean(node));

  if (!node) {
    return;
  }

  const close = document.createElement("button");

  close.className = "close";
  close.textContent = "×";
  close.addEventListener("click", onClose);

  const title = document.createElement("h2");

  title.textContent = node.id;

  const path = document.createElement("p");

  path.className = "path";
  path.textContent = node.exported ? `${node.file} · экспорт` : node.file;

  panel.append(close, title, path);

  if (node.doc) {
    const doc = document.createElement("p");

    doc.className = "doc";
    doc.textContent = node.doc;
    panel.append(doc);
  }

  if (node.fields.length > 0) {
    panel.append(...section("поля", listOf(fieldRows(node.fields))));
  }

  if (node.properties.length > 0) {
    panel.append(...section("свойства", listOf(fieldRows(node.properties))));
  }

  if (node.methods.length > 0) {
    panel.append(...section("методы", signatures(node)));
  }
};

export { renderInspector };
