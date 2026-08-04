import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import * as path from "path";

/**
 * This file is the swap point.
 *
 * The app imports components from "@ui". "@ui" imports the active kit from
 * "@kit". "@kit" is an alias, and the alias is the only thing that changes when
 * a project moves from one UI kit to another:
 *
 *   yarn dev            -> base-ui adapter
 *   KIT=studio yarn dev -> studio adapter
 *
 * In a real repo you would not use an env var. You would hardcode the one
 * adapter that project uses, and each project would have its own adapter
 * package. The env var exists here so one checkout can show both.
 */
const adapters: Record<string, string> = {
  "base-ui": "./src/adapters/base-ui-kit/index.ts",
  studio: "./src/adapters/studio-kit/index.ts",
};

const kitName = process.env.KIT ?? "base-ui";
const activeAdapter = adapters[kitName];

if (!activeAdapter) {
  const known = Object.keys(adapters).join(", ");
  throw new Error(`Unknown KIT "${kitName}". Known kits: ${known}.`);
}

/**
 * The demo shell imports both adapters so the kit can be flipped live, which
 * means both kits land in the bundle. `HARNESS=off` swaps in a shell that only
 * mounts the provider, the way a real app does. Compare the two `dist/` sizes to
 * confirm the facade does not drag the unused kit along.
 */
const shell =
  process.env.HARNESS === "off" ? "./src/harness/Solo.tsx" : "./src/harness/Harness.tsx";

export default defineConfig({
  plugins: [react()],
  css: {
    modules: {
      localsConvention: "camelCaseOnly",
    },
  },
  resolve: {
    alias: {
      "@ui": path.resolve(__dirname, "./src/ui/index.tsx"),
      "@kit": path.resolve(__dirname, activeAdapter),
      "@shell": path.resolve(__dirname, shell),
    },
  },
});
