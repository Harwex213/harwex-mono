import { rspack } from "@rspack/core";
import { createSceneServer } from "./scripts/sceneDevServer.mjs";
import { sceneDir } from "./scripts/sceneStore.mjs";

// The scene lives in versions under src/scene/versions/ (docs/scene-format.md). The page loads them with fetch,
// so they are not modules: a save never rebuilds the bundle or reloads the page.
// `SCENE_DIR=/path/copy yarn dev` serves and saves a copy of the versions folder instead, so a test never touches
// the real files. `yarn build` copies the versions into dist/scene/versions/: the built page opens them read-only.
export default (env = {}) => ({
  entry: {
    main: "./src/main.tsx",
  },
  output: {
    filename: "[name].[contenthash].js",
    cssFilename: "[name].[contenthash].css",
    publicPath: "",
    clean: true,
  },
  resolve: {
    extensions: ["...", ".ts", ".tsx"],
  },
  module: {
    generator: {
      "css/auto": {
        localIdentName: "[local]_[hash:6]",
      },
    },
    parser: {
      "css/auto": {
        namedExports: false,
      },
    },
    rules: [
      {
        test: /\.tsx?$/,
        loader: "builtin:swc-loader",
        options: {
          jsc: {
            parser: {
              syntax: "typescript",
              tsx: true,
            },
            transform: {
              react: {
                runtime: "automatic",
              },
            },
          },
        },
        type: "javascript/auto",
      },
      {
        test: /\.css$/i,
        type: "css/auto",
      },
      {
        test: /\.(png|jpe?g|webp)$/i,
        type: "asset/resource",
      },
      {
        test: /\.(glsl|vert|frag)$/i,
        type: "asset/source",
      },
    ],
  },
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
    ...(env.RSPACK_SERVE
      ? []
      : [
          new rspack.CopyRspackPlugin({
            patterns: [{ from: sceneDir(), to: "scene/versions", globOptions: { ignore: ["**/.*", "**/*.tmp"] } }],
          }),
        ]),
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS: a fixed port lets a forgotten server answer with a stale bundle.
    port: 0,
    setupMiddlewares: (middlewares) => {
      middlewares.unshift(...createSceneServer());
      return middlewares;
    },
  },
});
