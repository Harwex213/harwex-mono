import {
    ClassFactoryBuilder,
    ClassResource,
    Factory,
    FactoryFactoryBuilder,
    FunctionFactoryBuilder,
    FunctionResource,
    type IFactoryBuilder,
    InstanceFactoryBuilder,
    InstanceResource,
    MethodCall,
    Tag,
    type TArgument,
    type TClass,
    TFunction,
    type TId,
    type TResource,
} from "./internal";

class Definition<T> {
    private id: TId;

    private singleton = true;

    private resource?: TResource<T>;

    private arguments: TArgument[] = [];

    private factory?: Factory<T>;

    private factoryBuilder?: IFactoryBuilder<T>;

    private methodCalls: MethodCall<T>[] = [];

    private tags: Tag[] = [];

    private decorates?: TId;

    private decorationPriority = 0;

    public setId(id: TId): this {
        this.id = id;

        return this;
    }

    public setClass(ctor: TClass<T>): this {
        this.resource = new ClassResource<T>(ctor);
        this.factoryBuilder = new ClassFactoryBuilder<T>();

        return this;
    }

    public setFactory(ctor: TClass<T>, methodName: keyof T): this {
        this.resource = new ClassResource<T>(ctor);
        this.factory = new Factory<T>(this.resource, methodName);
        this.factoryBuilder = new FactoryFactoryBuilder<T>();

        return this;
    }

    public setInstance(instance: T): this {
        this.resource = new InstanceResource<T>(instance);
        this.factoryBuilder = new InstanceFactoryBuilder<T>();

        return this;
    }

    public setFunction(func: TFunction<T>): this {
        this.resource = new FunctionResource<T>(func);
        this.factoryBuilder = new FunctionFactoryBuilder();

        return this;
    }

    public setDecorates(wrapperId: TId): this {
        this.decorates = wrapperId;

        return this;
    }

    public setDecorationPriority(priority: number): this {
        this.decorationPriority = priority;

        return this;
    }

    public addArguments(...args: TArgument[]) {
        this.arguments.push(...args);

        return this;
    }

    public addMethodCalls(...calls: MethodCall<T>[]) {
        this.methodCalls = calls;

        return this;
    }

    public addTags(...tags: Tag[]): this {
        this.tags = tags;

        return this;
    }

    public getId() {
        return this.id;
    }

    public getResource(): TResource<T> {
        if (!this.resource) {
            throw new Error(`Resource is not set for definition ${String(this.id)}`);
        }

        return this.resource;
    }

    public getFactory(): Factory<T> | undefined {
        if (!this.factory) {
            throw new Error(`Factory is not set for definition ${String(this.id)}`);
        }

        return this.factory;
    }

    public getFactoryBuilder(): IFactoryBuilder<T> | undefined {
        return this.factoryBuilder;
    }

    public getArguments(): TArgument[] {
        return this.arguments;
    }

    public getMethodCalls(): MethodCall<T>[] {
        return this.methodCalls;
    }

    public getTags(): Tag[] {
        return this.tags;
    }

    public getTag<Attr extends Record<string, any>>(name: string): Tag<Attr> | undefined {
        return this.tags.find((tag) => tag.name === name) as Tag<Attr> | undefined;
    }

    public getDecorates(): TId | undefined {
        return this.decorates;
    }

    public getDecorationPriority(): number {
        return this.decorationPriority;
    }

    public isSingleton() {
        return this.singleton;
    }

    public clone() {
        // todo deep clone?
        // todo qa - new id?
        const inst = new Definition<T>();

        inst.arguments = [...this.arguments];
        inst.singleton = this.singleton;
        inst.methodCalls = [...this.methodCalls];
        inst.tags = [...this.tags];
        inst.factoryBuilder = this.factoryBuilder;
        inst.resource = this.resource;
        inst.factory = this.factory;
        inst.decorates = this.decorates;

        return inst;
    }
}

export { Definition };
