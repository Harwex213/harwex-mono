import { rspack } from "@rspack/core";
import { devServer, moduleRules, resolve } from "../rspack.shared.mjs";

export default {
  entry: {
    main: "./src/main.tsx",
  },
  resolve,
  module: moduleRules,
  plugins: [
    new rspack.HtmlRspackPlugin({
      template: "./index.html",
    }),
  ],
  devServer: {
    ...devServer,
    // The lobby pushes over SSE, and gzip buffers: compressed, the events arrive in
    // a lump when the stream ends, which is the opposite of the point.
    compress: false,
    // The client calls the backend with relative paths, so dev has to look like the
    // deploy: one origin, /api routed to the lobby server. Proxying instead of
    // pointing the client at localhost:8787 keeps CORS out of the picture entirely
    // and leaves nothing to configure per environment.
    proxy: [
      {
        context: ["/api"],
        target: `http://localhost:${process.env.BACKEND_PORT ?? 8787}`,
      },
    ],
  },
};
