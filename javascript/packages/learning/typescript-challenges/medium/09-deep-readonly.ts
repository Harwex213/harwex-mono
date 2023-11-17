type DeepReadonly<T extends object> = {
    readonly [key in keyof T]: T[key] extends object
        ? T[key] extends Function
            ? T[key]
            : DeepReadonly<T[key]>
        : T[key];
};

/* _____________ Test Cases _____________ */

type cases1 = DeepReadonly<X1>;
type cases2 = DeepReadonly<X2>;

type X1 = {
    a: () => 22;
    b: string;
    c: {
        d: boolean;
        e: {
            g: {
                h: {
                    i: true;
                    j: "string";
                };
                k: "hello";
            };
            l: [
                "hi",
                {
                    m: ["hey"];
                },
            ];
        };
    };
};

type X2 = { a: string } | { b: number };
