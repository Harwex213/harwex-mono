import { defineConfig, devices } from "@playwright/test";

const BASE_URL = "http://127.0.0.1:8130";

export default defineConfig({
  testDir: "./tests",
  // Baselines are grouped per platform, because a screenshot rendered on macOS
  // does not match one rendered on Linux.
  snapshotPathTemplate: "{testDir}/__screenshots__/{platform}/{testFileName}/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? "list" : [["list"], ["html", { open: "never" }]],
  use: {
    baseURL: BASE_URL,
    colorScheme: "dark",
    // Everything below pins what would otherwise be read from the machine and
    // shift the pixels: motion, locale-formatted numbers, dates. `reducedMotion`
    // is not a top-level `use` option, hence `contextOptions`.
    contextOptions: {
      reducedMotion: "reduce",
    },
    locale: "en-GB",
    timezoneId: "UTC",
    deviceScaleFactor: 1,
  },
  expect: {
    toHaveScreenshot: {
      animations: "disabled",
      caret: "hide",
      scale: "css",
      maxDiffPixelRatio: 0.002,
    },
  },
  projects: [
    {
      name: "chromium",
      use: {
        ...devices["Desktop Chrome"],
        viewport: {
          width: 1440,
          height: 900,
        },
        deviceScaleFactor: 1,
      },
    },
  ],
  webServer: {
    command: "yarn rspack serve",
    url: `${BASE_URL}/harness.html?scenario=lobby-default`,
    reuseExistingServer: !process.env.CI,
    timeout: 120_000,
  },
});
