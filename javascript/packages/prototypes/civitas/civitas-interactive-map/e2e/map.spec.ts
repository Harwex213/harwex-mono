import { expect, test } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

// Black-box screenshot tests: mouse, keyboard, text and ARIA labels only,
// so that a refactor behind the map does not break them.

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

async function openMap(page: Page, world: "fixture" | "empty"): Promise<void> {
  await page.goto(world === "empty" ? "/?world=empty" : "/");
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
