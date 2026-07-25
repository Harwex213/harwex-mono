/// <reference types="@rspack/core/module" />

declare module "*.module.css" {
  const classes: Record<string, string>
  export default classes
}

declare module "*.css"
