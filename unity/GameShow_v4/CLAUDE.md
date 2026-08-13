# Unity MCP

Work on this project through Unity MCP. The running editor holds the truth. Imported assets, baked
lighting, prefab links and material bindings live in the editor, not in the files on disk. If you
edit scene or asset YAML by hand, the editor either ignores the change or overwrites it on the next
save. Use `Unity_RunCommand` to read and change state, and check every change in the editor.

## Check which project you are connected to

The MCP server can be connected to a **different Unity project**. Several Unity editors run on this
machine at times. The relay picks one of them by port number, not by project name, so the choice is
arbitrary.

This failure is silent. `Unity_RunCommand` compiles the snippet, reports success, and applies it to
the wrong project.

So check before you change anything. Run a snippet that logs `Application.dataPath`. It has to end with `unity/GameShow_v4/Assets`.

If the wrong project answers, start a relay pinned to this project:

```
~/.unity/relay/relay_mac_arm64.app/Contents/MacOS/relay_mac_arm64 --mcp \
  --project-path ~/Projects/harwex-mono/unity/GameShow_v4
```
