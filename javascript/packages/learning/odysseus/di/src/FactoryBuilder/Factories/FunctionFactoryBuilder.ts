import {
    AbstractFactoryBuilder,
    type ContainerBuilder,
    type Definition,
    isFunctionResource,
    type TFactory,
} from "../../internal";

class FunctionFactoryBuilder<T> extends AbstractFactoryBuilder<T> {
    public createFactory(definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<T> {
        return () => {
            const resource = definition.getResource();

            if (!isFunctionResource(resource)) {
                throw new Error("FunctionFactoryBuilder can only be used with FunctionResource");
            }

            const func = resource.resolve();

            const args = this.resolveArguments(definition.getArguments(), containerBuilder);

            return func(...args);
        };
    }
}

export { FunctionFactoryBuilder };
