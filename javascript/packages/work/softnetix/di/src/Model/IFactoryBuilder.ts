import { ContainerBuilder, type Definition, type TFactory } from "../internal";

interface IFactoryBuilder<T> {
    createFactory(definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<T>;
}

export { type IFactoryBuilder };
