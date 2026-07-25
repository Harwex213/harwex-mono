// The bundler turns a CSS import into a side effect; tsc needs to be told it is
// not a module with an API.
declare module "*.css";
