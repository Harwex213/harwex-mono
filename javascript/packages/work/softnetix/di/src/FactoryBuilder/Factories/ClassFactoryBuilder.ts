import { AbstractFactoryBuilder, ContainerBuilder, Definition, isClassResource, TFactory } from "../../internal";

class ClassFactoryBuilder<T> extends AbstractFactoryBuilder<T> {
    public createFactory =
        (definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<T> =>
        () => {
            const resource = definition.getResource();

            if (!isClassResource(resource)) {
                throw new Error("ClassFactoryBuilder can only be used with ClassResource");
            }

            const ctor = resource.resolve();

            const args = this.resolveArguments(definition.getArguments(), containerBuilder);

            const instance = new ctor(...args);

            definition.getMethodCalls().forEach(({ methodName, args }) => {
                const method = instance[methodName];

                if (!method) {
                    throw new Error(`Method ${String(methodName)} does not exist on ${ctor.name}`);
                }

                if (typeof method !== "function") {
                    throw new Error(`Property ${String(methodName)} is not a function on ${ctor.name}`);
                }

                method.apply(instance, this.resolveArguments(args, containerBuilder));
            });

            return instance;
        };
}

export { ClassFactoryBuilder };
