// Reads the package sources and writes the diagram model the harness paints.
// Syntax only: no type checker, no program. A dependency is a name the
// declaration mentions and the package declares somewhere else.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(packageRoot, "src");
const output = join(packageRoot, "harness", "model.generated.json");

const collapse = (text) => {
  return text.replace(/\s+/g, " ").trim();
};

const sourceFiles = () => {
  const files = readdirSync(sourceRoot)
    .filter((name) => {
      return name.endsWith(".ts") && !name.endsWith(".test.ts");
    })
    .map((name) => {
      return join(sourceRoot, name);
    });

  files.push(join(packageRoot, "exports.ts"));

  return files;
};

const parse = (path) => {
  const text = readFileSync(path, "utf8");

  return ts.createSourceFile(path, text, ts.ScriptTarget.ES2022, true);
};

// The `//` block that sits directly above a declaration, minus the slashes.
const docOf = (node, file) => {
  const ranges = ts.getLeadingCommentRanges(file.text, node.pos) ?? [];

  const lines = ranges.flatMap((range) => {
    return file.text
      .slice(range.pos, range.end)
      .split("\n")
      .map((line) => {
        return line.replace(/^\s*(\/\/|\/\*\*?|\*\/|\*)\s?/, "").trimEnd();
      });
  });

  return collapse(lines.join(" "));
};

const hasModifier = (node, kind) => {
  return (node.modifiers ?? []).some((modifier) => {
    return modifier.kind === kind;
  });
};

const tagsOf = (node) => {
  const tags = [];

  if (hasModifier(node, ts.SyntaxKind.StaticKeyword)) {
    tags.push("static");
  }

  if (hasModifier(node, ts.SyntaxKind.ReadonlyKeyword)) {
    tags.push("readonly");
  }

  if (hasModifier(node, ts.SyntaxKind.PrivateKeyword)) {
    tags.push("private");
  }

  return tags;
};

const nameOf = (node, file) => {
  if (!node.name) {
    return "constructor";
  }

  return node.name.getText(file);
};

const typeOf = (node, file) => {
  if (!node.type) {
    return "";
  }

  return collapse(node.type.getText(file));
};

const paramsOf = (node, file) => {
  return node.parameters
    .map((parameter) => {
      const name = parameter.name.getText(file);
      const type = typeOf(parameter, file);
      const optional = parameter.questionToken || parameter.initializer ? "?" : "";

      return type ? `${name}${optional}: ${type}` : `${name}${optional}`;
    })
    .join(", ");
};

// Every identifier the declaration mentions in a type position, in a `new`, in
// a heritage clause, or as a name its file imports. The caller keeps the ones
// the package declares.
const referencesOf = (node, file, imported) => {
  const found = new Map();

  const add = (name, kind) => {
    const rank = { extends: 3, creates: 2, uses: 1 };
    const previous = found.get(name);

    if (!previous || rank[kind] > rank[previous]) {
      found.set(name, kind);
    }
  };

  const walk = (current) => {
    if (ts.isHeritageClause(current)) {
      for (const type of current.types) {
        add(type.expression.getText(file), "extends");
      }
    }

    if (ts.isNewExpression(current) && ts.isIdentifier(current.expression)) {
      add(current.expression.text, "creates");
    }

    if (ts.isTypeReferenceNode(current)) {
      const root = ts.isQualifiedName(current.typeName)
        ? current.typeName.left.getText(file)
        : current.typeName.getText(file);

      add(root, "uses");
    }

    if (ts.isIdentifier(current) && imported.has(current.text)) {
      const parent = current.parent;
      const isMemberName =
        parent &&
        (ts.isPropertyAccessExpression(parent) || ts.isPropertySignature(parent) || ts.isPropertyAssignment(parent)) &&
        parent.name === current;

      if (!isMemberName) {
        add(current.text, "uses");
      }
    }

    ts.forEachChild(current, walk);
  };

  ts.forEachChild(node, walk);

  return found;
};

// Which member of the class mentions a name. The diagram draws the edge out of
// that row, so a dependency leaves the line that declares it.
const anchorsOf = (node, file, imported) => {
  const anchors = new Map();

  for (const member of node.members) {
    const label = ts.isConstructorDeclaration(member) ? "constructor" : nameOf(member, file);

    for (const name of referencesOf(member, file, imported).keys()) {
      const rows = anchors.get(name) ?? [];

      if (!rows.includes(label)) {
        rows.push(label);
        anchors.set(name, rows);
      }
    }
  }

  return anchors;
};

const readClass = (node, file, path, imported) => {
  const fields = [];
  const properties = [];
  const methods = [];

  for (const member of node.members) {
    if (ts.isPropertyDeclaration(member)) {
      fields.push({
        name: nameOf(member, file),
        type: typeOf(member, file),
        tags: tagsOf(member),
      });
    }

    if (ts.isGetAccessorDeclaration(member)) {
      properties.push({
        name: nameOf(member, file),
        type: typeOf(member, file) || "unknown",
        tags: ["get"],
      });
    }

    if (ts.isSetAccessorDeclaration(member)) {
      properties.push({
        name: nameOf(member, file),
        type: paramsOf(member, file),
        tags: ["set"],
      });
    }

    if (ts.isMethodDeclaration(member) || ts.isConstructorDeclaration(member)) {
      const returns = typeOf(member, file);
      const label = ts.isConstructorDeclaration(member) ? "constructor" : nameOf(member, file);

      methods.push({
        name: label,
        params: paramsOf(member, file),
        returns,
        tags: tagsOf(member),
      });
    }
  }

  return {
    id: node.name.getText(file),
    kind: "class",
    file: path,
    doc: docOf(node, file),
    fields,
    properties,
    methods,
    refs: referencesOf(node, file, imported),
    anchors: anchorsOf(node, file, imported),
  };
};

// A type alias takes any shape. An object lists its properties, a union lists
// its cases, an intersection lists both its parts and its properties, and
// anything else — a function, a mapped type — shows its text.
const membersOfType = (node, file) => {
  const fields = [];

  const pushMembers = (members) => {
    for (const member of members) {
      if (ts.isPropertySignature(member)) {
        fields.push({
          name: nameOf(member, file),
          type: typeOf(member, file),
          tags: member.questionToken ? ["optional"] : [],
        });
      }

      if (ts.isMethodSignature(member)) {
        fields.push({
          name: `${nameOf(member, file)}()`,
          type: typeOf(member, file),
          tags: [],
        });
      }

      if (ts.isIndexSignatureDeclaration(member)) {
        fields.push({
          name: collapse(member.parameters.map((parameter) => {
            return parameter.getText(file);
          }).join(", ")),
          type: typeOf(member, file),
          tags: ["index"],
        });
      }
    }
  };

  const pushText = (text) => {
    fields.push({
      name: collapse(text),
      type: "",
      tags: [],
    });
  };

  if (ts.isInterfaceDeclaration(node)) {
    pushMembers(node.members);

    return fields;
  }

  const type = node.type;

  if (!type) {
    return fields;
  }

  if (ts.isTypeLiteralNode(type)) {
    pushMembers(type.members);

    return fields;
  }

  if (ts.isUnionTypeNode(type)) {
    for (const part of type.types) {
      pushText(part.getText(file));
    }

    return fields;
  }

  if (ts.isIntersectionTypeNode(type)) {
    for (const part of type.types) {
      if (ts.isTypeLiteralNode(part)) {
        pushMembers(part.members);

        continue;
      }

      pushText(`& ${part.getText(file)}`);
    }

    return fields;
  }

  pushText(type.getText(file));

  return fields;
};

const readType = (node, file, path, imported) => {
  return {
    id: node.name.getText(file),
    kind: "type",
    file: path,
    doc: docOf(node, file),
    fields: membersOfType(node, file),
    properties: [],
    methods: [],
    refs: referencesOf(node, file, imported),
  };
};

const readExports = (file) => {
  const names = new Set();

  for (const statement of file.statements) {
    if (!ts.isExportDeclaration(statement) || !statement.exportClause) {
      continue;
    }

    if (!ts.isNamedExports(statement.exportClause)) {
      continue;
    }

    for (const element of statement.exportClause.elements) {
      names.add(element.name.getText(file));
    }
  }

  return names;
};

const build = () => {
  const declared = [];
  let published = new Set();

  for (const path of sourceFiles()) {
    const file = parse(path);
    const shortPath = relative(packageRoot, path);

    if (shortPath === "exports.ts") {
      published = readExports(file);

      continue;
    }

    const imported = new Set();

    for (const statement of file.statements) {
      if (!ts.isImportDeclaration(statement) || !statement.importClause) {
        continue;
      }

      const from = statement.moduleSpecifier.text;
      const bindings = statement.importClause.namedBindings;

      if (!bindings || !ts.isNamedImports(bindings)) {
        continue;
      }

      if (!from.startsWith(".")) {
        continue;
      }

      for (const element of bindings.elements) {
        imported.add(element.name.getText(file));
      }
    }

    for (const statement of file.statements) {
      if (ts.isClassDeclaration(statement) && statement.name) {
        declared.push(readClass(statement, file, shortPath, imported));
      }

      if (ts.isInterfaceDeclaration(statement) || ts.isTypeAliasDeclaration(statement)) {
        declared.push(readType(statement, file, shortPath, imported));
      }

    }
  }

  const byId = new Map(
    declared.map((node) => {
      return [node.id, node];
    }),
  );

  const edges = [];
  const seen = new Set();

  const push = (from, to, kind, members) => {
    const key = `${from}→${to}`;

    if (from === to || seen.has(key)) {
      return;
    }

    seen.add(key);
    edges.push({ from, to, kind, members });
  };

  for (const node of declared) {
    for (const [name, kind] of node.refs) {
      if (byId.has(name)) {
        push(node.id, name, kind, node.anchors?.get(name) ?? []);
      }
    }

    node.exported = published.has(node.id);
    delete node.refs;
    delete node.anchors;
  }

  return {
    package: JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).name,
    generatedAt: new Date().toISOString(),
    nodes: declared,
    edges,
  };
};

// The harness imports the JSON, so rewriting an identical file would restart
// the dev server for nothing. Only a real change to the sources lands on disk.
const same = (model) => {
  if (!existsSync(output)) {
    return false;
  }

  const previous = JSON.parse(readFileSync(output, "utf8"));

  return (
    JSON.stringify({ ...previous, generatedAt: "" }) === JSON.stringify({ ...model, generatedAt: "" })
  );
};

const write = () => {
  const model = build();

  if (same(model)) {
    return model;
  }

  writeFileSync(output, `${JSON.stringify(model, null, 2)}\n`);

  return model;
};

export { write };

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const model = write();

  process.stdout.write(`${model.nodes.length} узлов, ${model.edges.length} связей → ${relative(packageRoot, output)}\n`);
}
