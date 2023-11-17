import type { TFactory, TId, TParameters } from "../internal";

interface IContainer {
    has(id: TId): boolean;

    get<T>(id: TId): T;

    set<T>(id: TId, service: T): void;

    setFactory<T>(id: TId, factory: TFactory<T>, singleton: boolean): void;

    hasParameter(id: TId): boolean;

    setParameters(parameters: TParameters): void;

    getParameters(): TParameters;

    getParameter<T>(id: TId): T;

    getIds(): TId[];
}

export type { IContainer };
