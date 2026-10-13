# 110 — Show git-ignored files in the Project tree (dimmed), like IDEA

Now the Project tree hides everything matched by `.gitignore` (`docs/usage.md`: "Файлы из `.gitignore` скрыты"). IDEA shows them, dimmed (its "ignored" file color), and excludes them only from search and indexing.

Wanted:
- Ignored files and folders (`node_modules`, `dist`, `target`, `.idea`, …) appear in the Project tree with the theme's dimmed "ignored" color (new token, like IDEA's olive/grey). A child of an ignored folder is dimmed too.
- Ignored folders are read lazily: their children are listed only when the user expands the folder, on a worker. Opening mono (`~/Projects/mono`, read-only, ~500k files, huge `node_modules`) must not get slower at startup or in memory: the file index, watcher batches and git status must not walk ignored trees.
- Search Everywhere, Find in Files, Recent/Go to File and the tree speed search keep skipping ignored files (the speed search covers only visible rows, so expanded ignored rows may match — fine).
- `.git` itself stays hidden.
- Files opened from an ignored folder work as normal tabs (highlighting, LSP); breadcrumbs and "select in Project" (locate) can reveal an ignored file by expanding its folders.
- A setting in Settings → Editor or System (global, task 104 scopes): "Show ignored files in Project" (default on, like IDEA).
- The watcher: a change inside an expanded ignored folder refreshes that folder; changes in unexpanded ignored folders are not tracked.

## Done means
kittest on a fixture repo with `.gitignore` (dimmed rows snapshot — look at the PNG; lazy expand; locate into an ignored folder; setting off hides them; search still skips them). A measured mono check (`nice -n 19`, 1–3 runs, nothing in parallel): startup index time and RSS before/after, written into Progress. Full `cargo xtask test`, clippy, clean-check; contracts in `app/CLAUDE.md`; `docs/usage.md` in Russian (fix the "скрыты" lines).

## Progress

