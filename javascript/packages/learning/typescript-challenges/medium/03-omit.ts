/**
 * remaping via 'as' clause
 * https://www.typescriptlang.org/docs/handbook/2/mapped-types.html#key-remapping-via-as
 */
type MyExclude<T, U> = T extends U ? never : T;

type MyOmit<T, K extends keyof T> = {
    [Key in MyExclude<keyof T, K>]: T[Key];
};

/* _____________ Test Cases _____________ */

type T1 = MyOmit<Todo, "description" | "completed">;

// @ts-expect-error
type error = MyOmit<Todo, "description" | "invalid">;

interface Todo {
    title: string;
    description: string;
    completed: boolean;
}
