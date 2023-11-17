import type { Maybe } from "./jsutils/Maybe";
import type { PromiseOrValue } from "./jsutils/PromiseOrValue";

export interface GraphQLArgs {
    schema: GraphQLSchema;
    source: string | Source;
    rootValue?: unknown;
    contextValue?: unknown;
    variableValues?: Maybe<{ readonly [variable: string]: unknown }>;
    operationName?: Maybe<string>;
    fieldResolver?: Maybe<GraphQLFieldResolver<any, any>>;
    typeResolver?: Maybe<GraphQLTypeResolver<any, any>>;
}

export function graphql(args: GraphQLArgs): Promise<ExecutionResult> {
    return new Promise((resolve) => resolve(graphqlImpl(args)));
}

function graphqlImpl(args: GraphQLArgs): PromiseOrValue<ExecutionResult> {
    const { schema, source, rootValue, contextValue, variableValues, operationName, fieldResolver, typeResolver } =
        args;

    const schemaValidationErrors = validateSchema(schema);
    if (schemaValidationErrors.length > 0) {
        return { errors: schemaValidationErrors };
    }

    let document;
    try {
        document = parse(source);
    } catch (syntaxError) {
        return { errors: [syntaxError] };
    }

    const validationErrors = validate(schema, document);
    if (validationErrors.length > 0) {
        return { errors: validationErrors };
    }

    return execute({
        schema,
        document,
        rootValue,
        contextValue,
        variableValues,
        operationName,
        fieldResolver,
        typeResolver,
    });
}
