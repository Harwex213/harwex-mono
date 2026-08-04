import { signal } from "@preact/signals-react";

type Theme = "light" | "dark";

const STORAGE_KEY = "faenwald-v2-theme";

const theme = signal<Theme>(readStored() ?? preferred());

// Applied on import rather than from an effect, so the palette is already right
// on React's first paint and the app never flashes the wrong theme.
syncDocument();

function readStored(): Theme | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (stored === "light" || stored === "dark") {
    return stored;
  }
  return null;
}

function preferred(): Theme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
}

// The uikit keys its whole palette off a `dark` class on the root element, so
// that class — not the signal — is what every `--uk-*` token reads.
function syncDocument(): void {
  document.documentElement.classList.toggle("dark", theme.value === "dark");
}

function setTheme(next: Theme): void {
  theme.value = next;
  syncDocument();
  // Survives the reloads a prototype goes through, so the switch does not have
  // to be flipped again after every edit.
  localStorage.setItem(STORAGE_KEY, next);
}

function toggleTheme(): void {
  setTheme(theme.value === "dark" ? "light" : "dark");
}

export { setTheme, theme, toggleTheme };
export type { Theme };
