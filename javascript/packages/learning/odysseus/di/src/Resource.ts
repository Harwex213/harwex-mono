import { type TClass, type TFunction } from "./internal";

interface IResource<T> {
    resolve(): T;
}

type TResource<T> = ClassResource<T> | InstanceResource<T> | FunctionResource<T>;

class InstanceResource<T> implements IResource<T> {
    public instance: T;

    constructor(instance: T) {
        this.instance = instance;
    }

    public resolve(): T {
        return this.instance;
    }
}

class ClassResource<T> implements IResource<TClass<T>> {
    public ctor: TClass<T>;

    constructor(ctor: TClass<T>) {
        this.ctor = ctor;
    }

    public resolve(): TClass<T> {
        return this.ctor;
    }
}

class FunctionResource<T> implements IResource<TFunction<T>> {
    public func: TFunction<T>;

    constructor(func: TFunction<T>) {
        this.func = func;
    }

    public resolve(): TFunction<T> {
        return this.func;
    }
}

const isClassResource = <T>(resource: TResource<T>): resource is ClassResource<T> => resource instanceof ClassResource;
const isInstanceResource = <T>(resource: TResource<T>): resource is InstanceResource<T> =>
    resource instanceof InstanceResource;
const isFunctionResource = <T>(resource: TResource<T>): resource is FunctionResource<T> =>
    resource instanceof FunctionResource;

export {
    InstanceResource,
    ClassResource,
    FunctionResource,
    type TResource,
    isClassResource,
    isInstanceResource,
    isFunctionResource,
};
