/** A fresh random seed, for an "another island" button. */
const createSeedText = () => Math.floor(Math.random() * 0xffffff).toString(36).toUpperCase();

export { createSeedText };
