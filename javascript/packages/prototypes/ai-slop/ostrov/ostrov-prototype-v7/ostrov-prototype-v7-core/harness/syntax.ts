type Role = "name" | "param" | "type" | "keyword" | "punct";

type Token = {
  text: string;
  role: Role;
};

const keywords = new Set([
  "any",
  "bigint",
  "boolean",
  "never",
  "null",
  "number",
  "object",
  "readonly",
  "string",
  "symbol",
  "undefined",
  "unknown",
  "void",
]);

const isWord = (char: string): boolean => {
  return /[\w$#]/.test(char);
};

// A signature is short and regular, so a state machine over the characters is
// enough: the name comes before the first bracket, a `:` opens a type, a `,`
// closes it.
const tokenize = (signature: string): Token[] => {
  const tokens: Token[] = [];
  let depth = 0;
  let opened = false;
  let expectType = false;
  let index = 0;

  const push = (text: string, role: Role): void => {
    const last = tokens[tokens.length - 1];

    if (last && last.role === role) {
      last.text += text;

      return;
    }

    tokens.push({ text, role });
  };

  while (index < signature.length) {
    const char = signature[index] ?? "";

    if (isWord(char)) {
      let word = "";

      while (index < signature.length && isWord(signature[index] ?? "")) {
        word += signature[index];
        index += 1;
      }

      if (!opened && depth === 0) {
        push(word, "name");
      } else if (keywords.has(word)) {
        push(word, "keyword");
      } else {
        push(word, expectType ? "type" : "param");
      }

      continue;
    }

    if (char === "(") {
      depth += 1;
      opened = true;
      expectType = false;
    }

    if (char === ")") {
      depth -= 1;
      expectType = false;
    }

    if (char === ":") {
      expectType = true;
    }

    if (char === "," && depth === 1) {
      expectType = false;
    }

    push(char, "punct");
    index += 1;
  }

  return tokens;
};

export { tokenize };
export type { Role, Token };
