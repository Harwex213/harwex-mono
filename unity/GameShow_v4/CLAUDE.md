# Unity MCP

Work on this project through Unity MCP. The running editor holds the truth. Imported assets, baked
lighting, prefab links and material bindings live in the editor, not in the files on disk. If you
edit scene or asset YAML by hand, the editor either ignores the change or overwrites it on the next
save. Use `Unity_RunCommand` to read and change state, and check every change in the editor.

## Use the MCP server pinned to this project

Use the `unity-gameshow` tools (`mcp__unity-gameshow__*`). They are pinned to this project by
`--project-path`, so they reach this editor no matter what else is running.

Several Unity editors run on this machine at times, and an unpinned relay picks one of them by
port number rather than by project name. Ports are handed out first-come-first-served, so an
unpinned server answers from whichever editor happened to start first.

That failure is silent: `Unity_RunCommand` compiles the snippet, reports success, and applies it
to the wrong project.

The pinned servers live in `.mcp.json` at the repo root — `unity-gameshow` for this project and
`unity-selflearning` for the other one. Both editors can stay open.

Check anyway before a long session, and again after any editor restart. Run a snippet that logs
`Application.dataPath`. It has to end with `unity/GameShow_v4/Assets`.
