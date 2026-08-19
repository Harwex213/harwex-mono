import type { Page } from "@playwright/test";
import type { ScenarioName } from "../src/testing/scenario-names";

// `harness.html` carries `data-screenshot` in its markup already; the app page
// gets it here, so both pages freeze the same animations.
async function freezeMotion(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.documentElement.dataset.screenshot = "true";
  });
}

async function waitForReady(page: Page): Promise<void> {
  await page.waitForSelector("html[data-app-ready='true']", { state: "attached" });
}

// Opens the UI in a known state: the store is seeded and the scenario's registry
// calls have already run before React mounted.
async function openScenario(page: Page, scenario: ScenarioName): Promise<void> {
  await page.goto(`/harness.html?scenario=${scenario}`);
  await waitForReady(page);
  await freezeMotion(page);
}

// Opens the app a human would use, with no scenario applied.
async function openApp(page: Page): Promise<void> {
  await page.goto("/");
  await waitForReady(page);
  await freezeMotion(page);
}

export { freezeMotion, openApp, openScenario, waitForReady };
