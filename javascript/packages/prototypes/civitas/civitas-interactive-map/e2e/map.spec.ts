import {
  expect,
  test,
  type Locator,
  type Page,
} from "@playwright/test";
import {
  createEmptyCountries,
  createEmptyCountryInfo,
  createFixtureCountries,
  createFixtureCountryInfo,
} from "./fixture";

// Black-box screenshot tests: mouse, keyboard, text and ARIA labels only,
// so that a refactor behind the map does not break them.
// The countries come from a mocked `assets/countries.json` and
// `assets/countries-info.json`. The other assets are real.

const VIEWPORT = { width: 1400, height: 900 };
const MAP = { width: 3653, height: 2855 };

// The fitted view: the whole map, centred, at the largest scale that fits.
const FIT_SCALE = Math.min(VIEWPORT.width / MAP.width, VIEWPORT.height / MAP.height);
const FIT_X = (VIEWPORT.width - MAP.width * FIT_SCALE) / 2;
const FIT_Y = (VIEWPORT.height - MAP.height * FIT_SCALE) / 2;

// A wheel step of `deltaY` pixels zooms by 1.0015 ** -deltaY. 462 px is about 2x.
const ZOOM_2X = -462;

// Map points from the fixture.
const AURELIA_CENTER = { x: 1466, y: 1095 }; // province 689, inside Aurelia
const BOREALIS_CENTER = { x: 2727, y: 770 }; // province 351, inside Borealis
const FREE_PROVINCE = { x: 1771, y: 1099 }; // province 674, east of Aurelia, unassigned

// Over the country panel header, off the map, so no province keeps a hover fill.
const PARK = { x: 160, y: 22 };

type Point = { x: number; y: number };

function toScreen(point: Point): Point {
  return {
    x: Math.round(FIT_X + point.x * FIT_SCALE),
    y: Math.round(FIT_Y + point.y * FIT_SCALE),
  };
}

async function nextFrames(page: Page): Promise<void> {
  await page.evaluate(() => {
    return new Promise<void>((resolve) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          resolve();
        });
      });
    });
  });
}

async function openMap(page: Page, world: "fixture" | "empty" | object): Promise<void> {
  const body =
    world === "empty" ? createEmptyCountries() : world === "fixture" ? createFixtureCountries() : world;
  const info = world === "empty" ? createEmptyCountryInfo() : createFixtureCountryInfo();
  await page.route("**/assets/countries.json", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(body) });
  });
  await page.route("**/assets/countries-info.json", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(info) });
  });
  await page.goto("/");
  await page.waitForFunction(() => {
    return window.__civitasE2E !== undefined && window.__civitasE2E.ready();
  });
  await nextFrames(page);
}

// Moves the pointer off the map so no province shows a hover fill.
async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(PARK.x, PARK.y);
  await nextFrames(page);
}

async function zoomAt(page: Page, at: Point, deltaY: number): Promise<void> {
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, deltaY);
  await nextFrames(page);
}

// Masks the debug HUD (live timings), found by its `segs` row.
function hudMask(page: Page): Locator[] {
  return [page.locator("span", { hasText: /^segs/ }).locator("xpath=..")];
}

async function expectScreen(page: Page, name: string): Promise<void> {
  await expect(page).toHaveScreenshot(name, { mask: hudMask(page) });
}

declare global {
  interface Window {
    __civitasE2E?: { ready(): boolean };
  }
}

test("the map loads and shows the province borders", async ({ page }) => {
  await openMap(page, "empty");
  await parkMouse(page);
  await expectScreen(page, "map-loaded.png");
});

test("after zooming in, the map and the borders are shown", async ({ page }) => {
  await openMap(page, "empty");
  await zoomAt(page, toScreen(AURELIA_CENTER), ZOOM_2X * 2);
  await parkMouse(page);
  await expectScreen(page, "map-zoomed-in.png");
});

test("countries are drawn with tint, borders and labels", async ({ page }) => {
  await openMap(page, "fixture");
  await parkMouse(page);
  await expectScreen(page, "countries.png");
});

test("a country label grows on zoom in and shrinks on zoom out", async ({ page }) => {
  await openMap(page, "fixture");
  const at = toScreen(AURELIA_CENTER);
  await zoomAt(page, at, ZOOM_2X * 2);
  await parkMouse(page);
  await expectScreen(page, "label-zoomed-in.png");

  await zoomAt(page, at, -ZOOM_2X);
  await parkMouse(page);
  await expectScreen(page, "label-zoomed-out.png");
});

test("a left click selects a province", async ({ page }) => {
  await openMap(page, "fixture");
  const at = toScreen(FREE_PROVINCE);
  await zoomAt(page, at, ZOOM_2X * 2);
  await page.mouse.click(at.x, at.y);
  await parkMouse(page);
  await expect(page.getByLabel("selected country")).toContainText("Province 674");
  await expectScreen(page, "province-selected.png");
});

test("a right click selects a country", async ({ page }) => {
  await openMap(page, "fixture");
  const at = toScreen(BOREALIS_CENTER);
  await page.mouse.click(at.x, at.y, { button: "right" });
  await parkMouse(page);
  await expect(page.getByLabel("selected country")).toContainText("Borealis");
  await expectScreen(page, "country-selected.png");
});

test("a row of the country list selects its country", async ({ page }) => {
  await openMap(page, "fixture");
  await page.getByText("Calderra", { exact: true }).click();
  await parkMouse(page);
  await expect(page.getByLabel("selected country")).toContainText("Calderra");
  await expectScreen(page, "country-row-selected.png");
});

test("a damaged countries file keeps the good countries and shows what was dropped", async ({ page }) => {
  const damaged = createFixtureCountries();
  const broken = [...damaged.countries, { id: 1, name: "Duplicate", colorHex: "#000000", provinceIds: [] }];
  await openMap(page, { ...damaged, countries: broken });
  await parkMouse(page);
  await expect(page.getByText("countries.json: dropped 1 malformed countries")).toBeVisible();
  await expectScreen(page, "countries-repaired.png");

  await page.getByRole("button", { name: "dismiss" }).click();
  await expect(page.getByText("countries.json:", { exact: false })).toHaveCount(0);
});

function countrySheet(page: Page): Locator {
  return page.getByLabel("country details");
}

test("the country sheet shows the form of the selected country", async ({ page }) => {
  await openMap(page, "fixture");
  await page.getByText("Aurelia", { exact: true }).click();
  await parkMouse(page);
  await expect(countrySheet(page)).toContainText("Столица: Aurum");
  await expect(countrySheet(page).getByRole("tab", { name: "Анкета" })).toHaveAttribute("aria-selected", "true");
  await expect(countrySheet(page)).toContainText("Guild republic");
  await expectScreen(page, "country-sheet-profile.png");

  await countrySheet(page).getByRole("button", { name: "ещё" }).click();
  await expect(countrySheet(page).getByRole("button", { name: "свернуть" })).toBeVisible();
});

test("the economy tab shows the calculator result of the year", async ({ page }) => {
  await openMap(page, "fixture");
  await page.getByText("Aurelia", { exact: true }).click();
  await countrySheet(page).getByRole("tab", { name: "Экономика" }).click();
  await parkMouse(page);
  await expect(countrySheet(page)).toContainText("Экономика · 1912");
  await expect(countrySheet(page)).toContainText("Clockwork");
  await expectScreen(page, "country-sheet-economy.png");
});

test("a country without info says so, and the close button clears the selection", async ({ page }) => {
  await openMap(page, "fixture");
  await page.getByText("Borealis", { exact: true }).click();
  await countrySheet(page).getByRole("tab", { name: "Экономика" }).click();
  await expect(countrySheet(page)).toContainText("Экономика ещё не заполнена");

  await page.getByText("Calderra", { exact: true }).click();
  await countrySheet(page).getByRole("tab", { name: "Анкета" }).click();
  await expect(countrySheet(page)).toContainText("Анкета не заполнена");

  await countrySheet(page).getByRole("button", { name: "close" }).click();
  await expect(countrySheet(page)).toHaveCount(0);
  await expect(page.getByLabel("selected country")).toContainText("no selection");
});
