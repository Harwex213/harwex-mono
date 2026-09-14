# SPDX-FileCopyrightText: 2026 Blender Authors
#
# SPDX-License-Identifier: GPL-3.0-or-later

"""
Package marker for the vendored slice of the Blender MCP server.

Upstream's ``blmcp/__init__.py`` is the MCP server's entry point and imports
``yaml`` and the MCP SDK. The harness only runs the three documentation tools,
so this stub stands in its place and the vendored tree needs neither
dependency. Everything else under this directory is upstream, verbatim.
"""

__all__ = ()
