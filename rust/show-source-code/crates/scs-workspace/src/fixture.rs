//! A small demo monorepo, written to disk for tests (unit tests here, the app's snapshot tests).
//! Its content is fixed, so pictures of it are stable.

use std::path::Path;

/// `(path, content)` pairs of the demo monorepo.
pub fn demo_files() -> Vec<(&'static str, String)> {
    let mut files: Vec<(&'static str, String)> = vec![
        (
            "package.json",
            r#"{ "name": "demo", "private": true, "workspaces": { "packages": ["packages/*", "tools/*"] } }"#.into(),
        ),
        (".yarnrc.yml", "nodeLinker: node-modules\n".into()),
        (
            "packages/web/package.json",
            r#"{ "name": "@fx/web", "types": "src/main.tsx",
  "dependencies": { "@fx/ui": "workspace:*", "@fx/core": "workspace:*", "react": "19.0.0" },
  "devDependencies": { "@fx/config": "workspace:*" } }"#
                .into(),
        ),
        (
            "packages/web/src/main.tsx",
            r#"import { createRoot } from "react-dom/client";
import { Button, Panel } from "@fx/ui";
import { createStore } from "@fx/core";
import { App } from "./App";

const store = createStore({ count: 0 });

createRoot(document.getElementById("root")!).render(
  <Panel title="Demo">
    <App store={store} />
    <Button onClick={() => store.set({ count: 0 })}>Reset</Button>
  </Panel>,
);
"#
            .into(),
        ),
        (
            "packages/web/src/App.tsx",
            r#"import type { Store } from "@fx/core";
import { formatCount } from "@fx/utils";

interface Props {
  store: Store<{ count: number }>;
}

// The counter re-renders on every store change.
export function App({ store }: Props) {
  const { count } = store.get();
  return <p>{formatCount(count)}</p>;
}
"#
            .into(),
        ),
        (
            "packages/web/rspack.config.js",
            r#"import { defineConfig } from "@fx/config";

export default defineConfig({ entry: "./src/main.tsx" });
"#
            .into(),
        ),
        (
            "packages/ui/package.json",
            r#"{ "name": "@fx/ui", "types": "src/index.ts", "dependencies": { "@fx/core": "workspace:*" } }"#.into(),
        ),
        (
            "packages/ui/src/index.ts",
            "export { Button } from \"./Button\";\nexport { Panel } from \"./Panel\";\n".into(),
        ),
        (
            "packages/ui/src/Button.tsx",
            r#"import type { ReactNode } from "react";

export function Button(props: { onClick: () => void; children: ReactNode }) {
  return (
    <button className="fx-button" onClick={props.onClick}>
      {props.children}
    </button>
  );
}
"#
            .into(),
        ),
        (
            "packages/ui/src/Panel.tsx",
            r#"import type { ReactNode } from "react";
import { clamp } from "@fx/core";

export function Panel({ title, children }: { title: string; children: ReactNode }) {
  const width = clamp(window.innerWidth, 320, 960);
  return (
    <section style={{ width }}>
      <h2>{title}</h2>
      {children}
    </section>
  );
}
"#
            .into(),
        ),
        (
            "packages/core/package.json",
            r#"{ "name": "@fx/core", "types": "src/index.ts", "dependencies": { "@fx/utils": "workspace:^" } }"#.into(),
        ),
        (
            "packages/core/src/index.ts",
            "export * from \"./store\";\nexport { clamp } from \"@fx/utils\";\n".into(),
        ),
        (
            "packages/core/src/store.ts",
            r#"export interface Store<S> {
  get(): S;
  set(next: Partial<S>): void;
  subscribe(listener: (state: S) => void): () => void;
}

/** A tiny observable store: enough state management for the demo. */
export function createStore<S extends object>(initial: S): Store<S> {
  let state = initial;
  const listeners = new Set<(state: S) => void>();
  return {
    get: () => state,
    set(next) {
      state = { ...state, ...next };
      listeners.forEach((l) => l(state));
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}
"#
            .into(),
        ),
        ("packages/utils/package.json", r#"{ "name": "@fx/utils", "types": "src/index.ts" }"#.into()),
        (
            "packages/utils/src/index.ts",
            r#"export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

export function formatCount(n: number): string {
  return n === 1 ? "1 item" : `${n} items`;
}
"#
            .into(),
        ),
        (
            "packages/config/package.json",
            r#"{ "name": "@fx/config", "types": "index.js", "peerDependencies": { "@fx/utils": "workspace:*" } }"#.into(),
        ),
        (
            "packages/config/index.js",
            "export function defineConfig(config) {\n  return { mode: \"production\", ...config };\n}\n".into(),
        ),
        ("packages/legacy/package.json", r#"{ "name": "@fx/legacy" }"#.into()),
        (
            "packages/legacy/lib/old.js",
            "// Kept for the archive; nothing imports it.\nmodule.exports = function old() {\n  return 42;\n};\n".into(),
        ),
        ("tools/scratch/package.json", r#"{ "name": "@fx/scratch" }"#.into()),
        (
            "tools/scratch/try.mts",
            "const started = Date.now();\nconsole.log(\"scratch\", started);\n".into(),
        ),
        // Skipped by discovery: installed, built and declaration files.
        ("packages/ui/node_modules/left-pad/index.js", "module.exports = 1;\n".into()),
        ("packages/ui/dist/index.js", "export {};\n".into()),
        ("packages/core/src/types.d.ts", "export {};\n".into()),
        ("packages/README.txt", "not a package\n".into()),
    ];
    // A file longer than a card, to show the "+K lines" footer.
    let mut long = String::from("// Generated-looking table: longer than a card.\nexport const TABLE = [\n");
    for i in 0..60 {
        long.push_str(&format!("  {{ id: {i}, name: \"row-{i}\", weight: {} }},\n", (i * 37) % 101));
    }
    long.push_str("];\n");
    files.push(("packages/core/src/table.ts", long));
    files
}

/// Writes the demo monorepo into `dir`, which is wiped first. Also links
/// `node_modules/@fx/*` to the packages, as yarn's node-modules linker would.
pub fn write_demo(dir: &Path) -> std::io::Result<()> {
    let _ = std::fs::remove_dir_all(dir);
    for (rel, content) in demo_files() {
        let path = dir.join(rel);
        std::fs::create_dir_all(path.parent().expect("file has a parent"))?;
        std::fs::write(path, content)?;
    }
    #[cfg(unix)]
    {
        let scope = dir.join("node_modules/@fx");
        std::fs::create_dir_all(&scope)?;
        for (name, rel) in [("web", "packages/web"), ("ui", "packages/ui"), ("core", "packages/core"), ("utils", "packages/utils"), ("config", "packages/config")] {
            std::os::unix::fs::symlink(dir.join(rel), scope.join(name))?;
        }
    }
    Ok(())
}
