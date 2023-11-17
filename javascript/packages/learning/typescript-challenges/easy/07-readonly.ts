type MyReadonly<T> = {
    readonly [Key in keyof T]: T[Key];
};

interface Todo1 {
    title: string;
    description: string;
    completed: boolean;
    meta: {
        author: string;
    };
}

type T = MyReadonly<Todo1>;
