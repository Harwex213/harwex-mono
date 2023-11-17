/**
 * distributive conditional types
 * https://www.typescriptlang.org/docs/handbook/2/conditional-types.html#distributive-conditional-types
 */
type MyExclude<T, U> = T extends U ? never : T;

/* _____________ Test Cases _____________ */

type cases = MyExclude<"a" | "b" | "c", "a">;
