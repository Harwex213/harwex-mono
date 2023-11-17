type MyReadonly2<T, K extends keyof T = keyof T> = {
    [Key2 in keyof T as Key2 extends K ? never : Key2]: T[Key2];
} & {
    readonly [Key in K]: T[Key];
};

/* _____________ Test Cases _____________ */

type cases = [
    MyReadonly2<Todo1>,
    MyReadonly2<Todo1, "title" | "description">,
    MyReadonly2<Todo2, "title" | "description">,
    MyReadonly2<Todo2, "description">,
];

// @ts-expect-error
type error = MyReadonly2<Todo1, "title" | "invalid">;

interface Todo1 {
    title: string;
    description?: string;
    completed: boolean;
}

interface Todo2 {
    readonly title: string;
    description?: string;
    completed: boolean;
}

interface Expected {
    readonly title: string;
    readonly description?: string;
    completed: boolean;
}
