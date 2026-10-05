import { writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { rspack } from "@rspack/core";

const OVERRIDES_FILE = fileURLToPath(new URL("./src/scene/scene-overrides.json", import.meta.url));

// Dev-only endpoint: the editor's Save button posts the scene overrides here.
function saveOverrides(request, response, next) {
  if (request.method !== "POST") {
    next();
    return;
  }
  let body = "";
  request.setEncoding("utf8");
  request.on("data", (chunk) => {
    body += chunk;
  });
  request.on("end", async () => {
    try {
      JSON.parse(body);
      await writeFile(OVERRIDES_FILE, body);
      response.statusCode = 204;
    } catch (error) {
      response.statusCode = 400;
      console.error("[scene] cannot save overrides", error);
    }
    response.end();
  });
}

export default {
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
  ],
  devServer: {
    hot: true,
    // Free port picked by the OS: a fixed port lets a forgotten server answer with a stale bundle.
    port: 0,
    setupMiddlewares: (middlewares) => {
      middlewares.unshift({ name: "scene-overrides", path: "/__scene/overrides", middleware: saveOverrides });
      return middlewares;
    },
  },
};
