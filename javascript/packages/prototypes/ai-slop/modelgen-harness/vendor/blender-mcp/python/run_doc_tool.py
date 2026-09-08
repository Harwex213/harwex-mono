# SPDX-License-Identifier: GPL-3.0-or-later

"""
Runs one of the Blender MCP documentation tools and prints its result as JSON.

Reads ``[tool_name, args]`` as JSON on stdin, writes the tool's result as JSON
on stdout. Called by `electron/blender/docs.ts`.

The tool modules register themselves on a FastMCP server and are typed against
the MCP SDK, which the harness does not ship: it never speaks MCP here, it just
calls the function the module registers. So the two SDK modules the tools
import are stood in for before the import, and a capture object stands in for
the server. Nothing else about the tool modules is touched, and they keep
reading the RST files next to them.
"""

import json
import sys
import types

HERE = sys.path[0]
TOOLS = ("search_api_docs", "search_manual_docs", "get_python_api_docs")


def install_sdk_stubs() -> None:
    """
    Put the two MCP SDK modules the tools import into ``sys.modules``.

    ``FastMCP`` is only ever an annotation on ``register``, and
    ``ToolAnnotations`` only carries a title and hints for the MCP client, so a
    class that swallows its keywords is enough for both.
    """

    class ToolAnnotations:  # pylint: disable=too-few-public-methods
        def __init__(self, **fields: object) -> None:
            self.fields = fields

    class FastMCP:  # pylint: disable=too-few-public-methods
        pass

    root = types.ModuleType("mcp")
    server = types.ModuleType("mcp.server")
    fastmcp = types.ModuleType("mcp.server.fastmcp")
    tool_types = types.ModuleType("mcp.types")
    fastmcp.FastMCP = FastMCP
    tool_types.ToolAnnotations = ToolAnnotations
    root.server = server
    server.fastmcp = fastmcp
    sys.modules["mcp"] = root
    sys.modules["mcp.server"] = server
    sys.modules["mcp.server.fastmcp"] = fastmcp
    sys.modules["mcp.types"] = tool_types


class Capture:
    """
    Stands in for the FastMCP server: keeps the function the module registers.
    """

    def __init__(self) -> None:
        self.fn = None

    def tool(self, *_args: object, **_fields: object):
        def decorate(fn):
            self.fn = fn
            return fn

        return decorate


def main() -> int:
    name, args = json.loads(sys.stdin.read())
    if name not in TOOLS:
        print(json.dumps({"error": "{:s} is not a documentation tool".format(name)}))
        return 1
    install_sdk_stubs()
    module = __import__("blmcp.tools." + name, fromlist=["register"])
    capture = Capture()
    module.register(capture)
    if capture.fn is None:
        print(json.dumps({"error": "{:s} registered no function".format(name)}))
        return 1
    print(json.dumps(capture.fn(**args), default=str))
    return 0


if __name__ == "__main__":
    sys.exit(main())
