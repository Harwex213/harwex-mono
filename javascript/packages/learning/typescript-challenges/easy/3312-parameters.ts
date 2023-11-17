type MyParameters<T extends (...args: any[]) => any> = T extends (...args: infer K) => any ? K : never;

function foo(arg1: string, arg2: number): void {}

function bar(arg1: boolean, arg2: { a: "A" }): void {}

function baz(): void {}

type TTT = MyParameters<typeof foo>;

type cases = [MyParameters<typeof foo>, MyParameters<typeof bar>, MyParameters<typeof baz>];
