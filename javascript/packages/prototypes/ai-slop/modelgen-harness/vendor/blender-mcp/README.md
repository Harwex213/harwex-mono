# Vendored Blender MCP

Everything the harness needs from the Blender MCP server, so nothing has to be
installed next to it.

- upstream: <https://projects.blender.org/lab/blender_mcp>
- taken at commit: `98b0e49d98321d321c7e631389200f513f765d59` (2026-05-05)
- licence: GPL-3.0-or-later, as in the file headers

## `tools/`

`mcp/blmcp/tools/*_toolcode.py` and `mcp/blmcp/tools/_template_*.py`, copied
verbatim. Each file is the body of one tool, executed inside Blender;
`_template_*.py` files are pulled in by the `# @include_begin:` markers.
`electron/blender/toolcode.ts` assembles the call the way upstream's
`tools_helpers/__init__.py` does. Nothing here is imported as a Python
package — the harness only reads the text and sends it to Blender.

## `python/`

What the three documentation tools need, run by
`electron/blender/docs.ts` through `run_doc_tool.py`:

| Path | From upstream | Notes |
| --- | --- | --- |
| `blmcp/tools/{search_api_docs,search_manual_docs,get_python_api_docs}.py` | `mcp/blmcp/tools/` | verbatim |
| `blmcp/tools/__init__.py` | `mcp/blmcp/tools/` | verbatim |
| `blmcp/tools_helpers/{__init__,rst_doc_search,rst_parse_docs}.py` | `mcp/blmcp/tools_helpers/` | verbatim |
| `blmcp/data/{api,manual}` | `mcp/blmcp/data/` | the RST the tools search, 25 MB |
| `blmcp/__init__.py` | — | a stub of ours, see the file |
| `docutils/` | the docutils package | pure Python, what `rst_parse_docs` parses with |
| `run_doc_tool.py` | — | ours: stands in for the MCP SDK and calls the tool |

`blmcp/tools_helpers/rst_parse_docs.py` finds the RST as `../data` next to
itself, so the layout above has to stay as it is.

## Refreshing

Copy over `tools/`, the four `blmcp/` paths marked verbatim and `blmcp/data/`,
then update the commit line above. Leave `blmcp/__init__.py` and
`run_doc_tool.py` alone: upstream's `__init__.py` is the MCP server's entry
point and pulls in `yaml` and the MCP SDK, which is exactly what the stub
avoids. If upstream's tool modules grow an import beyond docutils and the two
SDK modules, `run_doc_tool.py` is where to stand it in.
