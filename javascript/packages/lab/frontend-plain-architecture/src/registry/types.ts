import type { Api } from "../api";
import type { DomainFunctions } from "../domain";
import type { Store } from "../store/types";

// Layer 3: domain registry. It is a plain object: one key per domain function,
// with the store already bound. The UI holds this object and nothing else — it
// cannot import a domain function directly, and it never sees `store` being
// passed as an argument.

type BoundDomainFunction<F> = F extends (store: Store, ...input: infer Input) => void
  ? (...input: Input) => void
  : never;

type Registry = {
  readonly [Name in keyof DomainFunctions]: BoundDomainFunction<DomainFunctions[Name]>;
};

type RegistryDeps = {
  readonly store: Store;
  // Unused until the api layer exists. It is listed here because the registry
  // is the one place that is allowed to know about both sides: it will await an
  // api call and pass the payload to a domain function.
  readonly api: Api;
};

export type { BoundDomainFunction, Registry, RegistryDeps };
