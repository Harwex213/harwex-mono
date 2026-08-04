/// <reference types="@rspack/core/module" />

declare module "*.module.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.css";

// Replaced by rspack at build time. Used to compile out the dev-only sample map
// button.
declare const process: {
  env: {
    NODE_ENV: string;
  };
};
