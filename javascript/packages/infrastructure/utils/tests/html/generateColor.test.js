import { describe, it } from "node:test";
import { generateHEX } from "../../index.js";
import { VALID_HEX_VALUES } from "../../src/html/generateColor.js";

const assertValidHex = (hex) => {
  assert.strictEqual(hex[0], "#");
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[1]), true);
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[2]), true);
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[3]), true);
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[4]), true);
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[5]), true);
  assert.strictEqual(VALID_HEX_VALUES.includes(hex[6]), true);
};

describe("generateColor", () => {
  it("should create valid color", () => {
    const generatedColor = generateHEX();

    assertValidHex(generatedColor);
  });
});
