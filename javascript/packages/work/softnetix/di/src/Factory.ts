import { type ClassResource } from "./internal";

class Factory<T> {
    constructor(
        public resource: ClassResource<T>,
        public methodName: keyof T,
    ) {}
}

export { Factory };
