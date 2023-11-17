type MyPick<T, K extends keyof T> = {
    [Key in K]: T[Key];
};

type Test = MyPick<Todo, "title" | "completed">;

interface Todo {
    title: string;
    description: string;
    completed: boolean;
}
