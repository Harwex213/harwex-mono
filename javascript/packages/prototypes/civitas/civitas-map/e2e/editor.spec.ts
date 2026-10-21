import { readFile } from "node:fs/promises";
import {
  expect,
  test,
  type Download,
  type Page,
} from "@playwright/test";
import { MAP_HEIGHT, MAP_WIDTH } from "./fixtures/fixture-maps";
import { mockLibrary } from "./mock-library";

// Black-box screenshot tests: the mouse, the keyboard, text and ARIA roles only.
// The backend is mocked at the network level (`mock-library.ts`), so a refactor
// behind the editor does not break these tests.

// The padding `fit` keeps around the map, in CSS pixels.
const FIT_PADDING = 24;

type Point = { x: number; y: number };

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

async function openEditor(page: Page, mock: Parameters<typeof mockLibrary>[1] = { kind: "images" }): Promise<void> {
  await mockLibrary(page, mock);
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Load map…" })).toBeEnabled();
  await nextFrames(page);
}

function libraryDialog(page: Page) {
  return page.getByRole("dialog");
}

async function pickFromLibrary(page: Page, opener: string, name: string): Promise<void> {
  await page.getByRole("button", { name: opener }).click();
  await libraryDialog(page).getByRole("button", { name: new RegExp("^" + name.replace(".", "\\.")) }).click();
  await expect(libraryDialog(page)).toHaveCount(0);
}

async function loadFixtureMap(page: Page): Promise<void> {
  await pickFromLibrary(page, "Load map…", "fixture-map.png");
  await expect(page.getByText(MAP_WIDTH + " × " + MAP_HEIGHT)).toBeVisible();
  await expect(page.getByRole("button", { name: "Load map…" })).toBeEnabled();
  await nextFrames(page);
}

// Off the map, so no brush preview is drawn and the status bar shows no cursor.
async function parkMouse(page: Page): Promise<void> {
  await page.mouse.move(40, 22);
  await nextFrames(page);
}

// Where map pixel `point` sits on the screen while the map is fitted.
async function toScreen(page: Page, point: Point): Promise<Point> {
  const box = await page.locator("main canvas").first().boundingBox();
  if (!box) {
    throw new Error("the map canvas is not on the screen");
  }
  const scale = Math.min(
    (box.width - FIT_PADDING * 2) / MAP_WIDTH,
    (box.height - FIT_PADDING * 2) / MAP_HEIGHT,
  );
  const originX = box.x + (box.width - MAP_WIDTH * scale) / 2;
  const originY = box.y + (box.height - MAP_HEIGHT * scale) / 2;
  return {
    x: originX + (point.x + 0.5) * scale,
    y: originY + (point.y + 0.5) * scale,
  };
}

async function drag(page: Page, from: Point, to: Point, button: "left" | "right"): Promise<void> {
  const start = await toScreen(page, from);
  const end = await toScreen(page, to);
  await page.mouse.move(start.x, start.y);
  await page.mouse.down({ button });
  await page.mouse.move(end.x, end.y, { steps: 12 });
  await page.mouse.up({ button });
  await nextFrames(page);
}

async function readDownload(download: Download): Promise<Buffer> {
  const path = await download.path();
  return readFile(path);
}

test("the editor starts empty", async ({ page }) => {
  await openEditor(page);
  await expect(page.getByText("Load a map image to start")).toBeVisible();
  await expect(page).toHaveScreenshot("empty.png");
});

test("Load map lists the images of the map library", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Load map…" }).click();
  const dialog = libraryDialog(page);
  await expect(dialog.getByRole("heading", { name: "Load map" })).toBeVisible();
  await expect(dialog.getByRole("listitem")).toHaveCount(3);
  await expect(page).toHaveScreenshot("library-map.png");
});

test("an empty map library says so", async ({ page }) => {
  await openEditor(page, { kind: "empty" });
  await page.getByRole("button", { name: "Load map…" }).click();
  await expect(libraryDialog(page).getByText("No images in the map library.")).toBeVisible();
  await expect(page).toHaveScreenshot("library-empty.png");
});

test("a failed map library request shows the error and a retry", async ({ page }) => {
  await openEditor(page, { kind: "failure", status: 500 });
  await page.getByRole("button", { name: "Load map…" }).click();
  const alert = libraryDialog(page).getByRole("alert");
  await expect(alert).toContainText("api/maps responded 500");
  await expect(alert.getByRole("button", { name: "Retry" })).toBeVisible();
  await expect(page).toHaveScreenshot("library-failed.png");
});

test("Escape and the close button close the map library", async ({ page }) => {
  await openEditor(page);
  await page.getByRole("button", { name: "Load map…" }).click();
  await expect(libraryDialog(page)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(libraryDialog(page)).toHaveCount(0);

  await page.getByRole("button", { name: "Load map…" }).click();
  await libraryDialog(page).getByRole("button", { name: "Close" }).click();
  await expect(libraryDialog(page)).toHaveCount(0);
});

test("picking an image opens it as the base map", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await expect(page.getByRole("banner")).toContainText("fixture-map.png");
  await parkMouse(page);
  await expect(page).toHaveScreenshot("map-loaded.png");
});

test("Load provinces loads the PNG and the manifest beside it", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await page.getByRole("button", { name: "Load provinces…" }).click();
  await expect(libraryDialog(page).getByRole("heading", { name: "Load provinces" })).toBeVisible();
  await expect(page).toHaveScreenshot("library-provinces.png");

  await libraryDialog(page).getByRole("button", { name: /^fixture-provinces\.png/ }).click();
  await expect(page.getByRole("status")).toContainText("Loaded 3 provinces from the manifest.");
  const rows = page.getByRole("listitem");
  await expect(rows).toHaveCount(3);
  // A row holds the colour input first and the name field last; both are textboxes.
  await expect(rows.nth(0).getByRole("textbox").last()).toHaveValue("Northmark");
  await expect(rows.nth(2).getByRole("textbox").last()).toHaveValue("Southreach");
  await parkMouse(page);
  await expect(page).toHaveScreenshot("provinces-loaded.png");

  // `V` hides the provinces layer.
  await page.keyboard.press("v");
  await nextFrames(page);
  await expect(page).toHaveScreenshot("provinces-layer-hidden.png");
});

test("a provinces image of another size is refused", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await pickFromLibrary(page, "Load provinces…", "wrong-size.png");
  await expect(page.getByRole("alert")).toContainText("the province image is 100×80, the map is 360×240");
  await parkMouse(page);
  await expect(page).toHaveScreenshot("provinces-wrong-size.png");
});

test("Detect borders fills the layer from the borders drawn on the map", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await page.getByRole("button", { name: "Detect borders" }).click();
  await expect(page.getByRole("status")).toContainText(
    "Detected 5 land provinces across 2 landmasses, largest 8,747 px, median 7,789 px.",
  );
  await expect(page.getByRole("button", { name: "Detect borders" })).toBeEnabled();
  await parkMouse(page);
  await expect(page).toHaveScreenshot("borders-detected.png");
});

test("the brush paints the active province and the right button erases", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await drag(page, { x: 90, y: 90 }, { x: 250, y: 150 }, "left");
  await drag(page, { x: 150, y: 140 }, { x: 200, y: 100 }, "right");
  await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
  await parkMouse(page);
  await expect(page).toHaveScreenshot("brush-stroke.png");
});

test("the bucket fills inside an outline, Undo takes the fill back, the picker reselects", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  const corners = [{ x: 60, y: 60 }, { x: 300, y: 60 }, { x: 300, y: 200 }, { x: 60, y: 200 }];
  for (let index = 0; index < corners.length; index += 1) {
    await drag(page, corners[index], corners[(index + 1) % corners.length], "left");
  }

  await page.keyboard.press("g");
  const inside = await toScreen(page, { x: 120, y: 120 });
  await page.mouse.click(inside.x, inside.y);
  await nextFrames(page);
  await parkMouse(page);
  await expect(page).toHaveScreenshot("bucket-filled.png");

  await page.getByRole("button", { name: "Undo" }).click();
  await nextFrames(page);
  await parkMouse(page);
  await expect(page).toHaveScreenshot("bucket-undone.png");

  // A new province becomes active; the picker makes the painted one active again.
  await page.keyboard.press("n");
  await expect(page.getByRole("contentinfo")).toContainText(/painting:\s*Province 2/);
  await page.keyboard.press("i");
  const onRing = await toScreen(page, { x: 60, y: 120 });
  await page.mouse.click(onRing.x, onRing.y);
  await expect(page.getByRole("contentinfo")).toContainText(/painting:\s*Province 1/);
});

test("the wheel zooms in at the cursor", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  const at = await toScreen(page, { x: 170, y: 122 });
  await page.mouse.move(at.x, at.y);
  // A wheel step of `deltaY` pixels zooms by 1.0015 ** -deltaY. -462 px is about 2x.
  await page.mouse.wheel(0, -462);
  await nextFrames(page);
  await parkMouse(page);
  await expect(page).toHaveScreenshot("zoomed-in.png");
});

test("Export downloads the provinces PNG and its manifest", async ({ page }) => {
  await openEditor(page);
  await loadFixtureMap(page);
  await drag(page, { x: 90, y: 90 }, { x: 250, y: 150 }, "left");

  const downloads: Download[] = [];
  page.on("download", (download) => {
    downloads.push(download);
  });
  await page.getByRole("button", { name: "Export PNG + JSON" }).click();
  await expect.poll(() => {
    return downloads.length;
  }).toBe(2);

  const names = downloads.map((download) => {
    return download.suggestedFilename();
  }).sort();
  expect(names).toEqual(["fixture-map-provinces.json", "fixture-map-provinces.png"]);

  const manifestDownload = downloads.find((download) => {
    return download.suggestedFilename().endsWith(".json");
  });
  const manifest = JSON.parse((await readDownload(manifestDownload!)).toString("utf8"));
  expect(manifest.format).toBe("civitas.province-map");
  expect(manifest.map).toEqual({ source: "fixture-map.png", width: MAP_WIDTH, height: MAP_HEIGHT });
  expect(manifest.provinces).toHaveLength(1);
  expect(manifest.provinces[0].name).toBe("Province 1");
  expect(manifest.provinces[0].pixelCount).toBeGreaterThan(0);
});
