/**
 * Image imports resolve through the rspack `asset/resource` rule and hand the
 * module a URL string. No ostrov package imported an image before this one, so
 * these declarations have no precedent to copy.
 */

declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.webp" {
  const url: string;
  export default url;
}

declare module "*.svg" {
  const url: string;
  export default url;
}
