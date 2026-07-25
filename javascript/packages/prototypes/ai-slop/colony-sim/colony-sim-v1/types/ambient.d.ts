// Module shapes the bundler provides. They live at the group level rather than in
// one package because tsc typechecks its dependencies' sources too: an app that
// imports game-render has to understand `*.png` just as much as game-render does.
// The rules that give these imports meaning are in rspack.shared.mjs.

declare module "*.png" {
  const src: string;
  export default src;
}

declare module "*.css";
