/** A fresh random seed, for an "another one" button. */
const createSeedText = () => Math.floor(Math.random() * 0xffffff).toString(36).toUpperCase();

export { createSeedText };
