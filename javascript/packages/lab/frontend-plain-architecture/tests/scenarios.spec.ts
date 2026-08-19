import { expect, test } from "@playwright/test";
import { SCENARIO_NAMES } from "../src/testing/scenario-names";
import { openScenario } from "./helpers";

// One baseline per scenario. The whole body of a test is "open the state, shoot
// it" — no clicking a path to get there, no network stubbing, no waiting on
// animation. The layering is what makes that possible: the harness builds a
// store, hands it to the registry, and the scenario drives the registry.

test.describe("lobby scenarios", () => {
  for (const scenario of SCENARIO_NAMES) {
    test(scenario, async ({ page }) => {
      await openScenario(page, scenario);
      await expect(page).toHaveScreenshot(`${scenario}.png`);
    });
  }
});

test("a domain call through the registry re-renders the UI", async ({ page }) => {
  await openScenario(page, "lobby-default");
  // No clicking: the store and the registry are reachable from the harness, so
  // the ui → registry → domain → store → ui loop can be entered at any point.
  await page.evaluate(() => {
    window.harness?.registry.setCategory("baccarat");
    window.harness?.registry.setSort("min-bet");
  });
  await expect(page.getByTestId("result-count")).toHaveText("3 tables");
  await expect(page).toHaveScreenshot("registry-driven-baccarat.png");
});

test("an unknown scenario name fails loudly", async ({ page }) => {
  await page.goto("/harness.html?scenario=does-not-exist");
  await expect(page.locator("html")).toHaveAttribute("data-harness-error", "unknown-scenario");
  await expect(page.locator(".lc-harness-error")).toContainText("Unknown scenario");
});
