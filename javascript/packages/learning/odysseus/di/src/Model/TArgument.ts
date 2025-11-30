import { type Parameter, type ParameterResolver, type Reference } from "../internal";

type TArgument =
    | Parameter
    | ParameterResolver
    | Reference
    | string
    | symbol
    | number
    | boolean
    | Record<string, unknown>;

export { type TArgument };
