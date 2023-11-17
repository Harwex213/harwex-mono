type Length<T extends Readonly<unknown[]>> = T["length"];

/* _____________ Test Cases _____________ */

const tesla = ["tesla", "model 3", "model X", "model Y"] as const;
const spaceX = ["FALCON 9", "FALCON HEAVY", "DRAGON", "STARSHIP", "HUMAN SPACEFLIGHT"] as const;

const length: Length<typeof tesla> = 4;
