import { type ContainerBuilder } from "./ContainerBuilder";

class ParameterResolver<T = unknown> {
    constructor(public resolver: (container: ContainerBuilder) => T) {}
}

export { ParameterResolver };
