// `import.meta.webpackContext` is provided by rspack at build time.
interface ImportMeta {
  webpackContext(
    directory: string,
    options?: {
      recursive?: boolean;
      regExp?: RegExp;
    }
  ): {
    keys(): string[];
    (key: string): unknown;
  };
}
