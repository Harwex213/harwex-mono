const T = {
  string: {
    type: "string",
  },
  number: {
    type: "number",
  },
  bool: {
    type: "boolean",
  },
  optional: (s) => ({ ...s, optional: true }),
  array: (s) => ({ type: "array", of: s }),
  object: (fields) => ({ type: "object", fields }),
};
