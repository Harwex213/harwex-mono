import { domainFunctions } from "../domain";
import type { DomainFunction } from "../domain";
import type { Registry, RegistryDeps } from "./types";

function createRegistry(deps: RegistryDeps): Registry {
  const entries = Object.entries(domainFunctions).map(([name, domainFunction]) => {
    const bound = (...input: never[]) => {
      (domainFunction as DomainFunction)(deps.store, ...input);
    };
    return [name, bound];
  });
  return Object.freeze(Object.fromEntries(entries)) as Registry;
}

export { createRegistry };
