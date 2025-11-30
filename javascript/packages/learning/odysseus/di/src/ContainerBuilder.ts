import {
    Container,
    CONTAINER_ID,
    Definition,
    type ICompiler,
    type IContainer,
    type TFactory,
    type TId,
    type TParameters,
} from "./internal";

class ContainerBuilder implements IContainer {
    private container = new Container();

    private definitions: Record<TId, Definition<any>> = {};

    private factories: Record<TId, TFactory<any>> = {};

    private loading: TId[] = [];

    private compiler: ICompiler;

    constructor(compiler: ICompiler) {
        this.compiler = compiler;
    }

    public has(id: TId): boolean {
        return this.hasDefinition(id) || this.container.has(id);
    }

    public hasDefinition(id: TId): boolean {
        return Object.hasOwn(this.definitions, id);
    }

    public hasParameter(id: TId): boolean {
        return this.container.hasParameter(id);
    }

    public get<T>(id: TId): T {
        if (!this.container.has(id) && this.hasDefinition(id)) {
            this.createService(id);
        }

        return this.container.get(id);
    }

    public getParameter<T>(id: TId): T {
        return this.container.getParameter(id);
    }

    public getParameters(): TParameters {
        return this.container.getParameters();
    }

    public getIds(): TId[] {
        return this.container.getIds();
    }

    public getDefinitions(): Definition<any>[] {
        return Reflect.ownKeys(this.definitions).map((id) => this.definitions[id] as Definition<any>);
    }

    public getDefinitionIds(): TId[] {
        return Reflect.ownKeys(this.definitions);
    }

    public getCompiler(): ICompiler {
        return this.compiler;
    }

    public set<T>(id: TId, inst: T): void {
        this.setFactory(id, () => inst, true);
    }

    public setParameters(parameters: TParameters): void {
        this.container.setParameters(parameters);
    }

    public setFactory<T>(id: TId, factory: TFactory<T>, singleton: boolean): void {
        this.container.setFactory(id, this.createDecoratedFactory(factory, id), singleton);
    }

    public addDefinitions(...definitions: Definition<any>[]): void {
        definitions.forEach((definition) => (this.definitions[definition.getId()] = definition));
    }

    public findDefinition<T>(id: TId): Definition<T> | undefined {
        return this.definitions[id];
    }

    public findTaggedServicesIds(...tagNames: string[]): TId[] {
        return this.getDefinitions()
            .filter((definition) => {
                return tagNames.some((tagName) => !!definition.getTag(tagName));
            })
            .map((definition) => {
                return definition.getId();
            });
    }

    public async build() {
        await this.compiler.compile(this);

        for (const id of Reflect.ownKeys(this.definitions)) {
            if (!this.container.has(id)) {
                this.createService(id);
            }
        }

        return this.container;
    }

    private getFactory(id: TId): TFactory<any> {
        if (id === CONTAINER_ID) {
            return () => this.container;
        }

        if (-1 !== this.loading.findIndex((c) => c === id)) {
            throw new Error("Circle reference.");
        }

        if (Object.hasOwn(this.factories, id)) {
            return this.factories[id] as TFactory<any>;
        }

        this.loading.push(id);

        const definition = this.definitions[id];

        if (definition) {
            const factoryBuilder = definition.getFactoryBuilder();

            if (factoryBuilder) {
                const factory = factoryBuilder.createFactory(definition, this);

                return (this.factories[id] = factory);
            }
        }

        this.loading = this.loading.filter((c) => c !== id);

        const factory = this.factories[id];

        if (!factory) {
            throw new Error("Factory not found");
        }

        return factory;
    }

    private getDecoratorsFor(id: TId): TId[] {
        return Reflect.ownKeys(this.definitions)
            .map((id) => this.definitions[id] as Definition<any>)
            .filter((definition) => definition.getDecorates() === id)
            .sort((a, b) => a.getDecorationPriority() - b.getDecorationPriority())
            .map((definition) => definition.getId());
    }

    private createService(id: TId) {
        const factory = this.getFactory(id);

        if (!factory) {
            throw new Error(`Factory for service ${String(id)} not found`);
        }

        if (!this.definitions[id]) {
            throw new Error(`Definition for service ${String(id)} not found`);
        }

        const definition = this.definitions[id];

        this.container.setFactory(id, this.createDecoratedFactory(factory, id), definition.isSingleton());
    }

    private createDecoratedFactory(factory: TFactory<any>, id: TId) {
        return () => {
            const instance = factory();

            this.container.set(id, instance);

            this.container.set(`${String(id)}.inner`, instance);

            this.getDecoratorsFor(id).forEach((decoratorId) => {
                const decoratedInstances = this.get(decoratorId);

                this.container.set(id, decoratedInstances);
            });

            return this.container.get(id);
        };
    }
}

export { ContainerBuilder };
