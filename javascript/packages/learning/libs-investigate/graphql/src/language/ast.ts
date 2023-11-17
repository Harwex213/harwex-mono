import { Kind } from "./kinds";
import { TokenKind } from "./tokenKind";
import { Source } from "./source";

export class Location {
    readonly start: number;
    readonly end: number;
    readonly startToken: Token;
    readonly endToken: Token;
    readonly source: Source;

    constructor(startToken: Token, endToken: Token, source: Source) {
        this.start = startToken.start;
        this.end = endToken.end;
        this.startToken = startToken;
        this.endToken = endToken;
        this.source = source;
    }
}

export class Token {
    readonly kind: TokenKind;
    readonly start: number;
    readonly end: number;
    readonly line: number;
    readonly column: number;
    readonly value: string;

    /**
     * <SOF> is always first node & <EOF> is always last node
     */
    readonly prev: Token | null;
    readonly next: Token | null;

    constructor(kind: TokenKind, start: number, end: number, line: number, column: number, value?: string) {
        this.kind = kind;
        this.start = start;
        this.end = end;
        this.line = line;
        this.column = column;
        this.value = value!;
        this.prev = null;
        this.next = null;
    }

    toJSON() {
        return {
            kind: this.kind,
            value: this.value,
            line: this.line,
            column: this.column,
        };
    }
}

/**
 * Name
 */

export interface NameNode {
    readonly kind: Kind.NAME;
    readonly loc?: Location;
    readonly value: string;
}

/**
 * Document
 */

export interface DocumentNode {
    readonly kind: Kind.DOCUMENT;
    readonly loc?: Location;
    readonly definitions?: ReadonlyArray<DefinitionNode>;
    readonly tokenCount?: number | undefined;
}

export type DefinitionNode = ExecutableDefinitionNode | TypeSystemDefinitionNode | TypeSystemExtensionNode;

export type ExecutableDefinitionNode = OperationDefinitionNode | FragmentDefinitionNode;

export interface OperationDefinitionNode {
    readonly kind: Kind.OPERATION_DEFINITION;
    readonly loc?: Location;
    readonly operation: OperationTypeNode;
    readonly variableDefinitions?: ReadonlyArray<VariableDefinitionNode>;
    readonly directives?: ReadonlyArray<DirectiveNode>;
    readonly selectionSet: SelectionSetNode;
}

enum OperationTypeNode {
    QUERY = "query",
    MUTATION = "mutation",
    SUBSCRIPTION = "subscription",
}

export { OperationTypeNode };

export interface VariableDefinitionNode {
    readonly kind: Kind.VARIABLE_DEFINITION;
    readonly loc?: Location;
    readonly variable: VariableNode;
    readonly type: TypeNode;
    readonly defaultValue?: ConstValueNode;
    readonly directives?: ReadonlyArray<ConstDirectiveNode>;
}

export interface VariableNode {
    readonly kind: Kind.VARIABLE;
    readonly loc?: Location;
    readonly name: NameNode;
}

export interface SelectionSetNode {
    kind: Kind.SELECTION_SET;
    loc?: Location;
    selections: ReadonlyArray<SelectionNode>;
}

export type SelectionNode = FieldNode | FragmentSpreadNode | InlineFragmentNode;

export interface FieldNode {
    readonly kind: Kind.FIELD;
    readonly loc?: Location;
    readonly alias?: NameNode;
    readonly named: NameNode;
    readonly arguments?: ReadonlyArray<ArgumentNode>;
    readonly directives?: ReadonlyArray<DirectiveNode>;
    readonly selectionSet?: SelectionSetNode;
}

export interface ArgumentNode {
    readonly kind: Kind.ARGUMENT;
    readonly loc?: Location;
    readonly name: NameNode;
    readonly value: ValueNode;
}

export interface ConstArgumentNode {
    readonly kind: Kind.ARGUMENT;
    readonly loc?: Location;
    readonly name: NameNode;
    readonly value: ConstValueNode;
}

/**
 * Fragments
 */

export interface FragmentSpreadNode {
    readonly kind: Kind.FRAGMENT_SPREAD;
    readonly loc?: Location;
    readonly name: NameNode;
    readonly directives?: ReadonlyArray<DirectiveNode>;
}

export interface InlineFragmentNode {
    readonly kind: Kind.INLINE_FRAGMENT;
    readonly loc?: Location;
    readonly typeCondition?: NamedTypeNode;
    readonly directives?: ReadonlyArray<DirectiveNode>;
    readonly selectionSet?: SelectionSetNode;
}
