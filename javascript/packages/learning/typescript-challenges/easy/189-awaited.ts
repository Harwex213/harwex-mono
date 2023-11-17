type MyAwaited<T> = T extends PromiseLike<infer V> ? (V extends PromiseLike<infer U> ? MyAwaited<U> : V) : T;

type X = Promise<string>;
type Y = Promise<{ field: number }>;
type Z = Promise<Promise<string | number>>;
type Z1 = Promise<Promise<Promise<string | boolean>>>;
type T = { then: (onfulfilled: (arg: number) => any) => any };

type AwaitedY = MyAwaited<Y>;

type cases = [MyAwaited<X>, MyAwaited<Y>, MyAwaited<Z>, MyAwaited<Z1>, MyAwaited<T>];
