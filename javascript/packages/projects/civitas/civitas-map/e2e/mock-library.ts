import type { Page } from "@playwright/test";
import { createFixtureFiles } from "./fixtures/fixture-maps";

// Mocks the backend at the network level: `GET api/maps` and the image files
// under `assets/maps/`. The app runs unchanged, so these tests do not depend on
// how the app talks to the server inside.

type LibraryMock =
  | { kind: "images" }
  | { kind: "empty" }
  | { kind: "failure"; status: number };

const files = createFixtureFiles();

// The list the default mock serves. `fixture-provinces.png` has its manifest and
// its countries file beside it.
function listedImages(): unknown[] {
  return [
    { name: "fixture-map.png", manifestUrl: null, countriesUrl: null },
    {
      name: "fixture-provinces.png",
      manifestUrl: "assets/maps/fixture-provinces.json",
      countriesUrl: "assets/maps/fixture-provinces.countries.json",
    },
    { name: "wrong-size.png", manifestUrl: null, countriesUrl: null },
  ].map((entry) => {
    const file = files.get(entry.name);
    if (!file) {
      throw new Error("no fixture named " + entry.name);
    }
    return {
      name: entry.name,
      url: "assets/maps/" + entry.name,
      bytes: file.body.length,
      manifestUrl: entry.manifestUrl,
      countriesUrl: entry.countriesUrl,
    };
  });
}

async function mockLibrary(page: Page, mock: LibraryMock = { kind: "images" }): Promise<void> {
  await page.route("**/api/maps", async (route) => {
    if (mock.kind === "failure") {
      await route.fulfill({
        status: mock.status,
        contentType: "application/json",
        body: JSON.stringify({ error: "the library is down" }),
      });
      return;
    }
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ images: mock.kind === "empty" ? [] : listedImages() }),
    });
  });

  await page.route("**/assets/maps/*", async (route) => {
    const name = decodeURIComponent(new URL(route.request().url()).pathname.split("/").pop() ?? "");
    const file = files.get(name);
    if (!file) {
      await route.fulfill({ status: 404, body: "" });
      return;
    }
    await route.fulfill({ status: 200, contentType: file.contentType, body: file.body });
  });
}

export { mockLibrary, type LibraryMock };
