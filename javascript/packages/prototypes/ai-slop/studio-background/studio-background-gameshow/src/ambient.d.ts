declare module "*.png" {
  const url: string;
  export default url;
}

declare module "*.jpg" {
  const url: string;
  export default url;
}

declare module "*.glsl" {
  const source: string;
  export default source;
}

declare module "*.css" {
  const classes: Record<string, string>;
  export default classes;
}

declare module "*.vert" {
  const source: string;
  export default source;
}

declare module "*.frag" {
  const source: string;
  export default source;
}
