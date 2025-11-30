import { type TArgument } from "./internal";

class MethodCall<T> {
    constructor(
        public methodName: keyof T,
        public args: TArgument[],
    ) {}
}

export { MethodCall };
