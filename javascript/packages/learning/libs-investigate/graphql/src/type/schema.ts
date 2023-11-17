import type { Maybe } from "../jsutils/Maybe";
import type { ObjMap } from "../jsutils/ObjMap";
import { instanceOf } from "../jsutils/instanceOf";

export function isSchema(schema: unknown): schema is GraphQLSchema {
    return instanceOf(schema, GraphQLSchema);
}

export class GraphQLSchema {
    description: Maybe<string>;
    extensions: Readonly<GraphQLSchemaExtenstions>;
    astNode: Maybe<SchemaDefinitionNode>;
    extensionASTNodes: ReadonlyArray<SchemaExtensionNode>;

    __validationErrors: Maybe<ReadonlyArray<GraphQLError>>;

    private _queryType: Maybe<GraphQLObjectType>;
    private _mutationType: Maybe<GraphQLObjectType>;
    private _subscriptionType: Maybe<GraphQLObjectType>;
    private _directives: Maybe<GraphQLObjectType>;
    private _typeMap: TypeMap;
    private _subTypeMap: ObjMap<ObjMap<boolean>>;
    private _implementationsMap: ObjMap<{
        objects: Array<GraphQLObjectType>;
        interfaces: Array<GraphQLObjectType>;
    }>;

    constructor(config: Readonly<GraphQLSchemaConfig>) {
        this.__validationErrors = config.assumeValid === true ? [] : undefined;
    }
}

type TypeMap = ObjMap<GraphQLNamedTyped>;

export interface GraphQLSchemaValidationOptions {
    assumeValid?: boolean;
}

export interface GraphQLSchemaConfig extends GraphQLSchemaValidationOptions {
    description?: Maybe<string>;
    query?: Maybe<GraphQLObjectType>;
    mutation?: Maybe<GraphQLObjectType>;
    subscription?: Maybe<GraphQLObjectType>;
    types?: Maybe<ReadonlyArray<GraphQLNamedType>>;
    directives?: Maybe<ReadonlyArray<GraphQLDirective>>;
    extensions?: Maybe<ReadonlyArray<GraphQLSchemaExtensions>>;
    astNode?: Maybe<SchemaDefinitionNode>;
    extensionsASTNodes?: Maybe<ReadonlyArray<SchemaExtensionNode>>;
}

/**
 * @internal
 */
export interface GraphQLSchemaNormalizedConfig extends GraphQLSchemaConfig {
    description: Maybe<string>;
    types: Maybe<ReadonlyArray<GraphQLNamedType>>;
    directives: Maybe<ReadonlyArray<GraphQLDirective>>;
    extensions: Maybe<ReadonlyArray<GraphQLSchemaExtensions>>;
    extensionsASTNodes: Maybe<ReadonlyArray<SchemaExtensionNode>>;
    assumeValid: boolean;
}
