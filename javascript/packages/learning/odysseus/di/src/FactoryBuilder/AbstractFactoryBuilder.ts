import {
    ContainerBuilder,
    Definition,
    type IFactoryBuilder,
    Parameter,
    ParameterResolver,
    Reference,
    type TArgument,
    type TFactory,
} from "../internal";

abstract class AbstractFactoryBuilder<T> implements IFactoryBuilder<T> {
    public resolveArguments(args: TArgument[], containerBuilder: ContainerBuilder) {
        return args.map((arg) => {
            if (arg instanceof Reference) {
                return containerBuilder.get(arg.id);
            }

            if (arg instanceof Parameter) {
                return containerBuilder.getParameter(arg.id);
            }

            if (arg instanceof ParameterResolver) {
                return arg.resolver(containerBuilder);
            }

            return arg;
        });
    }

    public abstract createFactory(definition: Definition<T>, containerBuilder: ContainerBuilder): TFactory<T>;
}

export { AbstractFactoryBuilder };
