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

export { VALID_HEX_VALUES, generateHEX };
