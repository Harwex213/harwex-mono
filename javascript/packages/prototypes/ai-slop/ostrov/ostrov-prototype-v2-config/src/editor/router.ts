import { signal } from "@preact/signals-react";
import { groupEntries } from "../schema";

/**
 * Hash routing over the schema groups. One page per group, no dependency: the
 * hash is the whole state, so a deep link, the back button and a nav click all
 * go through the same `hashchange`.
 */

const PAGES: readonly string[] = groupEntries().map(([name]) => name);

const DEFAULT_PAGE = PAGES[0]!;

/** Reads `#/camera` as `camera`. An unknown or empty hash falls back to the first page. */
function pageFromHash(): string {
  const raw = decodeURIComponent(window.location.hash.replace(/^#\/?/, ""));
  if (PAGES.includes(raw)) {
    return raw;
  }
  return DEFAULT_PAGE;
}

const page = signal<string>(DEFAULT_PAGE);

function hrefOf(name: string): string {
  return `#/${name}`;
}

/** Binds the signal to the address bar. Returns the unsubscribe. */
function startRouter(): () => void {
  const sync = (): void => {
    page.value = pageFromHash();
  };
  sync();
  window.addEventListener("hashchange", sync);
  return () => {
    window.removeEventListener("hashchange", sync);
  };
}

export { PAGES, hrefOf, page, startRouter };
