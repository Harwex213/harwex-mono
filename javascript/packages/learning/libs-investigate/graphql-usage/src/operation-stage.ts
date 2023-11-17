import { executeSync, type GraphQLFieldResolver, type GraphQLTypeResolver, validate } from "graphql";
import { executableDefinition } from "./parse-stage";
import { validatedSchema } from "./validation-stage";

// 1. Validate
const validationErrors = validate(validatedSchema, executableDefinition);

console.log(validationErrors);

const fieldResolver: GraphQLFieldResolver<any, any> = (source, args, context, info) => {
    return {};
};

const typeResolver: GraphQLTypeResolver<any, any> = (source, args, context, info) => {
    return "zdarova?)";
};

const executionResult = executeSync({
    schema: validatedSchema,
    document: executableDefinition,
    rootValue: { something: "1" },
    contextValue: { something: "1" },
    variableValues: {
        argSpawn: "MORDOR",
    },
    operationName: "MyQuery",
    fieldResolver,
    typeResolver,
});

console.log(executionResult);
