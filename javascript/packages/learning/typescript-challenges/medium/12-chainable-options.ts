type Chainable<T = {}> = {
    option<K extends string, V>(key: K extends keyof T ? never : K, value: V): Chainable<Omit<T, K> & Record<K, V>>;
    get(): T;
};

/* _____________ Test Cases _____________ */

declare const a: Chainable;

const result1 = a.option("foo", 123).option("bar", { value: "Hello World" }).option("name", "type-challenges").get();

const result2 = a
    .option("name", "another name")
    // @ts-expect-error
    .option("name", "last name")
    .get();

const result3 = a
    .option("name", "another name")
    // @ts-expect-error
    .option("name", 123)
    .get();
