import { AbstractFactoryBuilder, type ContainerBuilder, type Definition, type TFactory } from "../../internal";

class FactoryFactoryBuilder<T> extends AbstractFactoryBuilder<T> {
    public createFactory<R>(definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<R> {
        return () => {
            const factory = definition.getFactory();

            if (!factory) {
                throw new Error("FactoryFactoryBuilder can only be used with FactoryResource");
            }

            const { resource, methodName } = factory;

            const ctor = resource.resolve();

            const instance = new ctor();

            const args = this.resolveArguments(definition.getArguments(), containerBuilder);

            const method = instance[methodName];

            if (!method) {
                throw new Error(`Method ${String(methodName)} does not exist on ${ctor.name}`);
            }

            if (typeof method !== "function") {
                throw new Error(`Property ${String(methodName)} is not a function on ${ctor.name}`);
            }

            return method.apply(instance, args) as R;
        };
    }
}

export { FactoryFactoryBuilder };
