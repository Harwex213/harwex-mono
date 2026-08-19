import { expect, test } from "@playwright/test";
import { openApp } from "./helpers";

// The same UI, driven through real clicks on the real app entry. These tests
// prove the loop the scenarios shortcut: a click calls a registry function, the
// domain function mutates a signal, and the computed signals repaint the page.

test("filter, open, join and leave a table", async ({ page }) => {
  await openApp(page);
  await expect(page.getByTestId("result-count")).toHaveText("14 tables");
  await expect(page).toHaveScreenshot("app-01-fresh-lobby.png");

  await page.getByTestId("category-blackjack").click();
  await expect(page.getByTestId("result-count")).toHaveText("4 tables");
  await expect(page).toHaveScreenshot("app-02-blackjack-tab.png");

  await page.getByTestId("open-blackjack-vip-3").click();
  await expect(page.getByTestId("details-name")).toHaveText("Blackjack VIP 3");
  await expect(page.getByTestId("details-free-seats")).toHaveText("3 / 7");
  await expect(page).toHaveScreenshot("app-03-table-details.png");

  await page.getByTestId("join").click();
  // The seat is taken and the min bet is reserved: two signals, one click.
  await expect(page.getByTestId("balance")).toHaveText("€200");
  await expect(page.getByTestId("details-free-seats")).toHaveText("2 / 7");
  await expect(page.getByTestId("seated-badge")).toContainText("Blackjack VIP 3");
  await expect(page).toHaveScreenshot("app-04-seated.png");

  await page.getByTestId("leave").click();
  await expect(page.getByTestId("balance")).toHaveText("€250");
  await expect(page.getByTestId("details-free-seats")).toHaveText("3 / 7");
  await expect(page).toHaveScreenshot("app-05-left-table.png");
});

test("favourites are kept while filters change", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("favourite-crazy-time").click();
  await page.getByTestId("favourite-turkish-roulette").click();
  await page.getByTestId("toggle-favourites").click();
  await expect(page.getByTestId("result-count")).toHaveText("2 tables");
  await expect(page).toHaveScreenshot("app-06-favourites-only.png");
});

test("a search with no match offers a reset", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("search").fill("keno");
  await expect(page.getByTestId("empty-state")).toBeVisible();
  await expect(page).toHaveScreenshot("app-07-no-matches.png");

  await page.getByTestId("empty-reset").click();
  await expect(page.getByTestId("result-count")).toHaveText("14 tables");
});

test("joining a full table is refused and costs nothing", async ({ page }) => {
  await openApp(page);
  await page.getByTestId("open-speed-blackjack-12").click();
  await page.getByTestId("join").click();
  await expect(page.getByTestId("notice-text")).toContainText("full");
  await expect(page.getByTestId("balance")).toHaveText("€250");
  await expect(page.getByTestId("seated-badge")).toHaveCount(0);
  await expect(page).toHaveScreenshot("app-08-join-refused.png");
});
