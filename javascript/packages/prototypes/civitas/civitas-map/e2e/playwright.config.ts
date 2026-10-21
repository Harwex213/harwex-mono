import { defineConfig } from "@playwright/test";

// A fixed, uncommon port. `reuseExistingServer: false` makes a leftover server
// fail the run instead of serving a stale bundle.
const PORT = 47623;

const config = defineConfig({
  testDir: ".",
  testMatch: "*.spec.ts",
  outputDir: "./dist/test-results",
  snapshotPathTemplate: "{testDir}/{testFileName}-snapshots/{arg}{ext}",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: "list",
  timeout: 60000,
  expect: {
    toHaveScreenshot: {
      maxDiffPixels: 0,
      animations: "disabled",
      caret: "hide",
    },
  },
  use: {
    baseURL: "http://127.0.0.1:" + PORT,
    browserName: "chromium",
    viewport: {
      width: 1400,
      height: 900,
    },
    deviceScaleFactor: 1,
    acceptDownloads: true,
    contextOptions: {
      reducedMotion: "reduce",
    },
  },
  webServer: {
    command: "python3 -m http.server " + PORT + " --bind 127.0.0.1 --directory dist/app",
    url: "http://127.0.0.1:" + PORT + "/",
    reuseExistingServer: false,
    // The request log of `http.server` goes to stderr and would flood the report.
    stderr: "ignore",
    timeout: 20000,
  },
});

export default config;
