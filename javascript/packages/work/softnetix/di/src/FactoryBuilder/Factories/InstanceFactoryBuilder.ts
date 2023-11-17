import {
    AbstractFactoryBuilder,
    type ContainerBuilder,
    type Definition,
    isInstanceResource,
    type TFactory,
} from "../../internal";

class InstanceFactoryBuilder<T> extends AbstractFactoryBuilder<T> {
    public createFactory(definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<T> {
        return () => {
            const resource = definition.getResource();

            if (!isInstanceResource(resource)) {
                throw new Error("InstanceFactoryBuilder can only be used with InstanceResource");
            }

            const instance = resource.resolve();

            definition.getMethodCalls().forEach(({ methodName, args }) => {
                const method = instance[methodName];

                if (!method) {
                    throw new Error(`Method ${String(methodName)} of instance does not exist`);
                }

                if (typeof method !== "function") {
                    throw new Error(`Property ${String(methodName)} of instance is not a function`);
                }

                method.apply(instance, this.resolveArguments(args, containerBuilder));
            });

            return instance;
        };
    }
}

export { InstanceFactoryBuilder };
