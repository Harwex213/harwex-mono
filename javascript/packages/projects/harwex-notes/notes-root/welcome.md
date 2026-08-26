# Welcome to Harwex Notes

This is a **local workbench over one folder on disk**. The tree on the left is
the folder; the pane on the right changes shape to match whatever you open.

## What each file kind gets

| Extension | Editor |
| --- | --- |
| `.excalidraw` | a live Excalidraw canvas, autosaved |
| `.md` | CodeMirror with a rendered preview |
| `.txt` and anything else | CodeMirror, plain |
| `.html` | a sandboxed iframe, with a source toggle |

## Try this

1. Type something here and press `Cmd+S` (or `Ctrl+S`). The dirty dot on the tab
   clears once the write lands.
2. Open `scratch.excalidraw` and draw. There is no save button: the drawing
   *is* the edit, so it autosaves 800 ms after you stop moving.
3. Open `demo.html`. It renders in an iframe with `sandbox="allow-scripts"`,
   which means the frame sits on an opaque origin and cannot reach back in.
4. Expand `projects/alpha` for a nested folder.

> The tree lists one directory level per request. Nothing is listed twice until
> you collapse a folder and open it again.
