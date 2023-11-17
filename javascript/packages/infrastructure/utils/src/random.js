const randomKey = () => [...Array(12)].map(() => String.fromCharCode(Math.floor(Math.random() * 65535))).join("");

const randomRanged = (min, max) => min + (Math.ceil(Math.random() * 1_000_000_000) % (max - min + 1));

export { randomKey, randomRanged };
