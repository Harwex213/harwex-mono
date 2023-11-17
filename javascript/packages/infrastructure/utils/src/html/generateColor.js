import assert from "node:assert";
import { randomRanged } from "../random.js";

const VALID_HEX_VALUES = "0123456789ABCDEF";

const generateHEX = () => {
    const i0 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    const i1 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    const i2 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    const i3 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    const i4 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    const i5 = randomRanged(0, VALID_HEX_VALUES.length - 1);
    return (
        "#" +
        VALID_HEX_VALUES[i0] +
        VALID_HEX_VALUES[i1] +
        VALID_HEX_VALUES[i2] +
        VALID_HEX_VALUES[i3] +
        VALID_HEX_VALUES[i4] +
        VALID_HEX_VALUES[i5]
    );
};

const assertValidHex = (hex) => {
    assert.strictEqual(hex[0], "#");
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[1]), true);
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[2]), true);
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[3]), true);
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[4]), true);
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[5]), true);
    assert.strictEqual(VALID_HEX_VALUES.includes(hex[6]), true);
};

export { assertValidHex, generateHEX };
