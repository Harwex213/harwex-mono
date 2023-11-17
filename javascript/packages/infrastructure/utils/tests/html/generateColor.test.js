import { describe, it } from "node:test";
import { assertValidHex, generateHEX } from "../../index.js";

describe("generateColor", () => {
    it("should create valid color", () => {
        const generatedColor = generateHEX();

        assertValidHex(generatedColor);
    });
});
