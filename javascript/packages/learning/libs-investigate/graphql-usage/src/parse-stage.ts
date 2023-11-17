/**
 * graphql schema - дефиниция Graphql типов и возможных совершаемых операций. Иными словами описание нашего API
 *
 * graphql/language - пакет, который занимается парсингом string'и, содержащую graphql типы
 *
 * 1) Неужели `parse()` предназначается и для парсинга операции и для парсинга graphql схемы?
 */

import { buildASTSchema, parse } from "graphql";

const invalidTypeSystemDefinitionSource = `
type Character {
    id: String!
    name: String!
}

enum Spawn {
    MORDOR
    MINAS_TIRITH
    EREADOR
}
`;

const validTypeSystemDefinitionSource = `
type Character {
    id: String!
    name: String!
}

enum Spawn {
    MORDOR
    MINAS_TIRITH
    EREADOR
}

type Query {
    spawnToCharacter(id: Spawn): Character
}
`;

const invalidTypeSystemDefinition = parse(invalidTypeSystemDefinitionSource);
const validTypeSystemDefinition = parse(validTypeSystemDefinitionSource);

const invalidSchema = buildASTSchema(invalidTypeSystemDefinition);
const validSchema = buildASTSchema(validTypeSystemDefinition);

const executableDefinitionSource = `
query MyQuery($argSpawn: Spawn) {
  leftComparison: spawnToCharacter(id: $argSpawn) {
    ...comparisonFields
  }
  rightComparison: spawnToCharacter(id: $argSpawn) {
    ...comparisonFields
  }
}

fragment comparisonFields on Character {
  name
}
`;

const executableDefinition = parse(executableDefinitionSource);

export { executableDefinition, invalidSchema, validSchema };
