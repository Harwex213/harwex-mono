import {
    CONTAINER_ID,
    ContainerException,
    type IContainer,
    type TFactory,
    type TId,
    type TParameters,
} from "./internal";

type TContainerFactory = { factory: TFactory<any>; singleton: boolean };

class Container implements IContainer {
    private services: Record<TId, any> = {};

    private factories: Record<TId, TContainerFactory> = {};

    private parameters: Record<TId, any> = {};

    has(id: TId): boolean {
        return Object.hasOwn(this.factories, id) || Object.hasOwn(this.services, id);
    }

    get<T>(id: TId): T {
        return this.doGet<T>(id);
    }

    set<T>(id: TId, service: T): void {
        this.services[id] = service;
    }

    setFactory<T>(id: TId, factory: TFactory<T>, singleton: boolean): void {
        this.factories[id] = { factory, singleton };
    }

    hasParameter(id: TId): boolean {
        return Object.hasOwn(this.parameters, id);
    }

    setParameters(parameters: TParameters): void {
        this.parameters = parameters;
    }

    getParameters(): TParameters {
        return this.parameters;
    }

    getParameter<T>(id: TId): T {
        if (!Object.hasOwn(this.parameters, id)) {
            throw ContainerException.parameterNotFound(id);
        }

        return this.parameters[id] as T;
    }

    getIds(): TId[] {
        return Reflect.ownKeys(this.factories);
    }

    private doGet<T>(id: TId): T {
        if (id === CONTAINER_ID) {
            return this as unknown as T;
        }

        if (!this.has(id)) {
            throw ContainerException.serviceNotFound(id);
        }

        if (Object.hasOwn(this.services, id)) {
            return this.services[id] as T;
        }

        const { factory, singleton } = this.factories[id] as { factory: TFactory<T>; singleton: boolean };

        if (singleton) {
            const instance = factory();

            this.set(id, instance);

            return instance;
        }

        return factory();
    }
}

export { Container };
