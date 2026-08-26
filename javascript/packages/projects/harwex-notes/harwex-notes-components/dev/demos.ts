import type { TDemo } from "./demo";

type TDemoEntry = TDemo & {
  // Component folder name, used as the URL hash: `#example-button`.
  slug: string;
};

const DEMO_FILE_PATTERN = /\/([^/]+)\/[^/]+\.demo\.tsx$/;

const context = import.meta.webpackContext("../src/components", {
  recursive: true,
  regExp: /\.demo\.tsx$/,
});

const loadDemos = (): readonly TDemoEntry[] => {
  const entries: TDemoEntry[] = [];

  for (const key of context.keys()) {
    const match = DEMO_FILE_PATTERN.exec(key);

    if (!match || !match[1]) {
      continue;
    }

    const module = context(key) as { default: TDemo };

    entries.push({ ...module.default, slug: match[1] });
  }

  return entries.sort((a, b) => a.title.localeCompare(b.title));
};

export { loadDemos };
export type { TDemoEntry };
