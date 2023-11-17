type First<T extends any[]> = T["length"] extends 0 ? never : T[0];

/* _____________ Test Cases _____________ */

type cases = [First<[3, 2, 1]>, First<[() => 123, { a: string }]>, First<[]>, First<[undefined]>];

type errors = [
    // @ts-expect-error
    First<"notArray">,
    // @ts-expect-error
    First<{ 0: "arrayLike" }>,
];
