type MyReturnType<T> = T extends (...args: any[]) => infer U ? U : never;

type cases = [
    MyReturnType<() => string>,
    MyReturnType<() => 123>,
    MyReturnType<() => ComplexObject>,
    MyReturnType<() => Promise<boolean>>,
    MyReturnType<() => () => "foo">,
    MyReturnType<typeof fn>,
    MyReturnType<typeof fn1>,
];

type ComplexObject = {
    a: [12, "foo"];
    bar: "hello";
    prev(): number;
};

const fn = (v: boolean) => (v ? 1 : 2);
const fn1 = (v: boolean, w: any) => (v ? 1 : 2);
