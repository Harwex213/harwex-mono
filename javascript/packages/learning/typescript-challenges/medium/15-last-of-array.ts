type Last<T extends any[]> = T extends [...infer _, infer L] ? L : never;

/* _____________ Test Cases _____________ */

type T1 = Last<[]>;
type T2 = Last<[2]>; // IDE shows it like never...
type T3 = Last<[3, 2, 1]>;
type T4 = Last<[() => 123, { a: string }]>;

const t2: T2 = 2;
