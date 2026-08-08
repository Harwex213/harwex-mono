/**
 * Shape of the design-config schema.
 *
 * The schema is the single source of truth: the editor UI is generated from it,
 * the values file is validated against it, and the exported config type is
 * derived from it. Adding a field here and in `schema.ts` is the only edit
 * needed to make a new knob appear everywhere.
 *
 * Everything in this file is type-only, so `schema.ts` can be loaded by Node
 * (via type stripping) with no runtime import to resolve.
 */

/** One choice of an `enum` field. */
type EnumOption = {
  value: string;
  label: string;
};

type FieldBase = {
  /** Human label shown in the editor. */
  label: string;
  /** One line explaining what the value does. */
  description: string;
};

/** A real number. `int` is the same thing restricted to whole numbers. */
type NumberField = FieldBase & {
  type: "number" | "int";
  default: number;
  min: number;
  max: number;
  /** Slider granularity. Defaults to 1 for `int` and to 0.01 for `number`. */
  step?: number;
};

type BooleanField = FieldBase & {
  type: "boolean";
  default: boolean;
};

/** An `#rrggbb` colour. Anything else is rejected by validation. */
type ColorField = FieldBase & {
  type: "color";
  default: string;
};

type StringField = FieldBase & {
  type: "string";
  default: string;
  maxLength?: number;
};

type EnumField = FieldBase & {
  type: "enum";
  default: string;
  options: readonly EnumOption[];
};

type Field = NumberField | BooleanField | ColorField | StringField | EnumField;

type FieldGroup = {
  label: string;
  description: string;
  fields: Record<string, Field>;
};

/** Every value a field can hold. */
type ConfigValue = number | boolean | string;

/**
 * One entity of a collection group — a named instance of the group's field
 * template. `overrides` replaces template defaults for this entity only; a key
 * missing from the template is a schema bug and throws while defaults are built.
 */
type EntityDescriptor = {
  label: string;
  description: string;
  overrides?: Record<string, ConfigValue>;
};

/**
 * A group of many same-shaped entities: one field template plus the list of
 * entities that fill it. Buildings, units and enemies are declared this way, so
 * a new entity is one entry here and nothing else.
 */
type CollectionGroup = {
  label: string;
  description: string;
  /** Word for one entity, shown above the list in the editor. */
  entityLabel: string;
  fields: Record<string, Field>;
  entities: Record<string, EntityDescriptor>;
};

/** Either kind of group. A group with `entities` is a collection. */
type Group = FieldGroup | CollectionGroup;

type Schema = Record<string, Group>;

/** Runtime type of one field, read off its literal schema entry. */
type FieldValue<F> = F extends { type: "boolean" }
  ? boolean
  : F extends { type: "enum"; options: readonly { value: infer V }[] }
    ? V
    : F extends { type: "color" | "string" }
      ? string
      : number;

/** Runtime type of one entity: the group's field template, filled in. */
type EntityValues<F> = { [K in keyof F]: FieldValue<F[K]> };

/**
 * Turns a literal schema into the nested values type the game consumes. A plain
 * group becomes `group.field`, a collection becomes `group.entityId.field`.
 */
type ConfigOf<S> = {
  [G in keyof S]: S[G] extends { entities: infer E; fields: infer F }
    ? { [Id in keyof E]: EntityValues<F> }
    : S[G] extends { fields: infer F }
      ? EntityValues<F>
      : never;
};

type ValidationIssue = {
  /** `group`, `group.field`, `group.entityId` or `group.entityId.field`. */
  path: string;
  message: string;
};

type ValidationResult<T> =
  | {
      ok: true;
      value: T;
    }
  | {
      ok: false;
      issues: ValidationIssue[];
    };

export type {
  BooleanField,
  CollectionGroup,
  ColorField,
  ConfigOf,
  ConfigValue,
  EntityDescriptor,
  EntityValues,
  EnumField,
  EnumOption,
  Field,
  FieldGroup,
  FieldValue,
  Group,
  NumberField,
  Schema,
  StringField,
  ValidationIssue,
  ValidationResult,
};
