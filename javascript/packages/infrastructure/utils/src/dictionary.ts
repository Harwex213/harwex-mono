type TDictionary<Key extends (string | number | symbol)> = { [K in Key]: K };

/**
 * One instance of Proxy is suitable because dictionaries are always used only like "Dictionary.Property"
 * and never compared to each other (one instance of Proxy leads to all dictionaries equality)
 */
const proxy = new Proxy({}, { get: (_, p) => p });

const Dictionary = function() {
  return proxy;
} as unknown as { new<Key extends string | number | symbol>(): TDictionary<Key>; };

export { Dictionary };
