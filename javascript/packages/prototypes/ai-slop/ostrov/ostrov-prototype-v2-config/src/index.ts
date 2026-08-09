import rawValues from "../data/config.json";
import type { GameConfig, SchemaGroup } from "./schema";
import {
  BUILDING_CATEGORY_OPTIONS,
  DEFAULTS,
  SCHEMA,
  cloneConfig,
  entityEntries,
  fieldEntries,
  groupEntries,
  parseConfig,
  serializeConfig,
  stepOf,
  validateConfig,
} from "./schema";

/**
 * Library entry of `@hw/ostrov-prototype-v2-config`.
 *
 * The game imports `config` from here instead of holding numbers of its own.
 * Nothing browser- or editor-specific is reachable from this file, so a
 * consumer bundles the schema, the parser and the values, and nothing else.
 */

/**
 * Values from `data/config.json`, checked against the schema at import time. A
 * hand-edited file with a bad value fails here, loudly, instead of quietly
 * drawing something wrong.
 */
const config: GameConfig = parseConfig(rawValues);

export type { GameConfig, SchemaGroup };
export {
  BUILDING_CATEGORY_OPTIONS,
  DEFAULTS,
  SCHEMA,
  cloneConfig,
  config,
  entityEntries,
  fieldEntries,
  groupEntries,
  parseConfig,
  serializeConfig,
  stepOf,
  validateConfig,
};
